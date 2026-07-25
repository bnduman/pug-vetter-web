"use strict";
// The raid-debuff checklist: effects the raid is supposed to keep on the boss.
//
// Grouped into SLOTS rather than spells, because several spells fill the same
// role and do NOT stack — Faerie Fire and Faerie Fire (Feral) are the same
// armour debuff from a balance vs a feral druid; Sunder Armor and Expose Armor
// compete for one slot; Demoralizing Shout and Demoralizing Roar likewise. A
// slot's uptime is therefore the UNION of its spells' bands, never their sum.
//
// `providers` is the list of classes that can apply the slot at all, and
// `specs` narrows that to the talent trees that actually grant it. Together
// they stop the card calling a debuff "missing" when nobody in the raid could
// have applied it: 0% Winter's Chill with no mage is a comp fact, and so is 0%
// Misery in a raid whose only priests are healers. A player whose spec we
// couldn't resolve still counts as a possible provider — better to ask about a
// real gap than to silently excuse one.
//
// All ids harvested from live SEND IT logs (2026-07, Kara/Gruul/SSC/TK) via the
// enemy Debuffs table; ranks matter, so these are the exact ids seen in play.
// To extend: read an ability's guid out of that table and add it here.

export const RAID_DEBUFFS = [
  {
    key: "faerie",
    label: "Faerie Fire",
    ids: [26993, 27011],           // Faerie Fire, Faerie Fire (Feral)
    providers: ["Druid"],
    effect: "-610 armour",
    core: true,
  },
  {
    key: "sunder",
    label: "Sunder / Expose Armor",
    ids: [25225, 26866],           // Sunder Armor, Expose Armor
    providers: ["Warrior", "Rogue"],
    effect: "major armour reduction",
    core: true,
  },
  {
    key: "demo",
    label: "Demo Shout / Roar",
    ids: [25203, 26998],           // Demoralizing Shout, Demoralizing Roar
    providers: ["Warrior", "Druid"],
    effect: "-attack power",
    core: true,
  },
  {
    key: "thunderclap",
    label: "Thunder Clap",
    ids: [25264],
    providers: ["Warrior"],
    effect: "-melee attack speed",
    core: true,
  },
  {
    key: "curse-elements",
    label: "Curse of the Elements",
    ids: [27228],
    providers: ["Warlock"],
    effect: "+spell damage taken",
    core: true,
  },
  {
    key: "misery",
    label: "Misery",
    ids: [33200],
    providers: ["Priest"],
    specs: ["Shadow"],
    effect: "+5% spell damage taken",
    core: true,
  },
  {
    key: "shadow-weaving",
    label: "Shadow Weaving",
    ids: [15258],
    providers: ["Priest"],
    specs: ["Shadow"],
    effect: "+10% shadow damage",
    core: false,
  },
  {
    key: "judgement",
    label: "Judgement",
    ids: [27164, 27159, 27162],    // Wisdom, the Crusader, Light
    providers: ["Paladin"],
    effect: "mana return / +holy damage",
    core: true,
  },
  {
    key: "hunters-mark",
    label: "Hunter's Mark",
    ids: [14325],
    providers: ["Hunter"],
    effect: "+ranged attack power",
    core: true,
  },
  {
    key: "expose-weakness",
    label: "Expose Weakness",
    ids: [34501],
    providers: ["Hunter"],
    specs: ["Survival"],
    effect: "+attack power (agility based)",
    core: false,
  },
  {
    key: "imp-scorch",
    label: "Improved Scorch",
    ids: [22959],                  // Critical Mass / Fire Vulnerability
    providers: ["Mage"],
    specs: ["Fire"],
    effect: "+fire damage taken",
    core: false,
  },
  {
    key: "winters-chill",
    label: "Winter's Chill",
    ids: [12579],
    providers: ["Mage"],
    specs: ["Frost"],
    effect: "+frost crit chance",
    core: false,
  },
  {
    key: "curse-recklessness",
    label: "Curse of Recklessness",
    ids: [27226],
    providers: ["Warlock"],
    effect: "-armour, prevents fear",
    core: false,
  },
  {
    key: "shadow-flame",
    label: "Shadow and Flame",
    ids: [17800],
    providers: ["Warlock"],
    effect: "+shadow/fire crit",
    core: false,
  },
];

/** Every tracked debuff id, for a quick membership test. */
export const RAID_DEBUFF_IDS = new Set(RAID_DEBUFFS.flatMap((d) => d.ids));
