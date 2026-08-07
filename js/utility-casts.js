"use strict";
// Raid-utility CAST ids -> a display label and a group, for the officer night
// stats. Three questions a raid leader asks that the consumable columns can't
// answer: did anyone net the adds, did the druids innervate, did the engineers
// throw their bombs.
//
// Deliberately NOT part of consumable-casts.js. That file is about what a
// raider CONSUMED (potions drunk, stones eaten, drums beaten) and its total
// feeds the "Used" column. Innervate is a spell, not an item — folding it in
// would inflate "Used" with something nobody consumed. Nets and bombs are
// consumed, but they answer the utility question, not the sustain one, so they
// travel with Innervate rather than with the potions.
//
// Same id-first discipline as the rest of the app, and for the same two
// reasons (see consumable-casts.js): the Casts table returns only each player's
// TOP 5 abilities, so these can only be seen by ASKING for them by id via
// filterExpression; and names alone can't be trusted to mean what they say —
// see the two Netherweave Net ids below.
//
// Every id here was harvested from live Anniversary Casts tables
// (hostilityType: Friendlies, viewBy: Ability — so `sources` proves a PLAYER
// cast it), across 30 Kara/Gruul-Mag/SSC-TK reports on 2026-08-07. Two were
// filled in from Wowhead because the sample happened not to contain them; they
// are marked. To extend: find the ability's gameID in any report's masterData
// and add it here. Unknown ids are simply not counted.

export const UTILITY_CASTS = {
  // ---- crowd control ----
  // 31367 is the item being USED. The other "Netherweave Net" id, 31460, is the
  // TAILORING RECIPE that creates the nets — a tailor stocking up, not anyone
  // catching an add. It never appears in a Casts table and must stay out, the
  // same way "Create Healthstone" stays out of consumable-casts.js.
  31367: { label: "Netherweave Net", group: "nets" },

  // ---- mana battery ----
  // One id, no ranks — verified across 29 reports, always druid-sourced.
  29166: { label: "Innervate", group: "innervate" },

  // ---- engineering explosives ----
  // The ids are the USE casts, not the damage effects the bombs trigger
  // (Fel Iron Bomb casts 30216 and deals 30310; counting the latter would count
  // every target hit rather than every bomb thrown).
  30216: { label: "Fel Iron Bomb", group: "bombs" },
  30461: { label: "The Bigger One", group: "bombs" },      // Wowhead: item 23826
  30217: { label: "Adamantite Grenade", group: "bombs" },
  30486: { label: "Super Sapper Charge", group: "bombs" },
  13241: { label: "Goblin Sapper Charge", group: "bombs" },
  23063: { label: "Dense Dynamite", group: "bombs" },
  39965: { label: "Frost Grenade", group: "bombs" },       // Engineering, item 32413
  19821: { label: "Arcane Bomb", group: "bombs" },         // Wowhead: item 16040
};

/** Every id we know how to count, for the filterExpression batches. */
export const UTILITY_CAST_IDS = Object.keys(UTILITY_CASTS).map(Number);

// No GROUP_LABELS export to mirror consumable-casts.js: the officer card writes
// its own short forms ("nets" / "innerv" / "bombs") to fit the cell, so a
// second set of names here would only be a thing to keep in sync. (The
// equivalent CONSUMABLE_GROUP_LABELS is unused too — it's on the §9 list.)
