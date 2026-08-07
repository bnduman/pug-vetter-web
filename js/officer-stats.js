"use strict";
// Officer tab — night statistics beyond the prep card.
//
// Two tiers, because WCL's cost profile forces the split:
//
//   CHEAP (1 query, always loaded): deaths for the whole night, split into
//   boss pulls vs trash. The Deaths table is accurate over a full-report
//   window — verified 2026-07-24 against a 4h SSC/TK report (156 deaths
//   whole-report vs 132 summed per-encounter; the extra 24 are the trash
//   deaths, so nothing is lost).
//
//   DEEP (~26 queries, opt-in): avoidable damage taken, interrupts, consumables
//   used, and raid utility (dispels / innervates / threat drops / nets / bombs)
//   — all across the WHOLE night, trash included.
//
// THE TRUNCATION TRAP that shapes this file: a WCL table returns only each
// player's TOP 5 abilities. It is not a time-window limit and there is no
// error — measured on a 4h SSC/TK report, every player came back with exactly
// 5 damage-taken abilities whether the window was one pull or the whole night.
// Two consequences:
//   * Summing per-fight does NOT fix it (a single pull can exceed 5 too), it
//     only makes the loss smaller and much more expensive.
//   * Anything outside a player's top 5 is invisible — which is why searching
//     the Casts table for consumables finds nothing: a raider's top 5 casts
//     are always their rotation, never a potion.
// The fix is to stop browsing and start ASKING: filterExpression restricts the
// table to the abilities we care about, so they can't be crowded out. Ids are
// batched in groups of 4 (safely under the cap of 5), over a whole-report
// window — which is both complete AND cheaper than per-fight scanning, and
// picks up trash for free.
//
// Validated against the guild's own RPB spreadsheet for 22-07: whole-report
// interrupts came to 42 across 9 players, matching the sheet's row exactly
// (boss-pull-only scanning had given 29).
import { postGraphQL } from "./wcl.js";
import { isAvoidableHit, lookupRule } from "./csi/rules.js";
import { RULE_SPELL_IDS } from "./csi/rule-ids.js";
import { CONSUMABLE_CASTS, CONSUMABLE_CAST_IDS } from "./consumable-casts.js";
import { UTILITY_CASTS, UTILITY_CAST_IDS } from "./utility-casts.js";
import { RAID_DEBUFFS } from "./raid-debuffs.js";

// Ability ids per filtered query. The table caps each player at 5 abilities,
// so a batch of 4 can never be truncated.
const IDS_PER_BATCH = 4;
// Filtered queries in flight at once — the rate limit is shared by every visitor.
const STATS_CONCURRENCY = 4;

const DEATHS_QUERY = `
query($code: String!, $start: Float!, $end: Float!) {
  reportData { report(code: $code) {
    table(startTime: $start, endTime: $end, dataType: Deaths)
  } }
}`;

// Enemy debuffs across the BOSS PULLS only — fightIDs, not a whole-report
// window, because uptime is a percentage and the denominator has to be time
// the raid was actually fighting a boss. Verified live: totalTime comes back
// exactly equal to the summed length of the fights asked for.
//
// Unlike the per-player tables this file fights with elsewhere, the Debuffs
// table is keyed by ABILITY, so the top-5-per-player cap does not apply
// (measured: 46 rows for one pull, 72 across a night). One query is complete.
const ENEMY_DEBUFFS_QUERY = (fightIDs) => `
query($code: String!) {
  reportData { report(code: $code) {
    table(fightIDs: [${nums(fightIDs).join(",")}], dataType: Debuffs, hostilityType: Enemies)
  } }
}`;

const PLAIN_TABLE_QUERY = (dataType) => `
query($code: String!, $start: Float!, $end: Float!) {
  reportData { report(code: $code) {
    table(startTime: $start, endTime: $end, dataType: ${dataType})
  } }
}`;

// Same table keyed by ABILITY instead of by player, which is the only view that
// carries `sources` — who actually dealt each ability. Used to tell a boss
// mechanic from a player ability that merely shares its name.
const ABILITY_SOURCES_QUERY = `
query($code: String!, $start: Float!, $end: Float!) {
  reportData { report(code: $code) {
    table(startTime: $start, endTime: $end, dataType: DamageTaken, viewBy: Ability)
  } }
}`;

// Anything interpolated into a query STRING is coerced to a number first, so
// "these are ids we control" is enforced rather than assumed. They already are
// (catalogue keys via .map(Number), and fight ids from WCL), but these builders
// take plain arrays and nothing else stops a caller passing something else.
const nums = (ids) => (ids ?? []).map(Number).filter(Number.isFinite);

// filterExpression is interpolated (not a variable) because WCL parses it
// server-side.
const FILTERED_TABLE_QUERY = (dataType, ids) => `
query($code: String!, $start: Float!, $end: Float!) {
  reportData { report(code: $code) {
    table(startTime: $start, endTime: $end, dataType: ${dataType},
          filterExpression: "ability.id in (${nums(ids).join(", ")})")
  } }
}`;

/** Split ids into batches small enough that the top-5 cap can't bite. */
export function batchIds(ids, size = IDS_PER_BATCH) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** The tracked spell ids whose rule could ever count as avoidable for someone.
 *  Soak/tank/raidwide mechanics are never blamed, so we don't spend a query
 *  asking about them. */
export function avoidableSpellIds(spellIds = RULE_SPELL_IDS) {
  return Object.keys(spellIds).map(Number).filter((id) => {
    const rule = lookupRule(undefined, id);
    return isAvoidableHit(rule, "dps") || isAvoidableHit(rule, "tank");
  });
}

const unwrap = (t) => t?.data ?? t ?? {};

// ---------------------------------------------------------------------------
// Pure aggregation (exported for tests)

/** Deaths per player, split boss vs trash.
 *  A death whose `fight` isn't one of the report's encounter fights happened
 *  on trash. -> Map playerId -> { total, boss, trash }  */
export function deathsByPlayer(deathEntries, encounterFightIds) {
  const enc = encounterFightIds instanceof Set ? encounterFightIds : new Set(encounterFightIds ?? []);
  const out = new Map();
  for (const d of deathEntries ?? []) {
    if (d?.id == null) continue;
    const e = out.get(d.id) ?? { total: 0, boss: 0, trash: 0 };
    e.total += 1;
    if (enc.has(d.fight)) e.boss += 1; else e.trash += 1;
    out.set(d.id, e);
  }
  return out;
}

/** Union of possibly-overlapping intervals -> sorted, disjoint. Needed because
 *  a debuff SLOT can be filled by several spells at once (a balance and a feral
 *  druid both running Faerie Fire), and summing their uptimes would invent
 *  coverage that never happened. */
export function mergeBands(bands) {
  const sorted = [...(bands ?? [])]
    .filter((b) => b && b.endTime > b.startTime)
    .sort((a, b) => a.startTime - b.startTime);
  const out = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (last && b.startTime <= last.endTime) last.endTime = Math.max(last.endTime, b.endTime);
    else out.push({ startTime: b.startTime, endTime: b.endTime });
  }
  return out;
}

const sumBands = (bands) => bands.reduce((n, b) => n + (b.endTime - b.startTime), 0);

/**
 * Raid-debuff coverage over the boss pulls.
 * @param auras      the Debuffs table's `auras` rows ({guid, name, totalUptime, bands})
 * @param totalTime  the table's totalTime = summed boss-pull duration
 * @param comp  the raid as [{class, spec}], so a slot nobody could apply is
 *   reported as "no provider" rather than as a 0% failure. Pass null to skip
 *   the check entirely. A player whose spec didn't resolve counts as a
 *   possible provider — understating a gap is worse than asking about one.
 * -> [{ key, label, effect, core, pct, uptimeMs, spells: [names], hasProvider }]
 */
export function debuffUptimes(auras, totalTime, comp = null, catalogue = RAID_DEBUFFS) {
  const byId = new Map();
  for (const a of auras ?? []) if (a?.guid != null) byId.set(a.guid, a);

  return catalogue.map((slot) => {
    const found = slot.ids.map((id) => byId.get(id)).filter(Boolean);
    // Union across the slot's spells; each row's own bands are already the
    // union across enemy targets (verified: sum(bands) === totalUptime).
    const bands = mergeBands(found.flatMap((a) => a.bands ?? []));
    // Fall back to the largest single totalUptime if bands are ever absent, so
    // a missing field degrades to "understated" rather than to a false zero.
    const uptimeMs = bands.length
      ? sumBands(bands)
      : Math.max(0, ...found.map((a) => a.totalUptime ?? 0));
    const hasProvider = !comp || comp.some((m) =>
      slot.providers.includes(m.class)
      // Unknown spec (no talent data logged) can't disprove the provider.
      && (!slot.specs || !m.spec || slot.specs.includes(m.spec)));
    return {
      key: slot.key,
      label: slot.label,
      effect: slot.effect,
      core: slot.core,
      providers: slot.providers,
      specs: slot.specs ?? null,
      hasProvider,
      uptimeMs,
      pct: totalTime > 0 ? Math.round((uptimeMs / totalTime) * 100) : null,
      spells: found.map((a) => a.name).filter(Boolean),
    };
  });
}

/** Which abilities a hostile unit actually dealt, from a viewBy:Ability table.
 *  -> Map abilityId -> true when any Boss/NPC source dealt it, false when the
 *  only sources were players. Ids absent from the table aren't in the map at
 *  all, and callers treat unknown as allowed — this only ever demotes an
 *  ability we have positive evidence about. */
export function abilityHostility(entries) {
  const out = new Map();
  for (const a of entries ?? []) {
    if (a?.guid == null) continue;
    const sources = a.sources ?? [];
    // No sources at all = boss aura/environment attribution (Watery Grave,
    // Reverberation) — hostile, not a player ability.
    const hostile = sources.length === 0
      || sources.some((s) => s.type === "Boss" || s.type === "NPC");
    out.set(a.guid, out.get(a.guid) || hostile);
  }
  return out;
}

/** Avoidable damage taken, from one fight's DamageTaken table.
 *  Every ability is run through the SAME catalogue the Wipe Autopsy uses, so
 *  "avoidable" means the same thing in both tabs — including the role rule
 *  that frontals (Cleave, Mortal Cleave) are expected on the active tank and
 *  are only blamed on everyone else.
 *  -> Map playerId -> { avoidable, taken, abilities: Map name -> {total, guid} } */
export function avoidableFromDamageTaken(entries, roleById = new Map(), opts = {}) {
  // `skipIds`: ability ids already counted by the filtered batches, so the
  //   unfiltered pass can add name-only matches without double counting.
  // `recordTotal`: only the UNFILTERED table's per-player `total` is genuinely
  //   ALL damage taken; a filtered table's total covers just the ids we asked
  //   for, which would make every non-tank's percentage exactly 100%.
  // `hostileById`: from abilityHostility(). A player's OWN ability must never
  //   be blamed as a boss mechanic just because it shares the name — a
  //   warlock's Hellfire, a mage's Blizzard, a warrior's Cleave/Whirlwind all
  //   collide with catalogue entries and reach the name fallback. This is the
  //   table-side equivalent of mechanics.js's sourceAllowed(). Chain mechanics
  //   (Static Charge, Shatter, Wrath of the Astromancer) propagate FROM players
  //   by design and are always kept.
  const { skipIds = null, recordTotal = false, hostileById = null } = opts;
  const out = new Map();
  for (const p of entries ?? []) {
    if (p?.id == null) continue;
    const role = roleById.get(p.id) ?? null;
    const acc = out.get(p.id) ?? { avoidable: 0, taken: 0, abilities: new Map() };
    if (recordTotal && typeof p.total === "number") acc.taken = p.total;
    for (const a of p.abilities ?? []) {
      if (skipIds && a.guid != null && skipIds.has(a.guid)) continue;
      const total = a.total ?? 0;
      const rule = lookupRule(a.name, a.guid);
      if (!isAvoidableHit(rule, role)) continue;
      if (hostileById && a.guid != null && rule.category !== "chain"
          && hostileById.get(a.guid) === false) continue;
      acc.avoidable += total;
      const key = a.name ?? `#${a.guid}`;
      const prev = acc.abilities.get(key) ?? { total: 0, guid: a.guid ?? null };
      prev.total += total;
      acc.abilities.set(key, prev);
    }
    out.set(p.id, acc);
  }
  return out;
}

/** Invert a SPELL-KEYED credit table into per-player credit.
 *
 *  Both Interrupts and Dispels come back in this shape: keyed by the spell that
 *  was interrupted / dispelled, each with a `details` list of the players who
 *  did it. Neither is keyed by a per-player ability list, so the top-5 cap that
 *  shapes the rest of this file does not apply and one unfiltered whole-report
 *  query is both complete and the cheapest option.
 *
 *  `actors[0]` means DIFFERENT things in the two tables, which is why the label
 *  is a parameter rather than one fixed format (verified live 2026-08-07):
 *    Interrupts — the mob whose cast was stopped:  "Frostbolt (Staff of...)"
 *    Dispels    — the unit the aura came OFF:      "Flame Shock off Bluebrixx"
 *  Printing the dispel one in the interrupt's format would read as "cast by",
 *  i.e. exactly backwards for a friendly cleanse.
 *  -> Map playerId -> { count, spells: Map label -> count } */
export function invertSpellKeyedTable(table, label = (spell, src) => `${spell} (${src})`) {
  const out = new Map();
  // shape: entries: [ { entries: [ { name, details: [...] } ] } ]
  const groups = (table?.entries ?? []).flatMap((g) => g?.entries ?? []);
  for (const spell of groups) {
    const spellName = spell?.name ?? "?";
    for (const d of spell.details ?? []) {
      if (d?.id == null) continue;
      const e = out.get(d.id) ?? { count: 0, spells: new Map() };
      const n = d.total ?? 1;
      e.count += n;
      const src = (d.actors ?? [])[0]?.name;
      // No actor recorded -> the bare spell name, in either table.
      const key = src ? label(spellName, src) : spellName;
      e.spells.set(key, (e.spells.get(key) ?? 0) + n);
      out.set(d.id, e);
    }
  }
  return out;
}

/** Every group a catalogue can produce, seeded at 0, so a player who cast one
 *  thing still has the full shape (`byGroup.bombs === 0`, not undefined) and
 *  callers never have to know which groups a catalogue happens to define. */
function emptyGroups(catalogue) {
  const seed = {};
  for (const v of Object.values(catalogue)) seed[v.group] = 0;
  return seed;
}

/** Count catalogued casts per player, from a Casts table filtered to that
 *  catalogue's ids. Used for two different catalogues — CONSUMABLE_CASTS
 *  (potions, stones, drums) and UTILITY_CASTS (nets, innervates, bombs) — which
 *  is why it takes the catalogue rather than closing over one: each ignores the
 *  other's ids, so one table can be counted into both without cross-talk.
 *  -> Map playerId -> { total, byGroup: {group -> count}, items: Map label -> count } */
export function castCountsByCatalogue(entries, catalogue = CONSUMABLE_CASTS) {
  const out = new Map();
  for (const p of entries ?? []) {
    if (p?.id == null) continue;
    const acc = out.get(p.id)
      ?? { total: 0, byGroup: emptyGroups(catalogue), items: new Map() };
    for (const a of p.abilities ?? []) {
      const known = catalogue[a.guid];
      if (!known) continue; // an id this catalogue doesn't categorise isn't its business
      const n = a.total ?? 0;
      acc.total += n;
      acc.byGroup[known.group] = (acc.byGroup[known.group] ?? 0) + n;
      acc.items.set(known.label, (acc.items.get(known.label) ?? 0) + n);
    }
    out.set(p.id, acc);
  }
  return out;
}

/** Fold one castCountsByCatalogue() result into a running total. Seeds byGroup
 *  from what arrives rather than from a fixed list, so it works for any
 *  catalogue — and so dispels, which arrive from a different query entirely,
 *  fold into the same per-player rows. Exported for that test. */
export function mergeCastCounts(into, add) {
  for (const [id, v] of add) {
    const e = into.get(id) ?? { total: 0, byGroup: {}, items: new Map() };
    e.total += v.total;
    for (const g of Object.keys(v.byGroup)) e.byGroup[g] = (e.byGroup[g] ?? 0) + v.byGroup[g];
    for (const [k, n] of v.items) e.items.set(k, (e.items.get(k) ?? 0) + n);
    into.set(id, e);
  }
  return into;
}

/** Fold a per-fight result Map into a running total Map. */
function mergeAvoidable(into, add) {
  for (const [id, v] of add) {
    const e = into.get(id) ?? { avoidable: 0, taken: 0, abilities: new Map() };
    e.avoidable += v.avoidable;
    // Only the unfiltered pass carries a real total (the others report 0), and
    // jobs finish in any order — so keep the largest rather than summing.
    e.taken = Math.max(e.taken, v.taken);
    for (const [name, ab] of v.abilities) {
      const prev = e.abilities.get(name) ?? { total: 0, guid: ab.guid };
      prev.total += ab.total;
      e.abilities.set(name, prev);
    }
    into.set(id, e);
  }
  return into;
}

function mergeInterrupts(into, add) {
  for (const [id, v] of add) {
    const e = into.get(id) ?? { count: 0, spells: new Map() };
    e.count += v.count;
    for (const [s, n] of v.spells) e.spells.set(s, (e.spells.get(s) ?? 0) + n);
    into.set(id, e);
  }
  return into;
}

/** Re-shape an inverted spell-keyed table into the same {total,byGroup,items}
 *  shape the cast catalogues produce, so dispels can be folded into the utility
 *  totals alongside nets/innervates/bombs/threat despite coming from a
 *  completely different query. The items map keeps what was REMOVED, which is
 *  the useful detail for a dispel (a mage's Spellsteal on Fire Destruction
 *  reads very differently from a paladin cleansing a poison). */
export function dispelsAsUtility(inverted) {
  const out = new Map();
  for (const [id, v] of inverted) {
    out.set(id, { total: v.count, byGroup: { dispels: v.count }, items: new Map(v.spells) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fetchers

/** Whole-night deaths, boss vs trash. One query. */
export async function fetchDeaths(code, reportDurationMs, encounterFightIds) {
  if (!code || !(reportDurationMs > 0)) return new Map();
  const d = await postGraphQL(DEATHS_QUERY, { code, start: 0, end: reportDurationMs });
  const t = unwrap(d.reportData?.report?.table);
  return deathsByPlayer(t.entries, encounterFightIds);
}

/** Raid-debuff uptimes over the boss pulls. One query.
 *  -> { rows, totalTime } or null when it can't be computed. */
export async function fetchDebuffUptimes(code, encounterFightIds, comp = null) {
  const ids = [...(encounterFightIds ?? [])];
  if (!code || !ids.length) return null;
  const d = await postGraphQL(ENEMY_DEBUFFS_QUERY(ids), { code });
  const t = unwrap(d.reportData?.report?.table);
  if (!t || !(t.totalTime > 0)) return null;
  return { rows: debuffUptimes(t.auras, t.totalTime, comp), totalTime: t.totalTime };
}

const deepCache = new Map(); // code -> deep stats (session-only; it's expensive)

/**
 * Per-player avoidable damage, interrupts, consumables and raid utility for the
 * WHOLE night, trash included. Opt-in: ~26 filtered queries against a shared
 * rate limit.
 * -> { avoidable, interrupts, consumables, utility: Map id->{...}, queries, failed }
 */
export async function fetchDeepStats(code, reportDurationMs, roleById = new Map(), onProgress = () => {}) {
  if (deepCache.has(code)) return deepCache.get(code);
  if (!code || !(reportDurationMs > 0)) {
    return {
      avoidable: new Map(), interrupts: new Map(), consumables: new Map(),
      utility: new Map(), queries: 0, failed: 0,
    };
  }
  const vars = { code, start: 0, end: reportDurationMs };
  const avoidable = new Map();
  const interrupts = new Map();
  const consumables = new Map();
  const utility = new Map();

  // Each job is one query. Interrupts needs no filter — its table is keyed by
  // the interrupted spell, not by a per-player ability list, so the top-5 cap
  // doesn't apply and one whole-report query is both complete and cheapest.
  const trackedIds = avoidableSpellIds();
  const trackedSet = new Set(trackedIds);

  // Who dealt what, fetched first because the unfiltered pass below needs it to
  // reject players' own abilities. One query; on failure we get an empty map and
  // fall back to the previous (unguarded) behaviour rather than losing the scan.
  const hostileById = await postGraphQL(ABILITY_SOURCES_QUERY, vars)
    .then((r) => abilityHostility(unwrap(r.reportData?.report?.table).entries))
    .catch(() => new Map());

  const jobs = [
    { query: PLAIN_TABLE_QUERY("Interrupts"),
      apply: (t) => mergeInterrupts(interrupts, invertSpellKeyedTable(t)) },
    // Dispels ride the same spell-keyed shape as Interrupts, so one unfiltered
    // query covers the night. Counting the TABLE rather than dispel casts means
    // these are dispels that actually landed — a Cleanse that removed nothing
    // isn't credited. It counts offensive purges (Spellsteal, Purge, a warrior's
    // Shield Slam) alongside friendly cleanses; the tooltip names what was
    // removed, so the two stay tellable apart.
    { query: PLAIN_TABLE_QUERY("Dispels"),
      apply: (t) => mergeCastCounts(utility, dispelsAsUtility(
        invertSpellKeyedTable(t, (spell, target) => `${spell} off ${target}`))) },
    // One UNFILTERED DamageTaken table, doing two jobs the filtered batches
    // can't. (a) Its per-player `total` is all damage taken — the honest
    // denominator for the avoidable %. (b) Its top-5 rows still resolve by
    // NAME, which recovers catalogued mechanics that have no harvested spell
    // id yet (Shadow Nova, Void Zone, Flame Quills…); ids already covered by
    // the batches are skipped so nothing is counted twice.
    { query: PLAIN_TABLE_QUERY("DamageTaken"),
      apply: (t) => mergeAvoidable(avoidable,
        avoidableFromDamageTaken(t.entries, roleById,
          { skipIds: trackedSet, recordTotal: true, hostileById })) },
    ...batchIds(trackedIds).map((ids) => ({
      query: FILTERED_TABLE_QUERY("DamageTaken", ids),
      apply: (t) => mergeAvoidable(avoidable, avoidableFromDamageTaken(t.entries, roleById)),
    })),
    // Consumables and raid utility are both Casts tables filtered by ability id,
    // so they share ONE pool of batches instead of running two sets: each table
    // is counted into both catalogues, and each catalogue ignores the other's
    // ids. Batching the pools together rather than separately also avoids a
    // half-empty trailing batch per pool — 42 ids cost 11 queries this way, 12
    // as two pools.
    ...batchIds([...CONSUMABLE_CAST_IDS, ...UTILITY_CAST_IDS]).map((ids) => ({
      query: FILTERED_TABLE_QUERY("Casts", ids),
      apply: (t) => {
        mergeCastCounts(consumables, castCountsByCatalogue(t.entries, CONSUMABLE_CASTS));
        mergeCastCounts(utility, castCountsByCatalogue(t.entries, UTILITY_CASTS));
      },
    })),
  ];

  let done = 0;
  let failed = 0;
  for (let i = 0; i < jobs.length; i += STATS_CONCURRENCY) {
    await Promise.all(jobs.slice(i, i + STATS_CONCURRENCY).map(async (job) => {
      // One bad batch must not sink the night: count it and carry on, so the
      // card can say how complete the numbers are.
      const r = await postGraphQL(job.query, vars).catch(() => null);
      if (!r) failed += 1;
      else job.apply(unwrap(r.reportData?.report?.table));
      done += 1;
      onProgress(done, jobs.length);
    }));
  }

  // +1 for the ability-sources query above, which the card counts too.
  const result = { avoidable, interrupts, consumables, utility, queries: jobs.length + 1, failed };
  // Only a COMPLETE scan is cached. Caching a degraded one would pin the
  // missing numbers for the whole session: the early return above would hand
  // the same short totals back to every retry without issuing a query, and a
  // rate-limited first attempt could never be recovered from.
  if (!failed) deepCache.set(code, result);
  return result;
}

/** Test seam / "re-analyse" support. */
export function clearDeepCache(code) {
  if (code) deepCache.delete(code); else deepCache.clear();
}
