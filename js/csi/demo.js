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
  timestamp, type: "damage", sourceId: opts.sourceId ?? "gruul", targetId, abilityName, amount, avoidable: opts.avoidable,
});
const heal = (timestamp, sourceId, targetId, abilityName, amount) => ({
  timestamp, type: "heal", sourceId, targetId, abilityName, amount,
});
const death = (timestamp, targetId, sourceId = "gruul") => ({ timestamp, type: "death", sourceId, targetId });

const fight1 = {
  id: "gruul-1",
  bossName: "Gruul the Dragonkiller",
  encounterId: 649,
  startTime: 1_718_900_000_000,
  endTime: 1_718_900_292_000,
  durationMs: 292_000,
  kill: false,
  bossPercentRemaining: 18,
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
    heal(278_500, "natu", "sahm", "Healing Touch", 3500),
    dmg(279_000, "sahm", "Melee", 4200),
    dmg(281_000, "sahm", "Melee", 3900),
    heal(282_000, "light", "sahm", "Holy Light", 4200),
    dmg(282_500, "sahm", "Melee", 4500),
    dmg(284_000, "sahm", "Crushing Blow", 5100),
    dmg(285_500, "sahm", "Melee", 4800),
    dmg(286_800, "sahm", "Crushing Blow", 7840),
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
