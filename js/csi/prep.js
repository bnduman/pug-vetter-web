"use strict";
// Per-pull raid prep: a per-player enchant check (who's missing what) and
// flask/food/drums coverage counts. Reuses the PuG Vetter enchant logic.
import { analyzeEnchants } from "../analyze.js";

function unwrapPlayerDetails(pd) {
  if (pd && typeof pd === "object" && pd.data && typeof pd.data === "object") {
    return pd.data.playerDetails ?? pd;
  }
  return pd ?? {};
}

/**
 * Per-player enchant status from combatantInfo gear. Returns
 * { players:[{name, role, missingCount, missing:[slotLabel]}], covered, total }.
 * `covered` counts players we actually had gear for (combat info can be absent).
 */
export function raidEnchants(playerDetails) {
  const pd = unwrapPlayerDetails(playerDetails);
  const players = [];
  let total = 0;
  let covered = 0;
  for (const [bucket, role] of [["tanks", "tank"], ["healers", "healer"], ["dps", "dps"]]) {
    for (const p of pd[bucket] ?? []) {
      total += 1;
      const gear = p.combatantInfo?.gear ?? [];
      if (!gear.length) continue; // no combat info for this player/pull
      covered += 1;
      const en = analyzeEnchants(gear);
      const missing = en.slots.filter((s) => s.status === "missing" && s.required).map((s) => s.slot);
      players.push({ name: p.name, role, missingCount: en.missing_required, missing });
    }
  }
  players.sort((a, b) => b.missingCount - a.missingCount || a.name.localeCompare(b.name));
  return { players, covered, total };
}

// Consumable buff name -> bucket. Flasks and the "Well Fed" food buff are the
// high-value ones; Drums of Battle is a raid-cooldown worth tracking.
const CONSUMABLE_BUCKETS = [
  { key: "flask", label: "Flasks", re: /^flask of/i },
  { key: "food", label: "Food", re: /well fed/i },
  { key: "drums", label: "Drums", re: /^drums of battle/i },
];

/**
 * Flask/food/drums coverage from the Buffs table (per-aura totals). Returns
 * { flask, food, drums, raidSize }, each capped at raidSize.
 */
export function raidConsumables(buffsTable, raidSize) {
  const data = buffsTable?.data ?? buffsTable ?? {};
  const auras = data.auras ?? [];
  const tally = { flask: 0, food: 0, drums: 0 };
  for (const a of auras) {
    const name = a.name ?? "";
    const users = a.totalUses ?? 0;
    const bucket = CONSUMABLE_BUCKETS.find((b) => b.re.test(name));
    if (bucket) tally[bucket.key] += users;
  }
  const cap = (n) => (raidSize ? Math.min(n, raidSize) : n);
  return { flask: cap(tally.flask), food: cap(tally.food), drums: cap(tally.drums), raidSize };
}

export { CONSUMABLE_BUCKETS };
