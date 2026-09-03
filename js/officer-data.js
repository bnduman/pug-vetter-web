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
import { fetchDeaths, fetchDebuffUptimes } from "./officer-stats.js";

// ---------------------------------------------------------------------------
// Per-fight consumable presence from combatantinfo rows ({fight, sourceID,
// auras:[{name}]}). classifyConsumables is reused verbatim: seeds carry names.
//
// Two tiers are tracked because they answer different officer questions:
//   flaskFights  - pulls flask-EQUIVALENT (a flask, or a battle+guardian pair)
//   elixirFights - pulls with ANY flask/elixir at all (superset of the above)
// A caster running a lone Elixir of Draenic Wisdom every pull is elixirFights
// == attended but flaskFights == 0: half-prepped, NOT unprepped. `consumables`
// keeps the distinct flask/elixir names so the card can show what they ran.

/** -> Map player id ->
 *   { attended, flaskFights, elixirFights, foodFights, consumables: string[] } */
export function consumablesByFight(ciRows) {
  const byPlayer = new Map();
  for (const r of ciRows ?? []) {
    if (r.sourceID == null || r.fight == null) continue;
    let p = byPlayer.get(r.sourceID);
    if (!p) byPlayer.set(r.sourceID, (p = {
      attended: 0, flaskFights: 0, elixirFights: 0, foodFights: 0, scrollFights: 0,
      consumables: new Set(), scrolls: new Set(),
    }));
    p.attended += 1;
    const c = classifyConsumables(r.auras ?? []);
    if (c.flaskReady) p.flaskFights += 1;
    if (c.flask || c.elixirs.length) p.elixirFights += 1;
    if (c.food) p.foodFights += 1;
    if (c.scrolls.length) p.scrollFights += 1;
    if (c.flask) p.consumables.add(c.flask);
    for (const e of c.elixirs) p.consumables.add(e);
    for (const s of c.scrolls) p.scrolls.add(s);
  }
  for (const p of byPlayer.values()) {
    p.consumables = [...p.consumables].sort();
    p.scrolls = [...p.scrolls].sort();
  }
  return byPlayer;
}

// ---------------------------------------------------------------------------
// Attendance roster math, from the getAttendanceMap() shape.

/** -> { totalReports, reports:[{code,ts,zone}] newest-first, rows:[...] }.
 *  A row: { name, count, pct, lastTs, streak, fading }. `fading` = has real
 *  history (>= max(3, 20% of reports)) but missed the last `recentWindow`.
 *  `limit` > 0 grades against only the newest N reports: counts, %, and
 *  membership are all within that window (0 attendance there = not listed). */
export function buildRoster(attMap, { recentWindow = 3, limit = 0 } = {}) {
  const byCode = new Map();
  for (const p of Object.values(attMap.players)) {
    for (const r of p.raids) if (r.code) byCode.set(r.code, r);
  }
  let reports = [...byCode.values()].sort((a, b) => b.ts - a.ts);
  if (limit > 0) reports = reports.slice(0, limit);
  const windowCodes = new Set(reports.map((r) => r.code));
  const total = reports.length;
  const historyBar = Math.max(3, Math.ceil(total * 0.2));

  const rows = Object.values(attMap.players).flatMap((p) => {
    // raids are newest-first, so [0] is the latest attended in the window
    const inWindow = p.raids.filter((r) => windowCodes.has(r.code));
    if (!inWindow.length) return []; // fell out of the graded window entirely
    const codes = new Set(inWindow.map((r) => r.code));
    let streak = 0;
    for (const r of reports) {
      if (codes.has(r.code)) streak++; else break;
    }
    const missedRecent = reports.slice(0, recentWindow).length === recentWindow
      && reports.slice(0, recentWindow).every((r) => !codes.has(r.code));
    return [{
      name: p.name,
      alts: p.alts ?? [], // bundled characters (CONFIG.ALTS), merged upstream
      count: inWindow.length,
      pct: total ? Math.round((inWindow.length / total) * 100) : 0,
      lastTs: inWindow[0]?.ts ?? p.lastTs,
      streak,
      fading: missedRecent && inWindow.length >= historyBar,
    }];
  }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return { totalReports: total, reports, rows };
}

// ---------------------------------------------------------------------------
// Discord export for the report card.

// How many names each naughty line lists before it truncates. The prep shame
// lists above are unbounded because "who turned up unprepared" is the whole
// point, but fall damage catches half the raid on a Hyjal night (20 players on
// 26/08) and pasting all of them buries the message.
const NAUGHTY_LIMIT = 5;

// Pinned to en-US rather than the browser's locale, unlike the card's own
// num(). The card is a personal view; this text is pasted into Discord for the
// whole guild, so it must not change shape with whoever pressed Copy — a
// Turkish officer's toLocaleString() renders 13241 as "13.241", which an
// English-reading raid can fairly read as thirteen point two.
const num = (n) => (n ?? 0).toLocaleString("en-US");

// "Eleven raiders discovered…" reads better than "11 raiders" in a sentence, so
// small counts are spelled out and larger ones stay numeric — past twelve the
// word is longer than the number and the joke has stopped being the point.
const COUNT_WORDS = [
  "Nobody", "One", "Two", "Three", "Four", "Five", "Six",
  "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
];
const countWord = (n) => COUNT_WORDS[n] ?? String(n);

/** "a, b, c (+4 more)" — keeps a long shame list pasteable. */
function topNames(rows, limit = NAUGHTY_LIMIT) {
  const shown = rows.slice(0, limit);
  const rest = rows.length - shown.length;
  return shown.join(", ") + (rest > 0 ? ` (+${rest} more)` : "");
}

/**
 * @param card  the report card
 * @param deep  optional fetchDeepStats() result. The deep scan is opt-in, so
 *   when it hasn't been run the naughty lines are OMITTED rather than reported
 *   as "nobody 🎉" — claiming an empty naughty corner from data nobody fetched
 *   would be the same confident-zero mistake the Deaths column avoids.
 */
export function reportCardToDiscord(card, deep = null) {
  const lines = [`**${card.title} — raid prep**`];
  const known = card.players.filter((p) => p.perFight && p.perFight.attended > 0);
  // Shame threshold: below this fraction of pulls. A flask that ran out for
  // the very last boss is not a Discord offense.
  const shame = (key) => known
    .filter((p) => p.perFight[key] <= p.perFight.attended / 2)
    .sort((a, b) => (a.perFight[key] / a.perFight.attended) - (b.perFight[key] / b.perFight.attended))
    .map((p) => `${p.name} ${p.perFight[key]}/${p.perFight.attended}`);
  // No flask or elixir at all on half+ their pulls — the clear offense.
  const consShame = shame("elixirFights");
  const foodShame = shame("foodFights");
  // Ran SOMETHING every pull but never a flask-equivalent (a lone elixir) —
  // a softer nudge, listed separately so it doesn't read as "used nothing".
  const partial = known
    .filter((p) => p.perFight.elixirFights === p.perFight.attended && p.perFight.flaskFights === 0)
    .map((p) => p.name);
  const enchShame = card.players.filter((p) => (p.missingCount ?? 0) > 0)
    .sort((a, b) => b.missingCount - a.missingCount)
    .map((p) => {
      const slots = (p.missingEnchants ?? []).map((m) => m.slot).join(", ");
      return slots ? `${p.name} (${slots})` : `${p.name} (${p.missingCount})`;
    });
  // The tone is deliberately dry: this gets pasted in front of the whole guild,
  // so the joke is on the BEHAVIOUR and never on the person. Each label still
  // names the metric, because a raid leader has to be able to read it at a
  // glance — the ratios and numbers that follow do the actual work.
  lines.push(`🧪 Saving consumables for Wrath: ${consShame.join(", ") || "nobody 🎉"}`);
  if (partial.length) lines.push(`⚗️ Why use many elixirs when one do the trick: ${partial.join(", ")}`);
  lines.push(`🍖 Protein cap not reached (no food buff): ${foodShame.join(", ") || "nobody 🎉"}`);
  lines.push(`✨ Enchanting your gear remains an exciting future project: ${enchShame.join(", ") || "nobody 🎉"}`);
  // Only debuffs somebody could actually apply, and only the ones worth a
  // callout — a full checklist would drown the message.
  const weakDebuffs = (card.debuffs?.rows ?? [])
    .filter((d) => d.hasProvider && d.core && d.pct < 80)
    .sort((a, b) => a.pct - b.pct)
    .map((d) => `${d.label} ${d.pct}%`);
  if (card.debuffs) {
    lines.push(`🎯 Raid debuffs that could do better (under 80%): ${weakDebuffs.join(", ") || "all covered 🎉"}`);
  }

  // --- naughty corner (deep scan only) ---
  if (deep) {
    const blast = [...(deep.friendlyFire ?? new Map()).entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([name, v]) => `${name} ${num(v.total)} (${[...v.mechanics.keys()].join(", ")})`);
    // Falling is keyed by player id, so it needs the roster to become names.
    const nameById = new Map(card.players.map((p) => [p.id, p.name]));
    const fell = [...(deep.falling ?? new Map()).entries()]
      .filter(([id, dmg]) => dmg > 0 && nameById.has(id))
      .sort((a, b) => b[1] - a[1]);
    const fallTotal = fell.reduce((n, [, d]) => n + d, 0);

    lines.push(`💥 Friendly fire hurts even more: ${topNames(blast) || "nobody, remarkably 🎉"}`);
    // The one line whose LABEL is generated rather than fixed: it counts the
    // fallers and names where they landed. `card.zone` is whatever Warcraft
    // Logs calls the zone, which for Tier 6 is the combined "BT / Hyjal" rather
    // than the specific wing — telling the two apart would need a boss-to-wing
    // map this file has no other use for.
    lines.push(fell.length
      ? `🪂 ${countWord(fell.length)} raider${fell.length === 1 ? "" : "s"} discovered that `
        + `${card.zone ?? "this place"} does, in fact, have a ground: `
        + `${topNames(fell.map(([id, dmg]) => `${nameById.get(id)} ${num(dmg)}`))} — ${num(fallTotal)} total`
      : "🪂 Nobody found the ground the hard way 🎉");
    // A degraded scan under-reports, and an under-reported shame list reads as
    // an innocent one. Say so rather than letting a short list flatter anyone.
    // Left deliberately plain: a warning that has to be believed is the wrong
    // place for a joke.
    if (deep.failed) {
      lines.push(`⚠ ${deep.failed} of ${deep.queries} query batches failed — the two lines above are lower bounds.`);
    }
  }
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
    data { code title startTime zone { name } }
  } }
}`;

const OFFICER_META_QUERY = `
query($code: String!) {
  reportData { report(code: $code) {
    title startTime endTime
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
      deathsOk: true,
      reportDurationMs: (rep?.endTime ?? 0) - (rep?.startTime ?? 0),
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

  // Deaths for the WHOLE night (one query), split boss vs trash. Trash deaths
  // never show up in the encounter-only views, but they're exactly what an
  // officer wants to see, so the window is the full report.
  onProgress("Reading deaths…");
  let deathsById = new Map();
  let deathsOk = true;
  try {
    const reportDuration = (rep?.endTime ?? 0) - (rep?.startTime ?? 0);
    deathsById = await fetchDeaths(code, reportDuration, new Set(fightIDs));
  } catch {
    deathsOk = false; // deaths are a bonus; never fail the card over them
  }
  for (const p of prep.players) {
    // null (not a zeroed record) when the query failed — "we don't know" must
    // never render as "nobody died" on a night that had 150 deaths.
    p.deaths = deathsOk ? (deathsById.get(p.id) ?? { total: 0, boss: 0, trash: 0 }) : null;
  }

  // Raid-debuff uptimes over the boss pulls (one query). Cheap because the
  // Debuffs table is ability-keyed, so one call covers the whole night.
  // Provider classes come from the roster we already have, so a debuff nobody
  // could apply reads as "no <class>" instead of as a 0% failure.
  onProgress("Reading raid debuffs…");
  // Spec matters as much as class: Misery needs a SHADOW priest, Improved
  // Scorch a FIRE mage. We already resolved both, so pass them through.
  const comp = prep.players
    .filter((p) => p.class)
    .map((p) => ({ class: p.class, spec: p.talents?.spec ?? null }));
  let debuffs = null;
  let debuffsOk = true;
  try {
    debuffs = await fetchDebuffUptimes(code, new Set(fightIDs), comp);
    // A null return with pulls present means the table came back unusable,
    // which is a failure to retry — not a report that genuinely has no debuffs.
    if (!debuffs) debuffsOk = false;
  } catch {
    debuffs = null;
    debuffsOk = false; // a bonus panel; never fail the card over it
  }

  const withData = prep.players.filter((p) => p.perFight);
  const card = {
    deathsOk,
    debuffs,
    // Whole-report window, for the opt-in deep scan (which covers trash too).
    reportDurationMs: (rep?.endTime ?? 0) - (rep?.startTime ?? 0),
    code,
    title: rep?.title ?? code,
    zone: rep?.zone?.name ?? null,
    ts: rep?.startTime ?? 0,
    // The deep scan uses one whole-report window, so it needs no per-pull
    // times; these are kept only for the card's own kills/pulls counts.
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
  // A card with ANY degraded half isn't cached, so re-loading it actually
  // retries instead of serving the same "no data" column all session. This
  // covers every optional extra, not just deaths — caching a card whose
  // debuff query died would pin an empty panel for the whole session.
  if (deathsOk && debuffsOk) cardCache.set(code, card);
  return card;
}
