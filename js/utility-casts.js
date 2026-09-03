"use strict";
// Raid-utility CAST ids -> a display label and a group, for the officer night
// stats. Questions a raid leader asks that the consumable columns can't
// answer: did anyone net the adds, did the druids innervate, did the engineers
// throw their bombs, did anyone drop threat when they pulled aggro.
//
// DISPELS ARE NOT HERE, on purpose. WCL has a dedicated Dispels table (same
// spell-keyed shape as Interrupts), so dispels are counted as things that
// actually LANDED, from one unfiltered query, rather than as casts that may
// have dispelled nothing. See fetchDeepStats in officer-stats.js. They still
// render in the same Utility column.
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
// cast it), across 30-36 Kara/Gruul-Mag/SSC-TK reports on 2026-09-03. Two were
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

  // ---- threat drops ----
  // The ids are the CASTS. masterData shows most of these under a second id for
  // the resulting aura — Invisibility 66 casts, 32612 is the invisibility that
  // lands 3s later; Misdirection 34477 casts, 35079 is the threat-transfer buff;
  // Soulshatter 29858 casts, 32835 is its effect; Vanish 26889 casts, 26888 and
  // 29448 are effects. Counting an effect id would count the aura, not the
  // decision to use the ability.
  34477: { label: "Misdirection", group: "threat" },
  29858: { label: "Soulshatter", group: "threat" },
  26889: { label: "Vanish", group: "threat" },
  66: { label: "Invisibility", group: "threat" },
  // Fade is the one that really has ranks in live logs: 234 casts on 25429 but
  // 15 on 10942 and 3 on 10941 across 36 reports. Dropping the low ranks would
  // quietly undercount the priests who kept an old rank on a macro.
  25429: { label: "Fade", group: "threat" },
  10942: { label: "Fade", group: "threat" },
  10941: { label: "Fade", group: "threat" },
};

// NOT COUNTED, by decision (2026-09-03): druid Cower (27004). It's a real
// threat drop, but a cat spamming it on cooldown posted 44 in one night next to
// a warlock's 7 deliberate Soulshatters, drowning the group in rotation noise.
// The other threat drops are decisions; Cower is a button. Same reasoning
// removed Shield Slam's automatic purge from the dispel count (officer-stats).
//
// NOT COUNTABLE: hunter Feign Death. Verified 2026-09-03 — 5384 returns nothing
// from a direct filterExpression Casts query across 6 guild reports that each
// had 2-3 hunters in them, and /feign/ matches nothing in any of those reports'
// masterData, nor in 30 public reports. The Anniversary combat log simply does
// not surface it, so a hunter's Utility count cannot include their feigns. This
// is a data limitation, not a missing id — don't "fix" it by guessing one.
//
// Misdirection is counted here even though it REDIRECTS threat rather than
// dropping it: it's the hunter's threat tool and a raid leader checking "is
// anyone managing threat" wants it. The per-item tooltip names it, so a cell of
// 12 is never ambiguous about which it was.

/** Every id we know how to count, for the filterExpression batches. */
export const UTILITY_CAST_IDS = Object.keys(UTILITY_CASTS).map(Number);

// No GROUP_LABELS export to mirror consumable-casts.js: the officer card writes
// its own short forms ("nets" / "innerv" / "bombs") to fit the cell, so a
// second set of names here would only be a thing to keep in sync. (The
// equivalent CONSUMABLE_GROUP_LABELS is unused too — it's on the §9 list.)
