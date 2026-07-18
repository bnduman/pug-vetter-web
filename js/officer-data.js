"use strict";
// Officer tab data layer: guild report listing, report-wide raid prep
// (per-pull consumable checks, enchant gaps, specs) and the attendance
// roster. Pure math is exported separately for unit tests.
//
// Consumables are read from each fight's raw combatantinfo AURA SEEDS, not
// from the Buffs table: the table intermittently fails to band pre-pull auras
// for some fights (verified live on a Kael'thas kill where every seed carried
// the flask but the table banded none of them). Seeds are per player PER
// PULL, which is also the metric officers actually want ("flasked on 7/9
// pulls", catching a flask that expired mid-night).
//
// Cost per report: 3 queries (meta + playerDetails + combatantinfo) — no
// per-player queries at all.
import { CONFIG } from "./config.js";
import { cacheGet, cacheSet, postGraphQL } from "./wcl.js";
import { buildRaidPrep, classifyConsumables } from "./csi/prep.js";

// ---------------------------------------------------------------------------
// Per-fight consumable presence from combatantinfo rows ({fight, sourceID,
// auras:[{name}]}). classifyConsumables is reused verbatim: seeds carry names.

/** -> Map player id -> { attended, flaskFights, foodFights } */
export function consumablesByFight(ciRows) {
  const byPlayer = new Map();
  for (const r of ciRows ?? []) {
    if (r.sourceID == null || r.fight == null) continue;
    let p = byPlayer.get(r.sourceID);
    if (!p) byPlayer.set(r.sourceID, (p = { attended: 0, flaskFights: 0, foodFights: 0 }));
    p.attended += 1;
    const c = classifyConsumables(r.auras ?? []);
    if (c.flaskReady) p.flaskFights += 1;
    if (c.food) p.foodFights += 1;
  }
  return byPlayer;
}

// ---------------------------------------------------------------------------
// Attendance roster math, from the getAttendanceMap() shape.

/** -> { totalReports, reports:[{code,ts,zone}] newest-first, rows:[...] }.
 *  A row: { name, count, pct, lastTs, streak, fading }. `fading` = has real
 *  history (>= max(3, 20% of reports)) but missed the last `recentWindow`. */
export function buildRoster(attMap, { recentWindow = 3 } = {}) {
  const byCode = new Map();
  for (const p of Object.values(attMap.players)) {
    for (const r of p.raids) if (r.code) byCode.set(r.code, r);
  }
  const reports = [...byCode.values()].sort((a, b) => b.ts - a.ts);
  const total = reports.length;
  const historyBar = Math.max(3, Math.ceil(total * 0.2));

  const rows = Object.values(attMap.players).map((p) => {
    const codes = new Set(p.raids.map((r) => r.code));
    let streak = 0;
    for (const r of reports) {
      if (codes.has(r.code)) streak++; else break;
    }
    const missedRecent = reports.slice(0, recentWindow).length === recentWindow
      && reports.slice(0, recentWindow).every((r) => !codes.has(r.code));
    return {
      name: p.name,
      alts: p.alts ?? [], // bundled characters (CONFIG.ALTS), merged upstream
      count: p.count,
      pct: total ? Math.round((p.count / total) * 100) : 0,
      lastTs: p.lastTs,
      streak,
      fading: missedRecent && p.count >= historyBar,
    };
  }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return { totalReports: total, reports, rows };
}

// ---------------------------------------------------------------------------
// Discord export for the report card.

export function reportCardToDiscord(card) {
  const lines = [`**${card.title} — raid prep**`];
  const known = card.players.filter((p) => p.perFight && p.perFight.attended > 0);
  // Shame threshold: unprepped on half or more of your pulls. A flask that
  // ran out for the very last boss is not a Discord offense.
  const shame = (key) => known
    .filter((p) => p.perFight[key] <= p.perFight.attended / 2)
    .sort((a, b) => (a.perFight[key] / a.perFight.attended) - (b.perFight[key] / b.perFight.attended))
    .map((p) => `${p.name} ${p.perFight[key]}/${p.perFight.attended}`);
  const flaskShame = shame("flaskFights");
  const foodShame = shame("foodFights");
  const enchShame = card.players.filter((p) => (p.missingCount ?? 0) > 0)
    .sort((a, b) => b.missingCount - a.missingCount)
    .map((p) => `${p.name} (${p.missingCount})`);
  lines.push(`🧪 Flask/elixirs on half the pulls or less: ${flaskShame.join(", ") || "nobody 🎉"}`);
  lines.push(`🍖 Food on half the pulls or less: ${foodShame.join(", ") || "nobody 🎉"}`);
  lines.push(`✨ Missing enchants: ${enchShame.join(", ") || "nobody 🎉"}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// WCL fetchers.

const GUILD_QUERY = `
query($name: String!, $serverSlug: String!, $serverRegion: String!) {
  guildData { guild(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) { id name } }
}`;

const GUILD_REPORTS_QUERY = `
query($guildID: Int!, $limit: Int!) {
  reportData { reports(guildID: $guildID, limit: $limit) {
    data { code title startTime endTime zone { name } }
  } }
}`;

const OFFICER_META_QUERY = `
query($code: String!) {
  reportData { report(code: $code) {
    title startTime
    zone { name }
    fights(killType: Encounters) { id name kill startTime endTime }
  } }
}`;

const OFFICER_PLAYER_DETAILS_QUERY = `
query($code: String!, $fightIDs: [Int]!) {
  reportData { report(code: $code) { playerDetails(fightIDs: $fightIDs, includeCombatantInfo: true) } }
}`;

const OFFICER_CI_QUERY = `
query($code: String!, $fightIDs: [Int!]!, $start: Float!, $end: Float!) {
  reportData { report(code: $code) {
    events(fightIDs: $fightIDs, startTime: $start, endTime: $end, dataType: CombatantInfo, limit: 3000) {
      data
      nextPageTimestamp
    }
  } }
}`;

const slugify = (realm) =>
  (realm ?? "").trim().toLowerCase().replace(/'/g, "").replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "");

const MAX_CI_PAGES = 5;

export async function getGuildId() {
  if (!CONFIG.GUILD_NAME) return null;
  const key = `officer_gid/${CONFIG.GUILD_REGION}/${slugify(CONFIG.GUILD_REALM)}/${CONFIG.GUILD_NAME.toLowerCase()}`;
  const cached = cacheGet(key, CONFIG.ZONES_TTL_SECONDS);
  if (cached) return cached;
  const data = await postGraphQL(GUILD_QUERY, {
    name: CONFIG.GUILD_NAME,
    serverSlug: slugify(CONFIG.GUILD_REALM),
    serverRegion: CONFIG.GUILD_REGION,
  });
  const id = data.guildData?.guild?.id ?? null;
  if (id) cacheSet(key, id);
  return id;
}

/** Recent reports uploaded under the guild banner, newest first. */
export async function listGuildReports(limit = 20) {
  const guildID = await getGuildId();
  if (!guildID) return null;
  const data = await postGraphQL(GUILD_REPORTS_QUERY, { guildID, limit });
  return (data.reportData?.reports?.data ?? []).map((r) => ({
    code: r.code,
    title: r.title ?? r.code,
    ts: r.startTime ?? 0,
    zone: r.zone?.name ?? null,
  }));
}

// Cards are cheap now (3 queries) but keep them for the session anyway.
const cardCache = new Map();

/** Report-wide officer card: per raider — enchant gaps, spec, and per-pull
 *  flask/food presence across the boss fights they attended. */
export async function fetchOfficerCard(code, onProgress = () => {}) {
  if (cardCache.has(code)) return cardCache.get(code);

  onProgress("Reading report…");
  const meta = await postGraphQL(OFFICER_META_QUERY, { code });
  const rep = meta.reportData?.report;
  const fights = rep?.fights ?? [];
  if (!fights.length) {
    // Same shape as a real card (cardHtml dereferences coverage) — just empty.
    // Deliberately NOT cached: a fight-less report is usually tonight's log
    // still uploading, and a re-Load should see fights as they land.
    return {
      code,
      title: rep?.title ?? code,
      zone: rep?.zone?.name ?? null,
      ts: rep?.startTime ?? 0,
      fights: [],
      players: [],
      raidSize: 0,
      coverage: { tracked: 0, alwaysFlasked: 0, alwaysFed: 0, enchanted: 0, gearCovered: 0 },
    };
  }
  const fightIDs = fights.map((f) => f.id);
  const start = Math.min(...fights.map((f) => f.startTime));
  const end = Math.max(...fights.map((f) => f.endTime));

  onProgress("Reading roster & gear…");
  const pdq = await postGraphQL(OFFICER_PLAYER_DETAILS_QUERY, { code, fightIDs });
  const pd = pdq.reportData?.report?.playerDetails;

  onProgress("Reading per-pull buffs & talents…");
  const ciRows = [];
  let ciStart = start;
  for (let i = 0; i < MAX_CI_PAGES; i++) {
    const ciq = await postGraphQL(OFFICER_CI_QUERY, { code, fightIDs, start: ciStart, end });
    const block = ciq.reportData?.report?.events ?? {};
    ciRows.push(...(block.data ?? []));
    const next = block.nextPageTimestamp;
    if (!next || next <= ciStart) break;
    ciStart = next;
  }
  const talentsById = {};
  for (const r of ciRows) if (r.sourceID != null) talentsById[r.sourceID] = r.talents;
  const perFightById = consumablesByFight(ciRows);

  // gear/enchants/talents/ordering from the existing prep model; per-pull
  // consumable counts are attached on top (prep's own binary consumable flags
  // stay "unknown" — we didn't pass aura sets).
  const prep = buildRaidPrep(pd, {}, talentsById);
  for (const p of prep.players) {
    p.perFight = perFightById.get(p.id) ?? null;
  }

  const withData = prep.players.filter((p) => p.perFight);
  const card = {
    code,
    title: rep?.title ?? code,
    zone: rep?.zone?.name ?? null,
    ts: rep?.startTime ?? 0,
    fights: fights.map((f) => ({ id: f.id, name: f.name, kill: !!f.kill })),
    raidSize: prep.raidSize,
    coverage: {
      tracked: withData.length,
      alwaysFlasked: withData.filter((p) => p.perFight.flaskFights === p.perFight.attended).length,
      alwaysFed: withData.filter((p) => p.perFight.foodFights === p.perFight.attended).length,
      enchanted: prep.players.filter((p) => p.missingCount === 0).length,
      gearCovered: prep.players.filter((p) => p.hasGear).length,
    },
    players: prep.players,
  };
  cardCache.set(code, card);
  return card;
}
