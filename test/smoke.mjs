// Live smoke test of the client-side modules under Node (which has fetch but
// no CORS restrictions — CORS itself was verified separately against the API).
// Usage: node test/smoke.mjs [name]
import { CONFIG } from "../js/config.js";
import { getAttendanceMap, getCoraidMap } from "../js/attendance.js";
import { vet } from "../js/vet.js";

const explicitName = process.argv[2];
const name = explicitName ?? "sahmeran";
const d = await vet(name);

console.log(`${d.name} @ ${d.realm}-${d.region} | found=${d.found}`);
console.log(`WCL:    ${d.wclUrl}`);
console.log(`Armory: ${d.armoryUrl}`);
if (!d.found) {
  // A missing default character means the lookup itself is broken -> fail.
  // An explicitly-requested name that doesn't exist is a valid outcome.
  if (!explicitName) { console.error("SMOKE FAIL: default character not found — lookup likely broken"); process.exit(1); }
  console.log("(explicitly-requested character not found — ok)");
  process.exit(0);
}

console.log(`class=${d.class} specs=${(d.specs || []).join("/")} role=${d.role} | GearScore=${d.gearscore} | gear sets=${(d.gearSets || []).length}`);
for (const s of d.gearSets || []) {
  console.log(`  set: ${s.role}/${s.spec} GS=${s.gearscore} ilvl=${s.ilvl} items=${s.gear.length} from ${new Date(s.lastLog).toISOString().slice(0, 10)}`);
}
for (const r of d.raids) {
  const bp = r.best_parse == null ? "-" : r.best_parse.toFixed(1);
  console.log(`  ${r.name.padEnd(24)} ${r.cleared}/${r.total}  perf avg ${bp} [${r.tier}]`);
}
const e = d.enchants;
if (e) {
  console.log(`enchants: missing ${e.missing_required} | ilvl ${e.avg_item_level}`
    + ` | gems ${e.gems_total}/${e.sockets_total} sockets (${e.empty_sockets} empty)`);
}
if (d.gear) {
  console.log(`gear: ${d.gear.length} items`);
  for (const g of d.gear) {
    const gems = g.sockets
      ? `  [${"◆".repeat(g.gems.length)}${"◇".repeat(g.emptySockets)}]`
      : "";
    const ench = g.enchant ? `  ench: ${g.enchant}` : (g.enchantable ? "  ench: NONE" : "");
    console.log(`  ${g.slotLabel.padEnd(10)} ${String(g.itemLevel).padStart(3)}  ${g.name}${gems}${ench}`);
  }
}

// Hard assertions: the scorecard shape the UI depends on.
const fail = (msg) => { console.error("SMOKE FAIL:", msg); process.exit(1); };
if (!/^https:\/\/classic\.warcraftlogs\.com\/character\/[a-z]+\/[a-z0-9-]+\/.+/.test(d.wclUrl || "")) {
  fail(`bad WCL profile url: ${d.wclUrl}`);
}
if (!/^https:\/\/classic-armory\.org\/character\/[a-z]+\/[a-z0-9-]+\/[a-z0-9-]+\/.+/.test(d.armoryUrl || "")) {
  fail(`bad Armory profile url: ${d.armoryUrl}`);
}
if (!Array.isArray(d.raids) || !d.raids.length) fail("no raids array");
for (const r of d.raids) {
  for (const k of ["name", "cleared", "total", "best_parse", "tier", "color"]) {
    if (!(k in r)) fail(`raid missing key ${k}`);
  }
}
if (!d.class) fail("no class resolved");
if (e) {
  if (e.sockets_total < e.gems_total) fail("sockets_total < gems_total");
  if (e.empty_sockets !== e.sockets_total - e.gems_total) fail("empty socket math wrong");
}
for (const set of d.gearSets || []) {
  if (!set.gear.length) fail("gear set empty");
  for (const g of set.gear) {
    if (!g.name || g.quality == null) fail(`gear item missing name/quality: ${JSON.stringify(g)}`);
    if (g.emptySockets < 0) fail("negative empty sockets");
  }
  if (set.gearscore == null || set.gearscore < 300 || set.gearscore > 5000) {
    fail(`implausible GearScore: ${set.gearscore}`);
  }
  // per-item scores must sum to the set total
  const sum = set.gear.reduce((n, g) => n + (g.gs ?? 0), 0);
  if (sum !== set.gearscore) fail(`per-item gs sum ${sum} != set total ${set.gearscore}`);
}
// one gear set per ROLE (no duplicate sets for the same role)
const rolesSeen = (d.gearSets || []).map((s) => s.role);
if (new Set(rolesSeen).size !== rolesSeen.length) fail(`duplicate role gear sets: ${rolesSeen}`);
// header GearScore is the best of the sets
if (d.gearSets?.length) {
  const best = Math.max(...d.gearSets.map((s) => s.gearscore ?? 0));
  if (d.gearscore !== best) fail(`header GS ${d.gearscore} != best set ${best}`);
}

// Guild attendance (only when a guild is configured).
if (CONFIG.GUILD_NAME) {
  const map = await getAttendanceMap();
  if (!map) fail(`guild "${CONFIG.GUILD_NAME}" not found on WCL`);
  const players = Object.values(map.players);
  if (!players.length) fail("attendance map empty");
  const regulars = players.filter((p) => p.count >= 2)
    .sort((a, b) => b.count - a.count).slice(0, 5);
  console.log(`\nattendance: ${map.reportsScanned} reports, ${players.length} distinct players`);
  console.log("top regulars: " + regulars.map((p) => `${p.name}(${p.count})`).join(", "));
  const me = map.players[name.toLowerCase()];
  console.log(`${d.name} appears in ${map.guildName} logs: ${me ? me.count + "x" : "never"}`);

  // Co-raid map: shared raids with the configured ME_NAME.
  const co = await getCoraidMap();
  if (!co) fail("co-raid map null");
  if (!co.mePresent) fail(`ME_NAME "${CONFIG.ME_NAME}" not found in guild logs`);
  console.log(`\n${co.meName} has ${co.meRaidCount} logged raids; `
    + `${Object.keys(co.players).length} players have raided with them`);
  const regs = Object.values(co.players).filter((p) => p.withMe >= 2)
    .sort((a, b) => b.withMe - a.withMe).slice(0, 5);
  console.log("top co-raiders: " + regs.map((p) => `${p.name}(${p.withMe})`).join(", "));
  // Invariants: shared count matches, never exceeds my raid count, codes present.
  for (const p of Object.values(co.players)) {
    if (p.shared.length !== p.withMe) fail(`${p.name}: shared != withMe`);
    if (p.withMe > co.meRaidCount) fail(`${p.name}: withMe ${p.withMe} > my ${co.meRaidCount}`);
    if (p.shared.some((r) => !r.code || !r.ts)) fail(`${p.name}: shared raid missing code/ts`);
  }
  if (co.players[CONFIG.ME_NAME.toLowerCase()]) fail("ME should not list itself as a co-raider");
}
console.log("\nSMOKE OK");
