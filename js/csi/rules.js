"use strict";
// Boss-mechanic catalogue for TBC Anniversary (2.5.5, post-nerf). Karazhan
// through Serpentshrine is derived from tbc-anniversary-raid-analysis-rules.md;
// **Mount Hyjal and Black Temple are not in that spec** (it stops at Vashj) and
// were authored from a per-boss harvest of live zone-1060 logs. Implements the
// tractable damage-based primitives: avoidable / ground / frontal / chain, plus
// expected categories (soak / tank / raidwide) that must NOT be blamed.
//
// AUTHORING RULE, when a mechanic is ambiguous: pick a never-blamed category.
// A missing entry and a `raidwide` entry both cost nothing, while a wrong
// `avoidable` accuses a player of a mistake they did not make. Two Tier 6
// mechanics were nearly miscategorised on plausible-looking evidence:
//   * Aura of Desire is credited to the player who TOOK the tick, so it looks
//     player-sourced like a chain mechanic. It is unlimited-range and ignores
//     line of sight — nobody can position out of it. raidwide.
//   * Bloodboil targets the players FURTHEST from Gurtogg with a 99-yard
//     radius. Being hit is the intended rotation, not a failure. raidwide.
// Conversely Unquenchable Flames looks like raid damage (it hit 36 players) but
// only burns players already standing in Rain of Fire, so it IS avoidable.
//
// Two-layer lookup: the generated RULE_SPELL_IDS map (rule-ids.js, harvested
// from live Anniversary logs by scripts/gen-rule-ids.mjs) resolves an ability
// game ID straight to its catalogue entry; ability NAME (lowercased) remains
// the fallback for ranks/bosses absent from the harvested logs and for demo
// data, which carries no IDs. Interrupts, dispels, threat, and positional
// clustering need event streams we don't fetch yet and are intentionally out
// of scope here.
//
// category meanings:
//   avoidable  - ground/positioning damage to move out of      -> always avoidable
//   chain      - spacing failure (spell jumps between players)  -> always avoidable
//   frontal    - frontal cone; only the active tank belongs there -> avoidable for non-tanks
//   soak       - expected on the assigned soaker                -> never blamed
//   tank       - expected active-tank damage                    -> never blamed
//   raidwide   - unavoidable raid damage (healing/death context)-> never blamed
import { RULE_SPELL_IDS } from "./rule-ids.js";

export const RULES = {
  // ---------------- Gruul's Lair ----------------
  "cave in": { encounter: "Gruul", category: "avoidable", severity: "high", advice: "Move out of the falling-rock area immediately." },
  "shatter": { encounter: "Gruul", category: "chain", severity: "critical", advice: "Spread as far as possible after Ground Slam before becoming Stoned." },
  "hurtful strike": { encounter: "Gruul", category: "soak", severity: "info", advice: "Expected on the off-tank soak; keep them second on threat and in melee range." },
  "reverberation": { encounter: "Gruul", category: "raidwide", severity: "info", advice: "Unavoidable raid silence; pre-HoT tanks and top the raid before it." },
  "whirlwind": { encounter: "shared", category: "avoidable", severity: "high", advice: "Leave melee range as soon as the enemy begins spinning." },
  "arcing smash": { encounter: "shared", category: "frontal", severity: "high", advice: "Stay behind or beside; only the active tank should be in front." },
  "blast wave": { encounter: "Maulgar (Krosh)", category: "avoidable", severity: "high", advice: "Stay outside the caster's ~15-yard danger area." },
  "arcane explosion": { encounter: "shared", category: "avoidable", severity: "medium", advice: "Keep melee and pets away from the enemy caster." },

  // ---------------- Magtheridon's Lair ----------------
  "conflagration": { encounter: "Magtheridon", category: "avoidable", severity: "high", advice: "Move away from the fire and pre-position before Quake." },
  "blaze": { encounter: "shared", category: "avoidable", severity: "high", advice: "Move off the burning ground left on the floor." },
  "debris": { encounter: "Magtheridon", category: "avoidable", severity: "high", advice: "Move out of the marked collapse area before it lands." },
  "falling debris": { encounter: "Magtheridon", category: "avoidable", severity: "high", advice: "Move out of the marked collapse area before it lands." },
  // Also Azgalor and the Shade of Akama adds — the rule reads the same on all of
  // them, and RULES is name-keyed, so one entry covers every boss that cleaves.
  "cleave": { encounter: "shared", category: "frontal", severity: "high", advice: "Stay behind the boss and away from the active tank." },
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
  // Aran's version sweeps clockwise; the Illidari Council's is a fixed patch.
  // One name-keyed entry serves both, so the advice can't be Aran-specific.
  "blizzard": { encounter: "shared", category: "avoidable", severity: "high", advice: "Move out of the Blizzard — ahead of it on Aran, straight out of it elsewhere." },
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
  "flamestrike": { encounter: "shared", category: "avoidable", severity: "high", advice: "Move out of the Flamestrike ground effect." },
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

  // ---------------- Mount Hyjal ----------------
  // Tier 6 opened on the Anniversary realms in 2026-09; unlike everything above,
  // these are NOT in tbc-anniversary-raid-analysis-rules.md (it stops at Vashj).
  // They were authored from a per-boss harvest of live zone-1060 logs, with the
  // ambiguous ones checked against their spell data — see the notes below.
  "death & decay": { encounter: "Rage Winterchill", category: "avoidable", severity: "high", advice: "Move out of the Death and Decay pool; it ticks for as long as you stand in it." },
  "icebolt": { encounter: "Rage Winterchill", category: "raidwide", severity: "info", advice: "Random freeze; healer response, not a positioning mistake." },
  "frost nova": { encounter: "Rage Winterchill", category: "raidwide", severity: "info", advice: "Expected melee-range root; blink/trinket out if you can." },
  "carrion swarm": { encounter: "Anetheron", category: "frontal", severity: "high", advice: "Stay out of the frontal cone; only the active tank belongs in front." },
  "immolation": { encounter: "Anetheron (Infernal)", category: "avoidable", severity: "high", advice: "Move away from the Infernal — its aura burns everyone standing near it." },
  "inferno effect": { encounter: "Anetheron (Infernal)", category: "avoidable", severity: "medium", advice: "Move out of the Infernal's landing point before it hits." },
  // The flagship naughty mechanic. 31463 is the EXPLOSION and is sourced from
  // the marked PLAYER; 31447 is the harmless mana-drain debuff and shares the
  // name, so this must resolve by id (both map here, but only 31463 deals damage).
  "mark of kaz'rogal": { encounter: "Kaz'rogal", category: "chain", severity: "critical", advice: "Run clear of the raid before your mana empties — the blast hits everyone near you." },
  "war stomp": { encounter: "shared", category: "raidwide", severity: "info", advice: "Expected melee-range stun; healing and cooldown context." },
  "malevolent cleave": { encounter: "Kaz'rogal", category: "frontal", severity: "high", advice: "Stay behind Kaz'rogal; only the active tank in front." },
  "rain of fire": { encounter: "shared", category: "avoidable", severity: "high", advice: "Move out of the burning ground immediately." },
  // Verified against its spell data: it only burns players ALREADY standing in
  // Rain of Fire, so it is avoidable rather than raid damage.
  "unquenchable flames": { encounter: "Azgalor", category: "avoidable", severity: "high", advice: "This only burns players standing in Rain of Fire — get out of the fire." },
  "doomfire": { encounter: "Archimonde", category: "avoidable", severity: "critical", advice: "Doomfire wanders; keep moving away from it rather than through it." },
  "soul charge": { encounter: "Archimonde", category: "raidwide", severity: "major", advice: "Archimonde gains a charge for every death — this is the cost of the last one, not the victim's fault." },
  "air burst": { encounter: "Archimonde", category: "raidwide", severity: "major", advice: "Expected knockback; use Tears of the Goddess so the landing doesn't kill you." },
  "grip of the legion": { encounter: "Archimonde", category: "raidwide", severity: "info", advice: "Dispel the DoT promptly; not a positioning effect." },
  "finger of death": { encounter: "Archimonde", category: "raidwide", severity: "major", advice: "Fires when nobody is in melee range — a raid-positioning problem, not the victim's." },

  // ---------------- Black Temple ----------------
  // Radius 6 yards and excludes the impaled player: this damage lands on whoever
  // was standing next to them, so it is a spacing failure.
  "needle spine explosion": { encounter: "High Warlord Naj'entus", category: "chain", severity: "high", advice: "Spread out, and free the impaled player before the spine bursts." },
  "tidal burst": { encounter: "High Warlord Naj'entus", category: "raidwide", severity: "major", advice: "Expected when the shield breaks; healing context." },
  "needle spine": { encounter: "High Warlord Naj'entus", category: "raidwide", severity: "info", advice: "Random target; the spine that follows is what matters." },
  "impaling spine": { encounter: "High Warlord Naj'entus", category: "raidwide", severity: "info", advice: "Click the spine to free the impaled player quickly." },
  "volcanic geyser": { encounter: "Supremus", category: "avoidable", severity: "high", advice: "Move off the volcano before it erupts." },
  "molten flame": { encounter: "Supremus", category: "avoidable", severity: "high", advice: "Move out of the flame trails Supremus leaves behind." },
  "hateful strike": { encounter: "Supremus", category: "soak", severity: "info", advice: "Expected on the highest-health player in melee; keep them healthy." },
  "debilitating poison": { encounter: "Shade of Akama", category: "raidwide", severity: "info", advice: "Add damage; cleanse when convenient." },
  "debilitating strike": { encounter: "Shade of Akama", category: "tank", severity: "info", advice: "Expected tank damage from the Defenders." },
  // Distance-targeted with a 99-yard radius — no positioning avoids it, so it is
  // never blamed. It is a healing check, not a mistake.
  "bloodboil": { encounter: "Gurtogg Bloodboil", category: "raidwide", severity: "major", advice: "Hits the players furthest from Gurtogg by design; healing and swap context." },
  "acidic wound": { encounter: "Gurtogg Bloodboil", category: "tank", severity: "info", advice: "Expected stacking tank DoT; swap before it gets heavy." },
  "fel-acid breath": { encounter: "Gurtogg Bloodboil", category: "frontal", severity: "high", advice: "Stay out of the frontal; only the active tank in front." },
  "fel arcing smash": { encounter: "Gurtogg Bloodboil", category: "frontal", severity: "high", advice: "Stay behind or beside; only the active tank in front." },
  "fel geyser": { encounter: "Gurtogg Bloodboil", category: "avoidable", severity: "high", advice: "Move off the geyser before it erupts." },
  "eject": { encounter: "Gurtogg Bloodboil", category: "raidwide", severity: "info", advice: "Expected knockback during Fel Rage." },
  // Reliquary is a healing check by design: unlimited range, ignores line of
  // sight, and the game credits the aura tick to the player who took it — so
  // "player-sourced" here means the VICTIM, never a culprit. Never blamed.
  "aura of desire": { encounter: "Reliquary of Souls", category: "raidwide", severity: "major", advice: "Unavoidable aura for the whole phase; healing and damage-taken context only." },
  "aura of anger": { encounter: "Reliquary of Souls", category: "raidwide", severity: "major", advice: "Unavoidable escalating raid damage; a DPS race, not a mistake." },
  "soul scream": { encounter: "Reliquary of Souls", category: "raidwide", severity: "info", advice: "Expected raid damage; healing context." },
  "spite": { encounter: "Reliquary of Souls", category: "raidwide", severity: "info", advice: "Random target; healing context." },
  "spirit shock": { encounter: "Reliquary of Souls", category: "raidwide", severity: "info", advice: "Expected caster damage; healing context." },
  "fatal attraction": { encounter: "Mother Shahraz", category: "chain", severity: "critical", advice: "You have been teleported together — run apart immediately; the damage escalates while you are close." },
  "saber lash": { encounter: "Mother Shahraz", category: "tank", severity: "info", advice: "Expected; must be split across all three tanks stacked together." },
  // NOT "move out of a sweeping beam" — that was invented from the word "beam"
  // and was wrong. All four read "Strikes an enemy with shadow energy that arcs
  // to another nearby enemy, affecting up to 10 targets", at unlimited range:
  // a random primary target plus an arc to whoever is standing close to them.
  //
  // raidwide, not avoidable or chain, because the damage table cannot tell the
  // PRIMARY target (who did nothing wrong) from an ARC victim (who stood too
  // close). Sinful Beam alone is ~690k across an entire raid on one night, so
  // blaming all of it buries every real finding under noise. Spreading is still
  // the counter, so the advice says so — it just isn't scored against anyone.
  "sinful beam": { encounter: "Mother Shahraz", category: "raidwide", severity: "major", advice: "Arcs to nearby players — spread out so it can't chain, but a random first target is nobody's fault." },
  "sinister beam": { encounter: "Mother Shahraz", category: "raidwide", severity: "major", advice: "Arcs to nearby players and knocks back — spread out, and watch your footing near edges." },
  "vile beam": { encounter: "Mother Shahraz", category: "raidwide", severity: "major", advice: "Arcing shadow DoT — spread out so it can't chain to a neighbour." },
  "wicked beam": { encounter: "Mother Shahraz", category: "raidwide", severity: "major", advice: "Arcs to nearby players and burns mana — spread out; healers watch their bars." },
  "consecration": { encounter: "Illidari Council", category: "avoidable", severity: "high", advice: "Move out of the consecrated ground." },
  "arcane bolt": { encounter: "Illidari Council", category: "raidwide", severity: "major", advice: "Assign interrupt coverage to Lady Malande's casts." },
  "empowered smite": { encounter: "Illidari Council", category: "tank", severity: "info", advice: "Expected tank damage; interrupt or heal through." },
  "divine wrath": { encounter: "Illidari Council", category: "raidwide", severity: "info", advice: "Expected raid damage; healing context." },
  "reflective shield": { encounter: "Illidari Council", category: "avoidable", severity: "high", advice: "Stop attacking while the shield is up — this damage is your own, reflected." },
  "flame crash": { encounter: "Illidan Stormrage", category: "avoidable", severity: "high", advice: "Move out of the fire Illidan drops beneath him." },
  "demon fire": { encounter: "Illidan Stormrage", category: "avoidable", severity: "high", advice: "Move out of the burning ground." },
  "flame blast": { encounter: "Illidan Stormrage (Flame of Azzinoth)", category: "avoidable", severity: "high", advice: "Move out of the Flame's blast radius." },
  "agonizing flames": { encounter: "Illidan Stormrage", category: "raidwide", severity: "major", advice: "Random ranged target; healing context." },
  "shadow blast": { encounter: "Illidan Stormrage", category: "raidwide", severity: "major", advice: "Expected demon-phase damage around the tank; spread and heal through." },
  "aura of dread": { encounter: "Illidan Stormrage", category: "raidwide", severity: "info", advice: "Unavoidable demon-phase aura; healing context." },
  "parasitic shadowfiend": { encounter: "Illidan Stormrage", category: "raidwide", severity: "major", advice: "Kill the spawned fiends fast; the debuff itself is not a positioning mistake." },
  "dark barrage": { encounter: "Illidan Stormrage", category: "raidwide", severity: "major", advice: "Channelled at a random player; healing context." },
  "draw soul": { encounter: "Illidan Stormrage", category: "raidwide", severity: "info", advice: "Expected drain; healing context." },
};

/** Look up a mechanic rule by ability game ID (primary) or name (fallback,
 *  case-insensitive), or null. */
export function lookupRule(abilityName, abilityId) {
  if (abilityId != null) {
    const key = RULE_SPELL_IDS[abilityId];
    if (key) return RULES[key] ?? null;
  }
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
