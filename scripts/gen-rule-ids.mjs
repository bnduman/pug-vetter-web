"use strict";
// Regenerate js/csi/rule-ids.js — the spell-ID -> mechanic-catalogue-key map.
//
// Harvests real ability game IDs from recent live Anniversary reports: for each
// active raid zone, pull public reports, and for each boss encounter query the
// per-encounter DamageTaken table (viewBy: Ability). Any ability whose name
// matches a catalogue key in js/csi/rules.js contributes its game ID.
//
// Player-sourced doppelgangers (a warlock's own Hellfire, engineering sappers)
// are rejected by source type — an ID is only accepted if a Boss/NPC dealt the
// damage. Chain mechanics are the exception: their damage propagates FROM
// friendly players by design, so any source is accepted for those.
//
// Usage: node scripts/gen-rule-ids.mjs      (rerun when a new tier unlocks,
// then eyeball the js/csi/rule-ids.js diff and run npm test)
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { postGraphQL } from "../js/wcl.js";
import { getRaidZones } from "../js/zones.js";
import { RULES } from "../js/csi/rules.js";

const REPORTS_PER_ZONE = 16;
const COVERAGE_TARGET = 3; // stop querying an encounter once seen in N reports
const TABLE_CONCURRENCY = 4;

const REPORTS_QUERY = `
query($zoneID: Int!, $limit: Int!) {
  reportData { reports(zoneID: $zoneID, limit: $limit) { data { code } } }
}`;

const FIGHTS_QUERY = `
query($code: String!) {
  reportData { report(code: $code) {
    fights(killType: Encounters) { id name encounterID startTime endTime }
  } }
}`;

const TABLE_QUERY = `
query($code: String!, $fightIDs: [Int]!, $start: Float!, $end: Float!) {
  reportData { report(code: $code) {
    table(fightIDs: $fightIDs, startTime: $start, endTime: $end,
          dataType: DamageTaken, hostilityType: Friendlies, viewBy: Ability)
  } }
}`;

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

// Empty sources = aura/environment attribution (Watery Grave, Reverberation);
// player-cast damage always carries the player as a source, so empty is safe.
const hostileSourced = (entry) => {
  const sources = entry.sources ?? [];
  return sources.length === 0 || sources.some((s) => s.type === "Boss" || s.type === "NPC");
};

// The Chess Event's piece abilities (Cleave, Geyser, Hellfire...) share names
// with real boss mechanics; keep them out of the ID map.
const EXCLUDED_ENCOUNTERS = new Set(["Chess Event"]);

// id -> { key, encounters: Set, reports: Set }
const accepted = new Map();
// id -> "name [source types] (encounter)", for the rejection log
const rejected = new Map();
const coverage = new Map(); // encounterID -> Set<report code>

function processEntries(entries, bossName, code) {
  for (const e of entries) {
    if (typeof e.guid !== "number" || e.guid < 10) continue; // melee/falling pseudo-abilities
    const key = (e.name ?? "").toLowerCase();
    const rule = RULES[key];
    if (!rule) continue;
    if (!hostileSourced(e) && rule.category !== "chain") {
      const types = [...new Set((e.sources ?? []).map((s) => s.type))].join(",");
      rejected.set(e.guid, `${e.name} [${types}] (${bossName})`);
      continue;
    }
    let rec = accepted.get(e.guid);
    if (!rec) accepted.set(e.guid, (rec = { key, encounters: new Set(), reports: new Set() }));
    rec.encounters.add(bossName);
    rec.reports.add(code);
  }
}

let reportsUsed = 0;
const zones = await getRaidZones();
console.log(`zones: ${zones.map((z) => `${z.id} ${z.name}`).join(" | ")}`);

for (const zone of zones) {
  const rd = await postGraphQL(REPORTS_QUERY, { zoneID: zone.id, limit: REPORTS_PER_ZONE });
  const codes = (rd.reportData?.reports?.data ?? []).map((r) => r.code);
  console.log(`\nzone ${zone.name}: ${codes.length} reports`);

  for (const code of codes) {
    const fd = await postGraphQL(FIGHTS_QUERY, { code });
    const fights = fd.reportData?.report?.fights ?? [];
    const byEnc = new Map();
    for (const f of fights) {
      if (!f.encounterID || EXCLUDED_ENCOUNTERS.has(f.name)) continue;
      if (!byEnc.has(f.encounterID)) byEnc.set(f.encounterID, []);
      byEnc.get(f.encounterID).push(f);
    }
    const needed = [...byEnc.entries()].filter(
      ([encId]) => (coverage.get(encId)?.size ?? 0) < COVERAGE_TARGET);
    if (!needed.length) continue;
    reportsUsed += 1;

    await mapLimit(needed, TABLE_CONCURRENCY, async ([encId, group]) => {
      const td = await postGraphQL(TABLE_QUERY, {
        code,
        fightIDs: group.map((f) => f.id),
        start: Math.min(...group.map((f) => f.startTime)),
        end: Math.max(...group.map((f) => f.endTime)),
      });
      const entries = (td.reportData?.report?.table?.data ?? {}).entries ?? [];
      processEntries(entries, group[0].name, code);
      if (!coverage.has(encId)) coverage.set(encId, new Set());
      coverage.get(encId).add(code);
    });
    const done = [...coverage.values()].filter((s) => s.size >= COVERAGE_TARGET).length;
    console.log(`  ${code}: ${needed.length} encounters queried (${done}/${coverage.size} at target)`);
  }
}

// ---- merge with the previous generation ----
// Weekly-rotating bosses (Opera) drop out of the recent-report window, so
// carry forward previously harvested IDs we couldn't observe this run —
// unless this run rejected them or their catalogue key is gone.
let carried = 0;
try {
  const previous = (await import("../js/csi/rule-ids.js")).RULE_SPELL_IDS ?? {};
  for (const [idStr, key] of Object.entries(previous)) {
    const id = Number(idStr);
    if (accepted.has(id) || rejected.has(id) || !RULES[key]) continue;
    accepted.set(id, { key, encounters: new Set(), reports: new Set() });
    carried += 1;
  }
} catch { /* first generation — nothing to merge */ }

// ---- emit js/csi/rule-ids.js ----
const rows = [...accepted.entries()]
  .map(([id, r]) => ({ id, ...r }))
  .sort((a, b) => a.key.localeCompare(b.key) || a.id - b.id);

const lines = rows.map((r) => {
  const src = r.reports.size
    ? `${[...r.encounters].join(", ")} · ${r.reports.size} report${r.reports.size > 1 ? "s" : ""}`
    : "carried from a previous harvest";
  return `  ${r.id}: ${JSON.stringify(r.key)}, // ${src}`;
});

const encountersSeen = coverage.size;
const stamp = new Date().toISOString().slice(0, 10);
const body = `"use strict";
// AUTO-GENERATED by scripts/gen-rule-ids.mjs — do not edit by hand.
// Ability game ID -> mechanic-catalogue key (see RULES in rules.js), harvested
// from per-encounter DamageTaken tables of ${reportsUsed} live Anniversary reports
// (${encountersSeen} encounters) on ${stamp}. IDs are the primary lookup; name matching
// stays as the fallback for ranks/bosses not present in the harvested logs.
export const RULE_SPELL_IDS = {
${lines.join("\n")}
};
`;

const outPath = fileURLToPath(new URL("../js/csi/rule-ids.js", import.meta.url));
await writeFile(outPath, body);

// ---- summary ----
const keysWithIds = new Set(rows.map((r) => r.key));
console.log(`\nwrote ${rows.length} IDs (${carried} carried over) covering ${keysWithIds.size}/${Object.keys(RULES).length} catalogue entries -> js/csi/rule-ids.js`);
const missing = Object.keys(RULES).filter((k) => !keysWithIds.has(k));
if (missing.length) console.log(`no ID harvested (name fallback only): ${missing.join(", ")}`);
const trulyRejected = [...rejected].filter(([id]) => !accepted.has(id));
if (trulyRejected.length) {
  console.log("rejected as player-sourced:");
  for (const [id, detail] of trulyRejected) console.log(`  ${id} ${detail}`);
}
