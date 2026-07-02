"use strict";
// Hand-authored demo report: two Gruul's Lair wipes. Lets the Wipe Autopsy tab
// be tried without a live lookup. Event timestamps are ms from each fight start.
import { buildRaidPrep } from "./prep.js";

const actors = [
  { id: "gruul", name: "Gruul the Dragonkiller", type: "npc" },
  { id: "sahm", name: "Sahmeran", type: "player", class: "Paladin", spec: "Protection", role: "tank" },
  { id: "thorn", name: "Thornblade", type: "player", class: "Warrior", spec: "Protection", role: "tank" },
  { id: "light", name: "Lightwell", type: "player", class: "Priest", spec: "Holy", role: "healer" },
  { id: "natu", name: "Naturae", type: "player", class: "Druid", spec: "Restoration", role: "healer" },
  { id: "shock", name: "Shockheal", type: "player", class: "Shaman", spec: "Restoration", role: "healer" },
  { id: "fmage", name: "Frostmage", type: "player", class: "Mage", spec: "Frost", role: "dps" },
  { id: "slock", name: "Shadowlock", type: "player", class: "Warlock", spec: "Affliction", role: "dps" },
  { id: "bstab", name: "Backstabz", type: "player", class: "Rogue", spec: "Combat", role: "dps" },
  { id: "hunt", name: "Huntex", type: "player", class: "Hunter", spec: "Marksmanship", role: "dps" },
];

const dmg = (timestamp, targetId, abilityName, amount, opts = {}) => ({
  timestamp, type: "damage", sourceId: opts.sourceId ?? "gruul", targetId, abilityName, amount,
  avoidable: opts.avoidable, hpPct: opts.hp,
});
const heal = (timestamp, sourceId, targetId, abilityName, amount, hp) => ({
  timestamp, type: "heal", sourceId, targetId, abilityName, amount, hpPct: hp,
});
const death = (timestamp, targetId, sourceId = "gruul") => ({ timestamp, type: "death", sourceId, targetId });

// --- demo raid-prep ---------------------------------------------------------
// Built through the REAL buildRaidPrep pipeline from fake WCL-shaped inputs,
// so the demo can never drift from the live shape. Raw gear items use WCL
// field names; our enchant-name DB won't know the fake enchant ids, so the
// permanentEnchantName fallback supplies the display name.

// slot numbers: 0 Head, 2 Shoulder, 4 Chest, 6 Legs, 7 Feet, 8 Wrist, 9 Hands,
// 12 Trinket, 14 Back, 15 Main Hand, 16 Off Hand.
// Ids are deliberately out-of-range sentinels: demo Wowhead links land on a
// clean "not found" instead of some unrelated real item, and the fake enchant
// id has no spell mapping so demo enchants render unlinked.
const gi = (slot, name, ench) => ({
  slot, id: 9990000 + slot, name, quality: 4, itemLevel: 120,
  permanentEnchant: ench ? 999999 : 0, permanentEnchantName: ench || undefined,
});

const TANK_GEAR = [
  gi(0, "Justicar Faceguard", "Glyph of the Defender"),
  gi(2, "Justicar Shoulderguards", "Greater Inscription of Warding"),
  gi(14, "Devilshark Cape", "+12 Dodge Rating"),
  gi(4, "Justicar Chestguard", "+150 Health"),
  gi(8, "Bracers of the Green Fortress", "+12 Defense Rating"),
  gi(9, "Justicar Handguards", "+15 Agility"),
  gi(6, "Unwavering Legguards", "Nethercobra Leg Armor"),
  gi(7, "Boots of Elusion", "+12 Stamina"),
  gi(15, "The Sun Eater", "Mongoose"),
  gi(16, "Aldori Legacy Defender", "+18 Stamina"),
  gi(12, "Moroes' Lucky Pocket Watch", null),
];
const ROGUE_GEAR = [
  gi(0, "Netherblade Facemask", "Glyph of Ferocity"),
  gi(2, "Netherblade Shoulderpads", "Greater Inscription of Vengeance"),
  gi(14, "Drape of the Dark Reavers", "+12 Agility"),
  gi(4, "Netherblade Chestpiece", "+6 All Stats"),
  gi(8, "Nightfall Wristguards", "+12 Strength"),
  gi(9, "Netherblade Gloves", null),
  gi(6, "Skulker's Greaves", "Nethercobra Leg Armor"),
  gi(7, "Edgewalker Longboots", null),
  gi(15, "Latro's Shifting Sword", "Mongoose"),
  gi(16, "The Night Blade", "Executioner"),
  gi(12, "Bloodlust Brooch", null),
];
const SHORT_GEAR = (missBack = false) => [
  gi(0, "Light-Collar of the Incarnate", "Glyph of Renewal"),
  gi(14, "Shawl of Shifting Probabilities", missBack ? null : "+12 Spell Penetration"),
  gi(4, "Robes of the Incarnate", "+15 Spirit"),
  gi(15, "Light's Justice", "+81 Healing Spells"),
];

const DP = (id, name, type, gear) => ({ id, name, type, combatantInfo: { gear } });
const demoPlayerDetails = { data: { playerDetails: {
  tanks: [
    DP(1, "Sahmeran", "Paladin", TANK_GEAR),
    DP(2, "Thornblade", "Warrior", SHORT_GEAR()),
  ],
  healers: [
    DP(3, "Shockheal", "Shaman", SHORT_GEAR(true)),
    DP(4, "Lightwell", "Priest", SHORT_GEAR()),
    DP(5, "Naturae", "Druid", SHORT_GEAR()),
  ],
  dps: [
    DP(6, "Backstabz", "Rogue", ROGUE_GEAR),
    DP(7, "Huntex", "Hunter", SHORT_GEAR(true)),
    DP(8, "Frostmage", "Mage", SHORT_GEAR()),
    DP(9, "Shadowlock", "Warlock", SHORT_GEAR()),
  ],
} } };

const B = (...names) => names.map((name) => ({ name }));
const demoConsumables = {
  1: B("Flask of Fortification", "Well Fed"),
  2: B("Elixir of Major Fortitude", "Elixir of Mastery", "Well Fed"), // pair = flask-equivalent
  3: B("Well Fed"),
  4: B("Flask of Mighty Restoration", "Well Fed"),
  5: B("Elixir of Draenic Wisdom"), // guardian only, no food
  6: [],                            // nothing at all
  7: B("Well Fed"),
  8: B("Flask of Supreme Power", "Well Fed"),
  9: B("Elixir of Major Shadow Power", "Elixir of Major Fortitude", "Well Fed"),
};

const demoPrep = () => buildRaidPrep(demoPlayerDetails, demoConsumables);

const fight1 = {
  id: "gruul-1",
  bossName: "Gruul the Dragonkiller",
  encounterId: 649,
  startTime: 1_718_900_000_000,
  endTime: 1_718_900_292_000,
  durationMs: 292_000,
  kill: false,
  bossPercentRemaining: 18,
  prep: demoPrep(),
  events: [
    dmg(15_000, "sahm", "Melee", 2100),
    heal(16_000, "light", "sahm", "Holy Light", 2600),
    dmg(45_000, "sahm", "Melee", 2400),
    dmg(60_000, "thorn", "Hurtful Strike", 3100),
    heal(61_000, "natu", "sahm", "Healing Touch", 2800),
    dmg(120_000, "sahm", "Melee", 2700),
    heal(121_000, "shock", "sahm", "Chain Heal", 2500),
    dmg(180_000, "sahm", "Melee", 3000),
    dmg(181_000, "thorn", "Hurtful Strike", 3400),
    heal(182_000, "light", "sahm", "Flash of Light", 1800),
    dmg(252_000, "fmage", "Cave In", 5210, { sourceId: "env", avoidable: true }),
    dmg(255_500, "fmage", "Cave In", 6100, { sourceId: "env", avoidable: true }),
    dmg(259_800, "fmage", "Cave In", 4300, { sourceId: "env", avoidable: true }),
    death(260_000, "fmage", "env"),
    dmg(277_000, "shock", "Ground Slam", 2200, { avoidable: true }),
    dmg(284_500, "shock", "Shatter", 9000, { avoidable: true }),
    death(284_500, "shock"),
    heal(278_500, "natu", "sahm", "Healing Touch", 3500, 82),
    dmg(279_000, "sahm", "Melee", 4200, { hp: 70 }),
    dmg(281_000, "sahm", "Melee", 3900, { hp: 62 }),
    heal(282_000, "light", "sahm", "Holy Light", 4200, 88),
    dmg(282_500, "sahm", "Melee", 4500, { hp: 74 }),
    dmg(284_000, "sahm", "Crushing Blow", 5100, { hp: 52 }),
    dmg(285_500, "sahm", "Melee", 4800, { hp: 33 }),
    dmg(286_800, "sahm", "Crushing Blow", 7840, { hp: 0 }),
    death(287_000, "sahm"),
  ],
};

const fight2 = {
  id: "gruul-2",
  bossName: "Gruul the Dragonkiller",
  encounterId: 649,
  startTime: 1_718_900_600_000,
  endTime: 1_718_900_738_000,
  durationMs: 138_000,
  kill: false,
  bossPercentRemaining: 62,
  events: [
    dmg(20_000, "sahm", "Melee", 2300),
    heal(21_000, "light", "sahm", "Holy Light", 2700),
    dmg(50_000, "thorn", "Hurtful Strike", 3000),
    heal(51_000, "natu", "sahm", "Healing Touch", 2600),
    dmg(86_000, "bstab", "Cave In", 4800, { sourceId: "env", avoidable: true }),
    dmg(89_000, "bstab", "Cave In", 5200, { sourceId: "env", avoidable: true }),
    death(90_500, "bstab", "env"),
    dmg(94_000, "hunt", "Cave In", 4600, { sourceId: "env", avoidable: true }),
    dmg(97_000, "hunt", "Cave In", 5400, { sourceId: "env", avoidable: true }),
    death(98_000, "hunt", "env"),
    dmg(104_000, "slock", "Shatter", 7300, { avoidable: true }),
    death(105_000, "slock"),
    dmg(120_000, "sahm", "Melee", 3100),
    dmg(131_000, "sahm", "Melee", 3600),
    dmg(135_000, "sahm", "Crushing Blow", 5200),
    dmg(137_500, "sahm", "Crushing Blow", 8100),
    death(138_000, "sahm"),
  ],
};

export const gruulDemo = {
  id: "demo-gruul",
  source: "demo",
  title: "Gruul's Lair — Progression Night (demo)",
  owner: "Sahmeran",
  zone: "Gruul's Lair",
  game: "tbc-classic",
  actors,
  fights: [fight1, fight2],
};
