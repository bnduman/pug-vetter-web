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
