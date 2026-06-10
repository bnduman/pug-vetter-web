// Live smoke test of the client-side modules under Node (which has fetch but
// no CORS restrictions — CORS itself was verified separately against the API).
// Usage: node test/smoke.mjs [name]
import { vet } from "../js/vet.js";

const name = process.argv[2] ?? "sahmeran";
const d = await vet(name);

console.log(`${d.name} @ ${d.realm}-${d.region} | found=${d.found}`);
if (!d.found) process.exit(0);

for (const r of d.raids) {
  const bp = r.best_parse == null ? "-" : r.best_parse.toFixed(1);
  console.log(`  ${r.name.padEnd(24)} ${r.cleared}/${r.total}  perf avg ${bp} [${r.tier}]`);
}
const e = d.enchants;
if (e) {
  console.log(`enchants: missing ${e.missing_required} | ilvl ${e.avg_item_level} | gems ${e.gems_total}`);
  for (const s of e.slots) console.log(`  [${s.status.padEnd(9)}] ${s.slot.padEnd(9)} ${s.enchant ?? ""}`);
}

// Hard assertions: the scorecard shape the UI depends on.
const fail = (msg) => { console.error("SMOKE FAIL:", msg); process.exit(1); };
if (!Array.isArray(d.raids) || !d.raids.length) fail("no raids array");
for (const r of d.raids) {
  for (const k of ["name", "cleared", "total", "best_parse", "tier", "color"]) {
    if (!(k in r)) fail(`raid missing key ${k}`);
  }
}
if (e && e.slots.some((s) => s.status === "enchanted" && !s.enchant)) fail("enchanted slot without a name");
console.log("\nSMOKE OK");
