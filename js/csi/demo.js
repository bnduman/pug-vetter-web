"use strict";
// Hand-authored demo report: two Gruul's Lair wipes. Lets the Wipe Autopsy tab
// be tried without a live lookup. Event timestamps are ms from each fight start.

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

// --- demo raid-prep (same shape as prep.js buildRaidPrep) -------------------
// Gear rows carry only the fields the prep UI renders.
const gi = (slotLabel, name, quality, enchant, enchantable = true) =>
  ({ slotLabel, name, quality, enchant, enchantable });

const TANK_GEAR = [
  gi("Head", "Justicar Faceguard", 4, "Glyph of the Defender"),
  gi("Shoulder", "Justicar Shoulderguards", 4, "Greater Inscription of Warding"),
  gi("Back", "Devilshark Cape", 4, "Enchant Cloak - Dodge"),
  gi("Chest", "Justicar Chestguard", 4, "Enchant Chest - Exceptional Health"),
  gi("Wrist", "Bracers of the Green Fortress", 4, "Enchant Bracer - Major Defense"),
  gi("Hands", "Justicar Handguards", 4, "Enchant Gloves - Major Agility"),
  gi("Legs", "Unwavering Legguards", 4, "Nethercobra Leg Armor"),
  gi("Feet", "Boots of Elusion", 4, "Enchant Boots - Fortitude"),
  gi("Main Hand", "The Sun Eater", 4, "Enchant Weapon - Mongoose"),
  gi("Off Hand", "Aldori Legacy Defender", 4, "Enchant Shield - Major Stamina"),
  gi("Trinket", "Moroes' Lucky Pocket Watch", 4, null, false),
];
const ROGUE_GEAR = [
  gi("Head", "Netherblade Facemask", 4, "Glyph of Ferocity"),
  gi("Shoulder", "Netherblade Shoulderpads", 4, "Greater Inscription of Vengeance"),
  gi("Back", "Drape of the Dark Reavers", 4, "Enchant Cloak - Greater Agility"),
  gi("Chest", "Netherblade Chestpiece", 4, "Enchant Chest - Exceptional Stats"),
  gi("Wrist", "Nightfall Wristguards", 4, "Enchant Bracer - Brawn"),
  gi("Hands", "Netherblade Gloves", 4, null),
  gi("Legs", "Skulker's Greaves", 4, "Nethercobra Leg Armor"),
  gi("Feet", "Edgewalker Longboots", 4, null),
  gi("Main Hand", "Latro's Shifting Sword", 4, "Enchant Weapon - Mongoose"),
  gi("Off Hand", "The Night Blade", 4, "Enchant Weapon - Executioner"),
  gi("Trinket", "Bloodlust Brooch", 4, null, false),
];
const SHORT_GEAR = (missingSlot = null) => [
  gi("Head", "Light-Collar of the Incarnate", 4, "Glyph of Renewal"),
  gi("Back", "Shawl of Shifting Probabilities", 4, missingSlot === "Back" ? null : "Enchant Cloak - Subtlety"),
  gi("Chest", "Robes of the Incarnate", 4, "Enchant Chest - Restore Mana Prime"),
  gi("Main Hand", "Light's Justice", 4, "Enchant Weapon - Major Healing"),
];

const P = (id, name, role, gear, missingCount, flask, elixirs, food) => ({
  id, name, role, hasGear: gear.length > 0, missingCount, gear,
  consumables: { flask, elixirs, food },
});

function demoPrep() {
  return {
    raidSize: 9,
    coverage: { flask: 3, elixir: 3, food: 7, enchanted: 6, gearCovered: 9 },
    players: [
      P(1, "Sahmeran", "tank", TANK_GEAR, 0, "Flask of Fortification", [], true),
      P(2, "Thornblade", "tank", SHORT_GEAR(), 0, null, ["Elixir of Major Fortitude", "Elixir of Mastery"], true),
      P(3, "Shockheal", "healer", SHORT_GEAR("Back"), 1, null, [], true),
      P(4, "Lightwell", "healer", SHORT_GEAR(), 0, "Flask of Mighty Restoration", [], true),
      P(5, "Naturae", "healer", SHORT_GEAR(), 0, null, ["Elixir of Draenic Wisdom"], false),
      P(6, "Backstabz", "dps", ROGUE_GEAR, 2, null, [], false),
      P(7, "Huntex", "dps", SHORT_GEAR("Back"), 1, null, [], true),
      P(8, "Frostmage", "dps", SHORT_GEAR(), 0, "Flask of Supreme Power", [], true),
      P(9, "Shadowlock", "dps", SHORT_GEAR(), 0, null, ["Adept's Elixir", "Elixir of Major Shadow Power"], true),
    ],
  };
}

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
