// Canonical TBC enchant names, keyed by SpellItemEnchantment ID.
//
// Warcraft Logs' `permanentEnchantName` comes from a retail-era tooltip DB, so
// for TBC Anniversary it shows retail-squished magnitudes and renamed stats
// (ring enchant 2928 shows "+12 Intellect" when the real TBC effect is
// "+12 Spell Damage"; Spirit shows as "Versatility"). Of 77 enchant IDs
// observed on ranked Anniversary players, 70 had wrong WCL names.
//
// Source: the TBC Anniversary game client's own SpellItemEnchantment table
// (build 2.5.5.67852, via wago.tools), spot-verified against Wowhead /tbc
// spell pages. Refresh pipeline lives in the pug-vetter repo:
// scripts/_harvest_enchants.py + scripts/_join_enchants.py.

export const ENCHANT_NAMES = {
  // Rings
  2928: "+12 Spell Damage",
  2929: "+2 Weapon Damage",
  2930: "+20 Healing and +7 Spell Damage",
  // Head (Sha'tar / CE / arena glyphs, vanilla arcanums)
  3002: "+22 Spell Power and +14 Spell Hit Rating",
  3003: "+34 Attack Power and +16 Hit Rating",
  3001: "+35 Healing +12 Spell Damage and 7 Mana Per 5 sec.",
  2999: "+16 Defense Rating and +17 Dodge Rating",
  2588: "+18 Healing and Spell Damage/+8 Spell Hit",
  // Shoulder (Aldor/Scryer inscriptions, ZG signets)
  2982: "+18 Spell Power and +10 Spell Critical Strike Rating",
  2986: "+30 Attack Power and +10 Critical Strike Rating",
  2995: "+15 Spell Critical Strike Rating and +12 Spell Damage and Healing",
  2997: "+15 Critical Strike Rating and +20 Attack Power",
  2980: "+33 Healing and +11 Spell Damage and +4 Mana Regen",
  2978: "+15 Dodge Rating and +10 Defense Rating",
  2979: "+29 Healing and +10 Spell Damage",
  2981: "+15 Spell Power",
  2983: "+26 Attack Power",
  2990: "+13 Defense Rating",
  2992: "+5 Mana Regen",
  2994: "+13 Spell Critical Strike Rating",
  2604: "+33 Healing Spells and +11 Damage Spells",
  2605: "+18 Spell Damage and Healing",
  2717: "+26 Attack Power and +14 Critical Strike Rating",
  2721: "+15 Spell Damage and +14 Spell Critical Rating",
  // Back
  2621: "Subtlety",
  2622: "+12 Dodge Rating",
  2662: "+120 Armor",
  2938: "+20 Spell Penetration",
  368: "+12 Agility",
  884: "+50 Armor",
  1441: "+15 Shadow Resistance",
  // Chest
  2661: "+6 All Stats",
  2659: "+150 Health",
  2933: "+15 Resilience Rating",
  3150: "+6 mana every 5 sec.",
  1144: "+15 Spirit",
  // Wrist
  2650: "+15 Spell Damage",
  2617: "+30 Healing and +10 Spell Damage",
  2647: "+12 Strength",
  2648: "+12 Defense Rating",
  2649: "+12 Stamina",
  369: "+12 Intellect",
  1593: "+24 Attack Power",
  // Hands
  2937: "+20 Spell Damage",
  2935: "+15 Spell Hit Rating",
  2564: "+15 Agility",
  2613: "+2% Threat",
  2614: "+20 Shadow Spell Damage",
  2322: "+35 Healing Spells and +12 Damage Spells",
  684: "+15 Strength",
  // Legs (spellthreads / armor kits)
  2748: "+35 Spell Damage and +20 Stamina",
  2746: "+66 Healing +22 Spell Damage and +20 Stamina",
  2747: "+25 Spell Damage and +15 Stamina",
  2745: "+46 Healing +16 Spell Damage and +15 Stamina",
  3012: "+50 Attack Power and +12 Critical Strike Rating",
  3010: "+40 Attack Power and +10 Critical Strike Rating",
  3013: "+40 Stamina and +12 Agility",
  // Feet
  2940: "Minor Speed and +9 Stamina",
  2939: "Minor Speed and +6 Agility",
  2657: "+12 Agility",
  2656: "Vitality",
  911: "Minor Speed Increase",
  929: "+7 Stamina",
  // Weapons
  2673: "Mongoose",
  2672: "Soulfrost",
  2671: "Sunfire",
  2669: "+40 Spell Damage and Healing",
  2670: "+35 Agility",
  2666: "+30 Intellect",
  2343: "+81 Healing Spells and +27 Damage Spells",
  1900: "Crusader",
  // Off-hand / shield
  2654: "+12 Intellect",
  2655: "+15 Shield Block Rating",
  3229: "+12 Resilience Rating",
  1071: "+18 Stamina",
  // Ranged scopes
  2724: "Scope (+28 Critical Strike Rating)",
  2723: "Scope (+12 Damage)",
};
