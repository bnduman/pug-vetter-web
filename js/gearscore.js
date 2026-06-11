// GearScore — the classic single-number gear summary, computed with the
// original GearScoreLite formula and constants (verbatim from the addon:
// https://github.com/warmane-wotlk/GearScoreLite) so the numbers match what
// players know from armory sites and the in-game addon.
//
// Per item: floor(((itemLevel - A) / B) * SlotMod * 1.8618 * qualityScale)
//   - constants A/B depend on quality, with a different table above ilvl 120
//   - legendaries score as epic * 1.3; grey/white items are worth ~nothing
//   - hunters: ranged weapon weighted up (5.3224), melee down (0.3164)
import { ITEM_2H } from "./item-2h.js";

// WCL gear-slot index -> GearScoreLite SlotMOD. Shirt (3) and tabard (18)
// score 0 and are skipped. Off-hand weapons/shields/holdables all share 1.0,
// and all ranged/relic types share 0.3164, so only the main hand needs the
// 1H-vs-2H distinction (via ITEM_2H).
const SLOT_MODS = {
  0: 1.0,    // Head
  1: 0.5625, // Neck
  2: 0.75,   // Shoulder
  4: 1.0,    // Chest
  5: 0.75,   // Waist
  6: 1.0,    // Legs
  7: 0.75,   // Feet
  8: 0.5625, // Wrist
  9: 0.75,   // Hands
  10: 0.5625, 11: 0.5625, // Rings
  12: 0.5625, 13: 0.5625, // Trinkets
  14: 0.5625, // Back
  15: 1.0,   // Main hand (2.0 when two-handed)
  16: 1.0,   // Off hand / shield / holdable
  17: 0.3164, // Ranged / relic
};

const FORMULA_A = { 4: { a: 91.45, b: 0.65 }, 3: { a: 81.375, b: 0.8125 }, 2: { a: 73.0, b: 1.0 } };
const FORMULA_B = { 4: { a: 26.0, b: 1.2 }, 3: { a: 0.75, b: 1.8 }, 2: { a: 8.0, b: 2.0 }, 1: { a: 0.0, b: 2.25 } };
const SCALE = 1.8618;

// One gear-list entry (from analyze.buildGearList) -> its GearScore.
export function itemGearScore(entry, className) {
  let mod = SLOT_MODS[entry.slot];
  if (mod == null) return 0; // shirt/tabard
  if (entry.slot === 15 && ITEM_2H.has(entry.id)) mod = 2.0;
  if (className === "Hunter") {
    if (entry.slot === 17) mod = 5.3224;
    else if (entry.slot === 15 || entry.slot === 16) mod = 0.3164;
  }

  let quality = entry.quality ?? 1;
  let qualityScale = 1;
  if (quality === 5) { qualityScale = 1.3; quality = 4; }       // legendary
  else if (quality > 5) quality = 4;                            // artifact/heirloom, n/a in TBC
  else if (quality < 2) { qualityScale = 0.005; quality = 1; }  // grey/white

  const ilvl = entry.itemLevel ?? 0;
  const table = ilvl > 120 ? FORMULA_A : FORMULA_B;
  const c = table[quality] ?? FORMULA_B[1];
  return Math.max(0, Math.floor(((ilvl - c.a) / c.b) * mod * SCALE * qualityScale));
}

// Whole gear list -> total GearScore (also stamps `gs` onto each entry).
export function computeGearScore(gearList, className) {
  let total = 0;
  for (const entry of gearList ?? []) {
    entry.gs = itemGearScore(entry, className);
    total += entry.gs;
  }
  return total;
}

// Rough TBC-era color bands (the addon's bands were WotLK-scaled; these are
// tuned so fresh-70 blues read green and SWP best-in-slot reads orange).
export function gearScoreColor(gs) {
  if (gs >= 2700) return "#ff8000";
  if (gs >= 2200) return "#a335ee";
  if (gs >= 1700) return "#0070dd";
  if (gs >= 1200) return "#1eff00";
  return "#9d9d9d";
}
