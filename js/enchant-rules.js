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
];

// Slots to ignore when averaging item level (cosmetic / no real ilvl).
export const NON_ILVL_SLOTS = new Set([3, 18]); // Shirt, Tabard
