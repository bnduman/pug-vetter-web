"use strict";
// Consumable USAGE spell ids (potions, healthstones, drums, utility items) ->
// a display label and a group, for the officer night stats.
//
// This is separate from consumable-ids.js, which categorises the flask/elixir
// BUFFS that tell you whether someone showed up prepared. This file is about
// what they consumed DURING the night: potions drunk, stones eaten, drums beaten.
//
// WHY IDS: two independent reasons, both learned the hard way against live data.
//   1. The names lie. A Super Mana Potion logs its spell as "Restore Mana", not
//      anything containing "potion" — searching names for /potion/i finds none
//      of the mana potions, which are the single most-used consumable in a raid.
//   2. The Casts TABLE can't be searched by name anyway: it returns only each
//      player's top 5 abilities, which for every raider is their rotation, never
//      a potion. The only way to see consumables is to ASK for them by id via
//      filterExpression.
//
// Harvested from the report masterData of live SEND IT nights (2026-07,
// SSC/TK). To extend: find the ability's gameID in any report's masterData and
// add it here. Unknown ids are simply not counted.
//
// NOTE: "Create Healthstone" (27230) is deliberately absent — that's a warlock
// making stones for the raid, not anyone consuming one.

export const CONSUMABLE_CASTS = {
  // ---- mana restore ----
  28499: { label: "Super Mana Potion", group: "mana" },
  17531: { label: "Major Mana Potion", group: "mana" },
  41617: { label: "Cenarion Mana Salve", group: "mana" },
  41618: { label: "Bottled Nethergon Energy", group: "mana" },
  27869: { label: "Dark Rune", group: "mana" },
  16666: { label: "Demonic Rune", group: "mana" },
  27103: { label: "Mana Emerald", group: "mana" },
  10058: { label: "Mana Emerald", group: "mana" },   // lower rank, same item line
  // ---- health restore ----
  28495: { label: "Super Healing Potion", group: "healing" },
  41620: { label: "Bottled Nethergon Vapor", group: "healing" },
  17534: { label: "Healing Potion", group: "healing" },
  41619: { label: "Healing Potion", group: "healing" },
  // Healthstone ranks: WCL reports 27235/27236/27237 all as "Master
  // Healthstone", so they're labelled by the line rather than by a rank we
  // can't tell apart in the data.
  27237: { label: "Healthstone", group: "healing" },
  27235: { label: "Healthstone", group: "healing" },
  27236: { label: "Healthstone", group: "healing" },
  // ---- raid drums (leatherworking) ----
  35476: { label: "Drums of Battle", group: "drums" },
  35475: { label: "Drums of War", group: "drums" },
  35478: { label: "Drums of Restoration", group: "drums" },
  35477: { label: "Drums of Speed", group: "drums" },
  // ---- utility / burst ----
  28714: { label: "Flame Cap", group: "utility" },
  28527: { label: "Fel Blossom", group: "utility" },
  28494: { label: "Insane Strength Potion", group: "utility" },
  45051: { label: "Mad Alchemist's Potion", group: "utility" },
  42137: { label: "Greater Rune of Warding", group: "utility" },
  30486: { label: "Super Sapper Charge", group: "utility" },
  9512: { label: "Thistle Tea", group: "mana" },
};

/** Every id we know how to count, for the filterExpression batches. */
export const CONSUMABLE_CAST_IDS = Object.keys(CONSUMABLE_CASTS).map(Number);

export const CONSUMABLE_GROUP_LABELS = {
  mana: "Mana", healing: "Health", drums: "Drums", utility: "Utility",
};
