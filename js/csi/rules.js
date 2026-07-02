"use strict";
// Boss-mechanic catalogue for TBC Anniversary (2.5.5, post-nerf), derived from
// tbc-anniversary-raid-analysis-rules.md. Implements the tractable damage-based
// primitives: avoidable / ground / frontal / chain, plus expected categories
// (soak / tank / raidwide) that must NOT be blamed.
//
// Keyed by ability NAME (lowercased) — WCL resolves names from master data, and
// the names came back 100% populated on live Anniversary logs. The spec wants
// spell-ID keys eventually (names can collide across adds); that's a later
// hardening. Interrupts, dispels, threat, and positional clustering need event
// streams we don't fetch yet and are intentionally out of scope here.
//
// category meanings:
//   avoidable  - ground/positioning damage to move out of      -> always avoidable
//   chain      - spacing failure (spell jumps between players)  -> always avoidable
//   frontal    - frontal cone; only the active tank belongs there -> avoidable for non-tanks
//   soak       - expected on the assigned soaker                -> never blamed
//   tank       - expected active-tank damage                    -> never blamed
//   raidwide   - unavoidable raid damage (healing/death context)-> never blamed

const RULES = {
  // ---------------- Gruul's Lair ----------------
  "cave in": { encounter: "Gruul", category: "avoidable", severity: "high", advice: "Move out of the falling-rock area immediately." },
  "shatter": { encounter: "Gruul", category: "chain", severity: "critical", advice: "Spread as far as possible after Ground Slam before becoming Stoned." },
  "hurtful strike": { encounter: "Gruul", category: "soak", severity: "info", advice: "Expected on the off-tank soak; keep them second on threat and in melee range." },
  "reverberation": { encounter: "Gruul", category: "raidwide", severity: "info", advice: "Unavoidable raid silence; pre-HoT tanks and top the raid before it." },
  "whirlwind": { encounter: "shared", category: "avoidable", severity: "high", advice: "Leave melee range as soon as the enemy begins spinning." },
  "arcing smash": { encounter: "Maulgar", category: "frontal", severity: "high", advice: "Stay behind or beside; only the active tank should be in front." },
  "blast wave": { encounter: "Maulgar (Krosh)", category: "avoidable", severity: "high", advice: "Stay outside the caster's ~15-yard danger area." },
  "arcane explosion": { encounter: "Maulgar (Kiggler)", category: "avoidable", severity: "medium", advice: "Keep melee and pets away from the ranged-tanked caster." },

  // ---------------- Magtheridon's Lair ----------------
  "conflagration": { encounter: "Magtheridon", category: "avoidable", severity: "high", advice: "Move away from the fire and pre-position before Quake." },
  "blaze": { encounter: "Magtheridon", category: "avoidable", severity: "high", advice: "Move off the burning ground left on the floor." },
  "debris": { encounter: "Magtheridon", category: "avoidable", severity: "high", advice: "Move out of the marked collapse area before it lands." },
  "falling debris": { encounter: "Magtheridon", category: "avoidable", severity: "high", advice: "Move out of the marked collapse area before it lands." },
  "cleave": { encounter: "Magtheridon", category: "frontal", severity: "high", advice: "Stay behind the boss and away from the active tank." },
  "quake": { encounter: "Magtheridon", category: "raidwide", severity: "info", advice: "Knockback is expected; pre-position away from fire and edges." },
  "blast nova": { encounter: "Magtheridon", category: "raidwide", severity: "critical", advice: "Coordination check — all five Manticron Cubes must channel together." },
  "shadow bolt volley": { encounter: "Magtheridon", category: "raidwide", severity: "major", advice: "Assign interrupt coverage to every caster." },

  // ---------------- Karazhan ----------------
  "shadow cleave": { encounter: "Attumen", category: "frontal", severity: "high", advice: "Stand behind or beside Attumen; only the tank in front." },
  "holy fire": { encounter: "Maiden", category: "avoidable", severity: "medium", advice: "Dispel the magic DoT quickly; not a positioning effect." },
  "holy wrath": { encounter: "Maiden", category: "chain", severity: "high", advice: "Spread around the room so it cannot jump between players." },
  "holy ground": { encounter: "Maiden", category: "avoidable", severity: "medium", advice: "Ranged should stay outside the aura except to break Repentance." },
  "wide swipe": { encounter: "Big Bad Wolf", category: "frontal", severity: "medium", advice: "Keep the Wolf faced away from the raid." },
  "deadly swathe": { encounter: "Romulo", category: "frontal", severity: "high", advice: "Keep Romulo faced away from the raid." },
  "flame wreath": { encounter: "Shade of Aran", category: "raidwide", severity: "critical", advice: "Nobody inside or crossing a fire ring may move until it disappears." },
  "blizzard": { encounter: "Shade of Aran", category: "avoidable", severity: "high", advice: "Move ahead of the clockwise-moving Blizzard." },
  "charged arcane explosion": { encounter: "Shade of Aran", category: "avoidable", severity: "high", advice: "Run to the edge immediately after the Magnetic Pull." },
  "dragon's breath": { encounter: "Shade of Aran", category: "frontal", severity: "medium", advice: "Don't cluster in front during Dragon's Breath." },
  "void zone": { encounter: "Netherspite", category: "avoidable", severity: "high", advice: "Move out of the black ground effect immediately." },
  "nether burn": { encounter: "Netherspite", category: "raidwide", severity: "info", advice: "Unavoidable raid aura; healing-load context only." },
  "hateful bolt": { encounter: "Curator", category: "soak", severity: "info", advice: "Expected on the assigned soak; keep them second on threat and healthy." },
  "hellfire": { encounter: "Prince Malchezaar", category: "avoidable", severity: "high", advice: "Move the raid when an infernal lands nearby." },
  "shadow nova": { encounter: "Prince Malchezaar", category: "avoidable", severity: "critical", advice: "Move outside the Nova radius before the cast completes (lethal while Enfeebled)." },
  "smoldering breath": { encounter: "Nightbane", category: "frontal", severity: "high", advice: "Attack from the side; only the active tank in front." },
  "tail sweep": { encounter: "Nightbane", category: "avoidable", severity: "medium", advice: "Stand at the side, not behind the tail." },
  "charred earth": { encounter: "Nightbane", category: "avoidable", severity: "high", advice: "Move out of the fire immediately." },
  "rain of bones": { encounter: "Nightbane", category: "avoidable", severity: "high", advice: "Leave the Rain of Bones spawn area quickly." },

  // ---------------- Tempest Keep ----------------
  "flame quills": { encounter: "Al'ar", category: "avoidable", severity: "high", advice: "Leave the upper platform when Al'ar moves to the center." },
  "flame patch": { encounter: "Al'ar", category: "avoidable", severity: "high", advice: "Move out of the flame patch on the floor." },
  "flame buffet": { encounter: "Al'ar", category: "raidwide", severity: "major", advice: "Keep every landing platform covered by a tank." },
  "melt armor": { encounter: "Al'ar", category: "tank", severity: "info", advice: "Tank swap promptly after the 80% armor reduction." },
  "arcane orb": { encounter: "Void Reaver", category: "avoidable", severity: "high", advice: "Move away from the orb's destination before impact." },
  "pounding": { encounter: "Void Reaver", category: "raidwide", severity: "info", advice: "Expected melee-range damage; healing/defensive context." },
  // chain: the explosion propagates FROM the debuffed player (friendly source)
  "wrath of the astromancer": { encounter: "Solarian", category: "chain", severity: "critical", advice: "Move to the assigned drop point before the bomb expires." },
  "blinding light": { encounter: "Solarian", category: "raidwide", severity: "info", advice: "Expected raid damage; healing context." },
  "flamestrike": { encounter: "Kael'thas", category: "avoidable", severity: "high", advice: "Move out of the Flamestrike ground effect." },
  "nether vapor": { encounter: "Kael'thas", category: "avoidable", severity: "high", advice: "Avoid the Nether Vapor clouds during Gravity Lapse." },
  "netherbeam": { encounter: "Kael'thas", category: "chain", severity: "high", advice: "Spread during Gravity Lapse so the beam can't chain." },
  "pyroblast": { encounter: "Kael'thas", category: "tank", severity: "info", advice: "Break Shock Barrier and interrupt; first cast may be Bulwark-absorbed." },

  // ---------------- Serpentshrine Cavern ----------------
  "water tomb": { encounter: "Hydross", category: "chain", severity: "high", advice: "Maintain 8-yard spacing during Frost form." },
  "vile sludge": { encounter: "Hydross", category: "raidwide", severity: "major", advice: "Random target with 50% reduced healing; healer response, not positioning." },
  "spout": { encounter: "The Lurker Below", category: "avoidable", severity: "critical", advice: "Submerge or rotate behind Lurker before the beam reaches you." },
  "scalding water": { encounter: "The Lurker Below", category: "avoidable", severity: "medium", advice: "Minimize re-entry into the water while avoiding Spout." },
  "geyser": { encounter: "The Lurker Below", category: "chain", severity: "medium", advice: "Keep 10-yard spacing so Geyser doesn't catch others." },
  "chaos blast": { encounter: "Leotheras", category: "tank", severity: "info", advice: "Expected ranged-tank pressure; not a missed interrupt." },
  "cataclysmic bolt": { encounter: "Karathress", category: "raidwide", severity: "info", advice: "Random ~half-health hit; correlate with low health/heals, not victim fault." },
  "sear nova": { encounter: "Karathress", category: "raidwide", severity: "info", advice: "Expected for assigned melee; ranged/support should stay out of melee range." },
  "tidal wave": { encounter: "Morogrim", category: "frontal", severity: "high", advice: "Stay out of the frontal; only the active tank in front." },
  "earthquake": { encounter: "Morogrim", category: "raidwide", severity: "info", advice: "Expected raid damage; healing/death context only." },
  "watery grave": { encounter: "Morogrim", category: "raidwide", severity: "major", advice: "Random teleport/stun; ensure healer range covers the graved players." },
  "static charge": { encounter: "Lady Vashj", category: "chain", severity: "high", advice: "Move away from the raid while Static Charge is on you." },
  "shock blast": { encounter: "Lady Vashj", category: "tank", severity: "info", advice: "Tank damage/stun; Grounding is optional strategy." },
  "forked lightning": { encounter: "Lady Vashj", category: "frontal", severity: "medium", advice: "Avoid Vashj's frontal cone where possible." },
  "toxic spores": { encounter: "Lady Vashj", category: "avoidable", severity: "high", advice: "Move out of the Toxic Spore pools immediately; they persist." },
};

/** Look up a mechanic rule by ability name (case-insensitive), or null. */
export function lookupRule(abilityName) {
  if (!abilityName) return null;
  return RULES[abilityName.toLowerCase()] ?? null;
}

/**
 * Is this damage event avoidable for the given victim role, per its rule?
 * - avoidable/chain: always
 * - frontal: only for non-tanks (frontals are expected on the active tank)
 * - soak/tank/raidwide/none: never
 */
export function isAvoidableHit(rule, victimRole) {
  if (!rule) return false;
  if (rule.category === "avoidable" || rule.category === "chain") return true;
  if (rule.category === "frontal") return victimRole !== "tank";
  return false;
}
