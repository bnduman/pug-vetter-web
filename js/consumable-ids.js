"use strict";
// Flask / elixir buff SPELL IDs -> category, for classifyConsumables.
//
// WHY IDs, not names: WCL logs a consumable's BUFF aura, whose name often drops
// the item's "Flask of" / "Elixir of" wording — "Flask of Distilled Wisdom"
// logs as "Distilled Wisdom", "Elixir of Healing Power" as "Healing Power",
// "Elixir of Major Agility" as "Mighty Agility". Name matching on "flask" /
// "elixir" silently misses all of these (a raider on Flask of Distilled Wisdom
// read as "no consumables"). Spell IDs are stable, so we key on them.
//
// Categories drive the flask-equivalence rule (a lone flask, OR a battle +
// guardian elixir pair):
//   flask     - a flask; flask-equivalent on its own
//   battle    - offensive elixir (needs a guardian to pair into flask-equiv)
//   guardian  - defensive/utility elixir (needs a battle to pair)
//
// Harvested from live SEND IT combatantinfo aura seeds (2026-07, Kara/Gruul/
// SSC/TK) and hand-categorized (battle vs guardian isn't in the log data).
// To extend: log an aura's `ability` (seed) / `guid` (buffs table) id and add
// it here. Well-named elixirs ("Elixir of ...") are also caught by the name
// fallback in classifyConsumables, so only IDs that must be here are the
// oddly-named ones — the rest are listed for robustness against name drift.
export const CONSUMABLE_IDS = {
  // ---- flasks ----
  17627: "flask",  // Distilled Wisdom (Flask of Distilled Wisdom)
  17628: "flask",  // Supreme Power (Flask of Supreme Power)
  28518: "flask",  // Flask of Fortification
  28520: "flask",  // Flask of Relentless Assault
  28521: "flask",  // Flask of Blinding Light
  28540: "flask",  // Flask of Pure Death

  // ---- battle elixirs (offensive) ----
  28490: "battle", // Major Strength (Elixir of Major Strength)
  28491: "battle", // Healing Power (Elixir of Healing Power)
  28493: "battle", // Major Frost Power (Elixir of Major Frost Power)
  28497: "battle", // Mighty Agility (Elixir of Major Agility)
  28501: "battle", // Major Firepower (Elixir of Major Firepower) — +55 fire dmg
  28503: "battle", // Major Shadow Power (Elixir of Major Shadow Power)
  17538: "battle", // Elixir of the Mongoose
  17539: "battle", // Greater Arcane Elixir
  33721: "battle", // Spellpower Elixir
  33726: "battle", // Elixir of Mastery
  38954: "battle", // Fel Strength Elixir

  // ---- guardian elixirs (defensive / utility) ----
  24363: "guardian", // Mageblood Elixir
  28502: "guardian", // Major Armor (Elixir of Major Defense) — +550 armour
  39625: "guardian", // Elixir of Major Fortitude
  39627: "guardian", // Elixir of Draenic Wisdom
  39628: "guardian", // Elixir of Ironskin
};

// Stat SCROLLS, tracked SEPARATELY and never as elixirs. Their buffs are named
// plainly ("Agility", "Strength", "Armor") and give +20 for 30min where the
// elixir gives +35 for an hour. They occupy neither the battle nor the guardian
// slot, so counting one toward a flask-equivalent pair would invent preparation
// that never happened — but a raider who scrolled did bring *something*, which
// is a different conversation from one who brought nothing.
// To extend: Intellect/Spirit scrolls haven't appeared in these logs yet; read
// the aura's `ability` id off a combatantinfo seed and add it here.
export const SCROLL_IDS = {
  33077: "Scroll of Agility",
  33082: "Scroll of Strength",
  33079: "Scroll of Protection",
  12174: "Scroll of Agility",    // older ranks, still seen in play
  12179: "Scroll of Strength",
  12175: "Scroll of Protection",
};
