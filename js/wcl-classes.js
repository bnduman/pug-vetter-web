// WCL classID -> class name (queried from the WCL Classic gameData API) and
// the standard WoW class colors. DK/Monk are in WCL's enum but not in TBC.

export const CLASS_NAMES = {
  1: "Death Knight",
  2: "Druid",
  3: "Hunter",
  4: "Mage",
  5: "Monk",
  6: "Paladin",
  7: "Priest",
  8: "Rogue",
  9: "Shaman",
  10: "Warlock",
  11: "Warrior",
};

export const CLASS_COLORS = {
  "Death Knight": "#C41E3A",
  Druid: "#FF7C0A",
  Hunter: "#AAD372",
  Mage: "#3FC7EB",
  Monk: "#00FF98",
  Paladin: "#F48CBA",
  Priest: "#FFFFFF",
  Rogue: "#FFF468",
  Shaman: "#0070DD",
  Warlock: "#8788EE",
  Warrior: "#C69B6D",
};

export const ROLE_ICONS = { tank: "🛡️", healer: "💚", dps: "⚔️" };
export const ROLE_LABEL = { tank: "Tank", healer: "Healer", dps: "DPS" };

// Talent tree names per class, in the in-game tab order (0/1/2) that WCL's
// combatantinfo `talents` totals array uses. WCL exposes only per-tree point
// sums for TBC, not individual talents — this labels the three sums.
export const TALENT_TREES = {
  Warrior: ["Arms", "Fury", "Protection"],
  Paladin: ["Holy", "Protection", "Retribution"],
  Hunter: ["Beast Mastery", "Marksmanship", "Survival"],
  Rogue: ["Assassination", "Combat", "Subtlety"],
  Priest: ["Discipline", "Holy", "Shadow"],
  Shaman: ["Elemental", "Enhancement", "Restoration"],
  Mage: ["Arcane", "Fire", "Frost"],
  Warlock: ["Affliction", "Demonology", "Destruction"],
  Druid: ["Balance", "Feral Combat", "Restoration"],
  "Death Knight": ["Blood", "Frost", "Unholy"], // not in TBC; harmless fallback
};

// Real TBC spec names -> role. Used to decide (from rankings, for free) whether
// a character plays multiple ROLES and is worth scanning for a second gear set.
// WCL occasionally mislabels a spec with a tier-set name (e.g. "Justicar");
// those aren't in this map, so they're ignored rather than faked into a 2nd role.
export const SPEC_ROLE = {
  // tanks
  Protection: "tank", Guardian: "tank",
  // healers
  Holy: "healer", Discipline: "healer", Restoration: "healer",
  // dps
  Arms: "dps", Fury: "dps", Retribution: "dps",
  BeastMastery: "dps", Marksmanship: "dps", Survival: "dps",
  Assassination: "dps", Combat: "dps", Subtlety: "dps",
  Shadow: "dps", Elemental: "dps", Enhancement: "dps",
  Arcane: "dps", Fire: "dps", Frost: "dps",
  Affliction: "dps", Demonology: "dps", Destruction: "dps",
  Balance: "dps", Feral: "dps",
};
