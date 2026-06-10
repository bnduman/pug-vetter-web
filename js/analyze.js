// Pure functions that turn raw Warcraft Logs JSON into a vetting scorecard.
// Direct port of the Python app/analyze.py (behavior kept identical).
import { ENCHANT_NAMES } from "./enchant-names.js";
import { ENCHANT_SLOTS, NON_ILVL_SLOTS } from "./enchant-rules.js";

export function parseColor(pct) {
  if (pct == null) return { tier: "none", color: "#6b6b6b" };
  const p = Math.round(pct);
  if (p >= 100) return { tier: "artifact", color: "#e5cc80" };
  if (p >= 99) return { tier: "astounding", color: "#e268a8" };
  if (p >= 95) return { tier: "legendary", color: "#ff8000" };
  if (p >= 75) return { tier: "epic", color: "#a335ee" };
  if (p >= 50) return { tier: "rare", color: "#0070ff" };
  if (p >= 25) return { tier: "uncommon", color: "#1eff00" };
  return { tier: "common", color: "#9d9d9d" };
}

// Reduce a zoneRankings blob to {name, cleared, total, best_parse, encounters}.
// Tolerates the {"error": "..."} blob WCL returns for an unsupported zone.
export function summarizeZone(zoneName, zoneRankings) {
  const base = { name: zoneName, cleared: 0, total: 0, best_parse: null, encounters: [] };
  if (!zoneRankings || typeof zoneRankings !== "object" || !("rankings" in zoneRankings)) {
    return base;
  }
  const encounters = [];
  const parses = [];
  let cleared = 0;
  for (const r of zoneRankings.rankings ?? []) {
    if (!r || typeof r !== "object") continue;
    const kills = r.totalKills ?? 0;
    let rp = r.rankPercent;
    if (typeof rp !== "number") rp = null; // WCL uses "-" for unranked
    if (kills > 0) cleared += 1;
    if (rp != null) parses.push(rp);
    encounters.push({ name: r.encounter?.name ?? "?", kills, parse: rp });
  }
  let best = zoneRankings.bestPerformanceAverage;
  if (typeof best !== "number") best = parses.length ? Math.max(...parses) : null;
  return { ...base, cleared, total: encounters.length, best_parse: best, encounters };
}

// Locate a character's gear array inside a playerDetails blob, or null.
// WCL wraps the payload as {"data": {"playerDetails": {tanks, healers, dps}}}.
export function findPlayerGear(playerDetails, charName) {
  let pd = playerDetails;
  if (pd && typeof pd === "object" && pd.data && typeof pd.data === "object") {
    pd = pd.data.playerDetails ?? pd;
  }
  if (!pd || typeof pd !== "object" || Array.isArray(pd)) return null;
  const target = (charName ?? "").toLowerCase();
  for (const role of ["tanks", "healers", "dps"]) {
    for (const player of pd[role] ?? []) {
      if ((player.name ?? "").toLowerCase() === target) {
        return player.combatantInfo?.gear ?? [];
      }
    }
  }
  return null;
}

// Collapse the gear array to one item per slot (it can contain several fights'
// worth of gear); keep the highest-item-level entry per slot.
function gearBySlot(gear) {
  const best = new Map();
  for (const item of gear ?? []) {
    if (!item || typeof item !== "object" || item.slot == null) continue;
    const cur = best.get(item.slot);
    if (!cur || (item.itemLevel ?? 0) > (cur.itemLevel ?? 0)) best.set(item.slot, item);
  }
  return best;
}

// WCL lists socketed gems but NOT empty sockets — a "did they gem" signal.
const gemCount = (item) => (item?.gems?.length ?? 0);

export function analyzeEnchants(gear) {
  const bySlot = gearBySlot(gear);
  const slots = [];
  let missingRequired = 0;
  for (const rule of ENCHANT_SLOTS) {
    const item = bySlot.get(rule.slot);
    const gems = gemCount(item);
    if (!item || !item.id) {
      slots.push({ slot: rule.label, status: "empty", enchant: null, gems, required: rule.required });
      continue;
    }
    const enchId = item.permanentEnchant ?? 0;
    if (enchId) {
      // Client-DB name first: WCL's permanentEnchantName is retail-mangled.
      const name = ENCHANT_NAMES[enchId] ?? item.permanentEnchantName ?? `#${enchId}`;
      slots.push({ slot: rule.label, status: "enchanted", enchant: name, gems, required: rule.required });
    } else {
      slots.push({ slot: rule.label, status: "missing", enchant: null, gems, required: rule.required });
      if (rule.required) missingRequired += 1;
    }
  }

  const ilvls = [];
  for (const [slot, item] of bySlot) {
    if (NON_ILVL_SLOTS.has(slot) || !item.id) continue;
    if (item.itemLevel && item.itemLevel > 1) ilvls.push(item.itemLevel);
  }
  const avgIlvl = ilvls.length
    ? Math.round((ilvls.reduce((a, b) => a + b, 0) / ilvls.length) * 10) / 10
    : null;

  let gemsTotal = 0;
  for (const item of bySlot.values()) gemsTotal += gemCount(item);

  return { slots, missing_required: missingRequired, avg_item_level: avgIlvl, gems_total: gemsTotal };
}
