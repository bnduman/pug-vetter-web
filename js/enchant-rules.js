// Which equipment slots a raid-ready character is expected to have enchanted.
// Gear items from WCL carry an explicit `slot` number (0 Head, 2 Shoulder,
// 4 Chest, 6 Legs, 7 Feet, 8 Wrist, 9 Hands, 14 Back, 15 Main Hand, ...).
// Tuned for TBC, where head and shoulder enchants are standard raid enchants.

export const ENCHANT_SLOTS = [
  { slot: 0, label: "Head", required: true },
  { slot: 2, label: "Shoulder", required: true },
  { slot: 14, label: "Back", required: true },
  { slot: 4, label: "Chest", required: true },
  { slot: 8, label: "Wrist", required: true },
  { slot: 9, label: "Hands", required: true },
  { slot: 6, label: "Legs", required: true },
  { slot: 7, label: "Feet", required: true },
  { slot: 15, label: "Weapon", required: true },
  // Off-hand (16) IS enchantable for shields and off-hand weapons, but a
  // non-enchantable caster held-in-off-hand also sits here, and WCL gear data
  // doesn't give us the item class to tell them apart. So we surface it (no
  // longer silently treated as non-enchantable) but don't force-count it as a
  // required miss, which would falsely penalize caster off-hands.
  { slot: 16, label: "Off Hand", required: false },
  // Ranged (17) holds a hunter's scopeable bow/gun/crossbow AND every caster's
  // wand, idol, libram and totem, which cannot take an enchant at all. Same
  // "no item class in the data" problem as the off-hand — but here the PLAYER's
  // class settles it, so the rule is scoped to hunters and simply doesn't
  // apply to anyone else. Measured over four nights: hunters 8/11 scoped
  // (a real, actionable gap), casters 0/79 ever, warriors/rogues 1/22 — so
  // requiring it of them would be noise, not a finding.
  { slot: 17, label: "Ranged", required: true, classes: ["Hunter"] },
];

// Slots to ignore when averaging item level (cosmetic / no real ilvl).
export const NON_ILVL_SLOTS = new Set([3, 18]); // Shirt, Tabard
