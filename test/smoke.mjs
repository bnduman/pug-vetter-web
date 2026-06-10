// Live smoke test of the client-side modules under Node (which has fetch but
// no CORS restrictions — CORS itself was verified separately against the API).
// Usage: node test/smoke.mjs [name]
import { vet } from "../js/vet.js";

const name = process.argv[2] ?? "sahmeran";
const d = await vet(name);

console.log(`${d.name} @ ${d.realm}-${d.region} | found=${d.found}`);
if (!d.found) process.exit(0);

console.log(`class=${d.class} spec=${d.spec} role=${d.role}`);
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
if (d.gear) {
  if (!d.gear.length) fail("gear list empty");
  for (const g of d.gear) {
    if (!g.name || g.quality == null) fail(`gear item missing name/quality: ${JSON.stringify(g)}`);
    if (g.emptySockets < 0) fail("negative empty sockets");
  }
}
console.log("\nSMOKE OK");
