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
//   DEEP (2 queries per boss pull, opt-in): avoidable damage taken per
//   player and interrupts. These MUST be fetched per fight and summed here:
//   a whole-report DamageTaken table silently TRUNCATES. Measured on the same
//   report: whole-report returned 22 distinct abilities, while the first 6
//   encounters queried individually summed to 41 — Scalding Water, Spout,
//   Flame Patch, Falling and 29 others were missing with no error. Building
//   on the aggregate would have shown confident, badly wrong numbers.
import { postGraphQL } from "./wcl.js";
import { isAvoidableHit, lookupRule } from "./csi/rules.js";

// Boss pulls fetched at once. Kept low: these tables are the heaviest query
// the app makes, and the WCL key's rate limit is shared by every visitor.
const STATS_CONCURRENCY = 4;

const DEATHS_QUERY = `
query($code: String!, $start: Float!, $end: Float!) {
  reportData { report(code: $code) {
    table(startTime: $start, endTime: $end, dataType: Deaths)
  } }
}`;

const FIGHT_TABLE_QUERY = (dataType) => `
query($code: String!, $start: Float!, $end: Float!) {
  reportData { report(code: $code) {
    table(startTime: $start, endTime: $end, dataType: ${dataType})
  } }
}`;

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

/** Avoidable damage taken, from one fight's DamageTaken table.
 *  Every ability is run through the SAME catalogue the Wipe Autopsy uses, so
 *  "avoidable" means the same thing in both tabs — including the role rule
 *  that frontals (Cleave, Mortal Cleave) are expected on the active tank and
 *  are only blamed on everyone else.
 *  -> Map playerId -> { avoidable, taken, abilities: Map name -> {total, guid} } */
export function avoidableFromDamageTaken(entries, roleById = new Map()) {
  const out = new Map();
  for (const p of entries ?? []) {
    if (p?.id == null) continue;
    const role = roleById.get(p.id) ?? null;
    const acc = out.get(p.id) ?? { avoidable: 0, taken: 0, abilities: new Map() };
    for (const a of p.abilities ?? []) {
      const total = a.total ?? 0;
      acc.taken += total;
      const rule = lookupRule(a.name, a.guid);
      if (!isAvoidableHit(rule, role)) continue;
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

/** Interrupts from one fight's Interrupts table. The table is keyed by the
 *  INTERRUPTED spell, with a `details` list of who interrupted it, so this
 *  inverts it to per-interrupter.
 *  -> Map playerId -> { count, spells: Map "Spell (Source)" -> count } */
export function interruptsFromTable(table) {
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
      const label = src ? `${spellName} (${src})` : spellName;
      e.spells.set(label, (e.spells.get(label) ?? 0) + n);
      out.set(d.id, e);
    }
  }
  return out;
}

/** Fold a per-fight result Map into a running total Map. */
function mergeAvoidable(into, add) {
  for (const [id, v] of add) {
    const e = into.get(id) ?? { avoidable: 0, taken: 0, abilities: new Map() };
    e.avoidable += v.avoidable;
    e.taken += v.taken;
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

// ---------------------------------------------------------------------------
// Fetchers

/** Whole-night deaths, boss vs trash. One query. */
export async function fetchDeaths(code, reportDurationMs, encounterFightIds) {
  if (!code || !(reportDurationMs > 0)) return new Map();
  const d = await postGraphQL(DEATHS_QUERY, { code, start: 0, end: reportDurationMs });
  const t = unwrap(d.reportData?.report?.table);
  return deathsByPlayer(t.entries, encounterFightIds);
}

const deepCache = new Map(); // code -> deep stats (session-only; it's expensive)

/**
 * Per-player avoidable damage + interrupts across the night's BOSS pulls.
 * Expensive by nature (2 queries per pull) — call it only from an explicit
 * user action, and report progress.
 * -> { avoidable: Map id->{...}, interrupts: Map id->{...}, fightsScanned, failed }
 */
export async function fetchDeepStats(code, fights, roleById = new Map(), onProgress = () => {}) {
  if (deepCache.has(code)) return deepCache.get(code);
  const list = (fights ?? []).filter((f) => f && f.startTime != null && f.endTime != null);
  const avoidable = new Map();
  const interrupts = new Map();
  let done = 0;
  let failed = 0;

  const DT = FIGHT_TABLE_QUERY("DamageTaken");
  const IT = FIGHT_TABLE_QUERY("Interrupts");

  for (let i = 0; i < list.length; i += STATS_CONCURRENCY) {
    const batch = list.slice(i, i + STATS_CONCURRENCY);
    await Promise.all(batch.map(async (f) => {
      const vars = { code, start: f.startTime, end: f.endTime };
      // One bad pull must not sink the night: count it and carry on, so the
      // card can say how complete the numbers are.
      const [dt, it] = await Promise.all([
        postGraphQL(DT, vars).catch(() => null),
        postGraphQL(IT, vars).catch(() => null),
      ]);
      if (!dt || !it) failed += 1;
      if (dt) {
        const t = unwrap(dt.reportData?.report?.table);
        mergeAvoidable(avoidable, avoidableFromDamageTaken(t.entries, roleById));
      }
      if (it) {
        const t = unwrap(it.reportData?.report?.table);
        mergeInterrupts(interrupts, interruptsFromTable(t));
      }
      done += 1;
      onProgress(done, list.length);
    }));
  }

  const result = { avoidable, interrupts, fightsScanned: list.length, failed };
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
