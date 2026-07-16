// Deterministic, offline unit tests for the Wipe Autopsy (CSI) engine.
// Run with: node --test
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseReportUrl } from "../js/csi/parse-url.js";
import { normalizeEvent, normalizeActors, playerRoles, normalizeFight } from "../js/csi/normalize.js";
import { actorIndex } from "../js/csi/format.js";
import { applyMechanicRules, mechanicFindings } from "../js/csi/mechanics.js";
import { RULES, lookupRule } from "../js/csi/rules.js";
import { RULE_SPELL_IDS } from "../js/csi/rule-ids.js";
import { summarizeFight } from "../js/csi/summary.js";
import { buildRaidPrep, classifyConsumables, classifyTalents, playerList } from "../js/csi/prep.js";

// --- helpers ---------------------------------------------------------------
const idxOf = (actors) => new Map(actors.map((a) => [a.id, a]));
const dmg = (t, tgt, ab, amt, opts = {}) => ({
  timestamp: t, type: "damage", sourceId: opts.src ?? "boss", targetId: tgt,
  abilityName: ab, abilityId: opts.id, amount: amt, avoidable: opts.avoidable, hpPct: opts.hp,
});
const heal = (t, src, tgt, ab, amt, hp) => ({
  timestamp: t, type: "heal", sourceId: src, targetId: tgt, abilityName: ab, amount: amt, hpPct: hp,
});
const cast = (t, src, ab) => ({ timestamp: t, type: "cast", sourceId: src, abilityName: ab });
const death = (t, tgt) => ({ timestamp: t, type: "death", targetId: tgt });
const fight = (events, extra = {}) => ({ id: "f", bossName: "Test Boss", durationMs: 60000, kill: false, events, ...extra });

// --- parse-url -------------------------------------------------------------
test("parseReportUrl: full url with fight fragment", () => {
  const p = parseReportUrl("https://classic.warcraftlogs.com/reports/aBc123Def456Ghi7#fight=5");
  assert.equal(p.reportCode, "aBc123Def456Ghi7");
  assert.equal(p.fightId, 5);
});
test("parseReportUrl: #fight=last and bare code", () => {
  assert.equal(parseReportUrl("https://www.warcraftlogs.com/reports/aBc123Def456Ghi7#fight=last").fightId, "last");
  assert.equal(parseReportUrl("aBc123Def456Ghi7").reportCode, "aBc123Def456Ghi7");
});
test("parseReportUrl: rejects lookalike domain and garbage", () => {
  assert.equal(parseReportUrl("https://evilwarcraftlogs.com/reports/aBc123Def456Ghi7"), null);
  assert.equal(parseReportUrl("not a url"), null);
});

// --- normalize -------------------------------------------------------------
test("normalizeEvent: maps fields, computes HP%, drops unknown types", () => {
  const abilities = new Map([[100, "Melee"]]);
  const ev = normalizeEvent(
    { timestamp: 1500, type: "damage", sourceID: 9, targetID: 4, abilityGameID: 100, amount: 500, hitPoints: 73, maxHitPoints: 100 },
    1000, abilities);
  assert.equal(ev.timestamp, 500);
  assert.equal(ev.sourceId, "9");
  assert.equal(ev.targetId, "4");
  assert.equal(ev.abilityName, "Melee");
  assert.equal(ev.hpPct, 73);
  assert.equal(normalizeEvent({ type: "combatantinfo" }, 0, abilities), null);
});
test("normalizeEvent: heal overheal maps to overkill", () => {
  const ev = normalizeEvent({ timestamp: 0, type: "heal", amount: 100, overheal: 40 }, 0, new Map());
  assert.equal(ev.overkill, 40);
});
test("playerRoles + normalizeActors: roles/specs and npc handling", () => {
  const pd = { data: { playerDetails: {
    tanks: [{ id: 1, name: "T", type: "Paladin", specs: [{ spec: "Protection" }] }],
    healers: [], dps: [{ id: 3, name: "D", type: "Mage", specs: [{ spec: "Frost" }] }],
  } } };
  const roles = playerRoles(pd);
  assert.deepEqual(roles.get(1), ["tank", "Protection"]);
  const actors = normalizeActors(
    [{ id: 1, name: "T", type: "Player", subType: "Paladin" }, { id: 2, name: "Boss", type: "NPC" }],
    pd);
  const t = actors.find((a) => a.id === "1");
  assert.equal(t.role, "tank");
  assert.equal(t.spec, "Protection");
  assert.equal(actors.find((a) => a.id === "2").type, "npc");
});
test("normalizeFight: scales bossPercentage and computes duration", () => {
  const f = normalizeFight({ id: 5, name: "X", startTime: 1000, endTime: 4000, kill: false, bossPercentage: 1800 }, 0);
  assert.equal(f.durationMs, 3000);
  assert.equal(f.bossPercentRemaining, 18);
});

// --- mechanics -------------------------------------------------------------
test("mechanics: friendly-sourced damage never matches a boss rule (except chains)", () => {
  const idx = idxOf([{ id: "w1", role: "dps" }, { id: "p2", role: "dps" }]);
  const f = fight([
    // warlock's own Hellfire: friendly source, non-chain rule -> ignored
    { timestamp: 1000, type: "damage", sourceId: "w1", targetId: "w1", abilityName: "Hellfire", amount: 500, sourceFriendly: true },
    // Gruul Shatter propagates FROM a friendly player: chain rule -> still tagged
    { timestamp: 2000, type: "damage", sourceId: "w1", targetId: "p2", abilityName: "Shatter", amount: 800, sourceFriendly: true },
  ]);
  const s = summarizeFight(f, idx);
  assert.ok(!s.mechanics.some((m) => m.ability === "Hellfire"), "Hellfire false positive");
  assert.ok(s.mechanics.some((m) => m.ability === "Shatter"), "friendly-source chain lost");
});

test("normalizeEvent: carries sourceIsFriendly through as sourceFriendly", () => {
  const ev = normalizeEvent(
    { timestamp: 100, type: "damage", sourceID: 1, targetID: 1, amount: 5, sourceIsFriendly: true },
    0, new Map());
  assert.equal(ev.sourceFriendly, true);
});

test("summary: rotational Holy Shield no longer suppresses 'unmitigated'", () => {
  const f = fight([
    cast(40000, "t1", "Holy Shield"), // rotational, up ~always on prot paladins
    dmg(54000, "t1", "Melee", 9000), death(55000, "t1"),
  ]);
  const s = summarizeFight(f, idxOf([{ id: "t1", name: "Pally", role: "tank" }]));
  assert.match(s.primaryCause.text, /unmitigated/);
});

test("summary: external Pain Suppression is named with its caster", () => {
  const f = fight([
    { timestamp: 53000, type: "cast", sourceId: "p1", targetId: "t1", abilityName: "Pain Suppression" },
    dmg(54000, "t1", "Melee", 9000), death(55000, "t1"),
  ]);
  const s = summarizeFight(f, idxOf([
    { id: "t1", name: "Warr", role: "tank" }, { id: "p1", name: "Priesty", role: "healer" },
  ]));
  assert.match(s.primaryCause.text, /Pain Suppression from Priesty/);
});

test("applyMechanicRules: tags avoidable; frontal is role-aware", () => {
  const actors = [{ id: "dps1", role: "dps" }, { id: "t1", role: "tank" }];
  const f = fight([
    dmg(1000, "dps1", "Cave In", 500),   // avoidable everywhere
    dmg(1000, "dps1", "Cleave", 400),    // frontal -> avoidable for dps
    dmg(1000, "t1", "Cleave", 400),      // frontal -> expected on tank
  ]);
  applyMechanicRules(f, idxOf(actors));
  assert.equal(f.events[0].avoidable, true);
  assert.equal(f.events[1].avoidable, true);
  assert.ok(!f.events[2].avoidable);
});
test("lookupRule: game ID is the primary key, name is the fallback", () => {
  // 38235 = Hydross Water Tomb, harvested live; guards the generated map too.
  const byId = lookupRule("Totally Mangled Name", 38235);
  assert.equal(byId?.category, "chain");
  assert.equal(byId, lookupRule("Water Tomb")); // name fallback finds the same rule
  assert.equal(lookupRule(undefined, 38235), byId); // ID alone is enough
  assert.equal(lookupRule("Nonsense", 999999999), null); // unknown ID + unknown name
  assert.equal(lookupRule("Water Tomb", 999999999), byId); // unknown ID falls back to name
});

test("rule-ids: every generated ID maps to an existing catalogue entry", () => {
  const entries = Object.entries(RULE_SPELL_IDS);
  assert.ok(entries.length >= 40, `suspiciously small generated map (${entries.length})`);
  for (const [id, key] of entries) {
    assert.ok(RULES[key], `rule-ids ${id} -> "${key}" has no RULES entry`);
  }
});

test("applyMechanicRules: ID-only match tags avoidable when the name is unknown", () => {
  const idx = idxOf([{ id: "p1", role: "dps" }]);
  const f = fight([
    dmg(1000, "p1", "Renamed By WCL", 500, { id: 36240 }), // Gruul Cave In by ID
    dmg(2000, "p1", "Renamed By WCL", 500),                // same name, no ID -> no match
  ]);
  applyMechanicRules(f, idx);
  assert.equal(f.events[0].avoidable, true);
  assert.ok(!f.events[1].avoidable);
});

test("mechanicFindings: nameless ID-only match is labeled with its ID", () => {
  const idx = idxOf([{ id: "p1", role: "dps" }]);
  const f = fight([dmg(1000, "p1", undefined, 500, { id: 36240 })]);
  applyMechanicRules(f, idx);
  const ms = mechanicFindings(f, idx);
  assert.equal(ms.length, 1);
  assert.equal(ms[0].ability, "#36240");
});

test("mechanicFindings: surfaces raidwide criticals (Blast Nova) and labels with the fight boss", () => {
  const actors = [{ id: "p1", role: "dps" }];
  const f = fight([dmg(1000, "p1", "Blast Nova", 9000), dmg(2000, "p1", "Whirlwind", 500)],
    { bossName: "Leotheras the Blind" });
  const idx = idxOf(actors);
  applyMechanicRules(f, idx);
  const ms = mechanicFindings(f, idx);
  const bn = ms.find((m) => m.ability === "Blast Nova");
  assert.ok(bn && bn.raidLevel === true);
  const ww = ms.find((m) => m.ability === "Whirlwind");
  assert.equal(ww.encounter, "Leotheras the Blind"); // boss label, not catalogue guess
});

// --- deaths + summary (regression tests for the code-review fixes) ----------
test("death recap: Healthstone used early in fight is not reported as unused", () => {
  const f = fight([
    heal(5000, "p1", "p1", "Healthstone", 2000), // early, outside the 20s window
    dmg(52000, "p1", "Melee", 4000), dmg(54000, "p1", "Melee", 5000), death(55000, "p1"),
  ]);
  const s = summarizeFight(f, idxOf([{ id: "p1", name: "P", role: "dps" }]));
  const notes = s.deaths[0].notes.join(" | ");
  assert.ok(!/No Healthstone/.test(notes), notes);
});
test("death timeline: carries healer source and HP% per event", () => {
  const f = fight([
    heal(53000, "h1", "p1", "Holy Light", 3000, 80), dmg(54000, "p1", "Melee", 5000, { hp: 40 }), death(55000, "p1"),
  ]);
  const s = summarizeFight(f, idxOf([{ id: "p1", name: "P", role: "dps" }, { id: "h1", name: "Lightwell", role: "healer" }]));
  const tl = s.deaths[0].timeline;
  const healRow = tl.find((e) => e.kind === "heal");
  assert.equal(healRow.source, "Lightwell");
  assert.equal(healRow.hpPct, 80);
  assert.equal(tl.find((e) => e.kind === "damage").hpPct, 40);
});
test("summary: tank death with a defensive up is not called 'unmitigated'", () => {
  const f = fight([cast(52000, "t1", "Shield Wall"), dmg(54000, "t1", "Melee", 9000), death(55000, "t1")]);
  const s = summarizeFight(f, idxOf([{ id: "t1", name: "Tank", role: "tank" }]));
  assert.ok(!/unmitigated/.test(s.primaryCause.text), s.primaryCause.text);
});
test("summary: healers dying last are not the root cause", () => {
  const f = fight([
    dmg(9000, "d1", "Melee", 6000), death(10000, "d1"),
    dmg(55000, "h1", "Melee", 4000), death(56000, "h1"),
    dmg(57000, "h2", "Melee", 4000), death(58000, "h2"),
  ]);
  const s = summarizeFight(f, idxOf([
    { id: "d1", name: "R", role: "dps" }, { id: "h1", name: "P", role: "healer" }, { id: "h2", name: "D", role: "healer" },
  ]));
  assert.ok(!/^Healer deaths/.test(s.primaryCause.text), s.primaryCause.text);
});
test("summary: 3+ avoidable-mechanic deaths is the primary cause", () => {
  const A = (id, t) => [dmg(t - 500, id, "Cave In", 5000, { avoidable: true }), death(t, id)];
  const f = fight([...A("d1", 30000), ...A("d2", 32000), ...A("d3", 34000)]);
  const s = summarizeFight(f, idxOf([
    { id: "d1", role: "dps" }, { id: "d2", role: "dps" }, { id: "d3", role: "dps" },
  ]));
  assert.match(s.primaryCause.text, /avoidable mechanics/);
});

// --- raid prep -------------------------------------------------------------
const REQ_SLOTS = [0, 2, 14, 4, 8, 9, 6, 7, 15];
const gearWith = (missingSlot) => REQ_SLOTS.map((s) => ({
  slot: s, id: 100 + s, itemLevel: 120, quality: 4, name: `Item${s}`,
  permanentEnchant: s === missingSlot ? 0 : 1,
}));

test("classifyConsumables: flask vs elixirs vs food, ignoring other buffs", () => {
  const c = classifyConsumables([
    { name: "Flask of Relentless Assault" },
    { name: "Well Fed" },
    { name: "Elixir of Draenic Wisdom" },
    { name: "Drums of Battle" },
    { name: "Power Word: Fortitude" }, // not a consumable
  ]);
  assert.equal(c.flask, "Flask of Relentless Assault");
  assert.equal(c.food, true);
  assert.equal(c.drums, true);
  assert.deepEqual(c.elixirs, ["Elixir of Draenic Wisdom"]);
  assert.equal(c.flaskReady, true);
  assert.equal(c.unknown, false);
  const none = classifyConsumables([]);
  assert.equal(none.flask, null);
  assert.equal(none.food, false);
  assert.deepEqual(none.elixirs, []);
  assert.equal(none.flaskReady, false);
  assert.equal(none.unknown, false); // empty is a real answer, not unknown
});

test("classifyConsumables: Unstable Flasks count; null input is unknown", () => {
  const uf = classifyConsumables([{ name: "Unstable Flask of the Bandit" }]);
  assert.equal(uf.flask, "Unstable Flask of the Bandit");
  assert.equal(uf.flaskReady, true);
  // failed fetch (null) -> unknown, distinct from genuinely-unprepped
  const unk = classifyConsumables(null);
  assert.equal(unk.unknown, true);
  assert.equal(unk.flaskReady, false);
});

test("classifyConsumables: battle + guardian elixir pair is flask-equivalent", () => {
  const pair = classifyConsumables([
    { name: "Adept's Elixir" },            // battle
    { name: "Elixir of Major Fortitude" }, // guardian
  ]);
  assert.equal(pair.battle, "Adept's Elixir");
  assert.equal(pair.guardian, "Elixir of Major Fortitude");
  assert.equal(pair.flaskReady, true);

  // one elixir is only half-prepped
  const half = classifyConsumables([{ name: "Elixir of Major Agility" }]);
  assert.equal(half.battle, "Elixir of Major Agility");
  assert.equal(half.guardian, null);
  assert.equal(half.flaskReady, false);

  // two unknown-name elixirs still count (game caps one battle + one guardian)
  const unknowns = classifyConsumables([{ name: "Elixir of Weird" }, { name: "Elixir of Odd" }]);
  assert.equal(unknowns.flaskReady, true);
});

test("classifyTalents: per-tree totals -> named trees + primary spec", () => {
  // warrior [21,40,0] (raw {id} shape) -> Fury
  const t = classifyTalents([{ id: 21 }, { id: 40 }, { id: 0 }], "Warrior");
  assert.equal(t.distribution, "21/40/0");
  assert.equal(t.spec, "Fury");
  assert.equal(t.total, 61);
  assert.deepEqual(t.trees.map((x) => x.name), ["Arms", "Fury", "Protection"]);
  // shaman [41,0,20] -> Elemental
  assert.equal(classifyTalents([{ id: 41 }, { id: 0 }, { id: 20 }], "Shaman").spec, "Elemental");
  // no data / malformed -> null
  assert.equal(classifyTalents([{ id: 0 }, { id: 0 }, { id: 0 }], "Mage"), null);
  assert.equal(classifyTalents([], "Mage"), null);
  assert.equal(classifyTalents(undefined, "Mage"), null);
});

test("playerList: flattens roles with ids", () => {
  const pd = { data: { playerDetails: {
    tanks: [{ id: 1, name: "T" }], healers: [], dps: [{ id: 3, name: "D" }],
  } } };
  assert.deepEqual(playerList(pd), [
    { id: 1, name: "T", role: "tank" }, { id: 3, name: "D", role: "dps" },
  ]);
});

test("buildRaidPrep: dual-role player listed in two buckets appears once, as the higher role", () => {
  const pd = { data: { playerDetails: {
    tanks: [{ id: 7, name: "Hayvann", type: "Druid" }],
    healers: [],
    dps: [{ id: 7, name: "Hayvann", type: "Druid" }, { id: 8, name: "Other", type: "Mage" }],
  } } };
  const prep = buildRaidPrep(pd);
  assert.equal(prep.raidSize, 2);
  assert.deepEqual(prep.players.map((p) => `${p.name}:${p.role}`), ["Hayvann:tank", "Other:dps"]);
});

test("buildRaidPrep: per-player gear/enchants + consumables, coverage, ordering", () => {
  const pd = { data: { playerDetails: {
    tanks: [{ id: 1, name: "Tankman", type: "Paladin", combatantInfo: { gear: gearWith(9) } }], // missing Hands
    healers: [{ id: 2, name: "Noinfo", type: "Priest" }], // no combatantInfo
    dps: [{ id: 3, name: "Dpsguy", type: "Rogue", combatantInfo: { gear: gearWith(null) } }], // all enchanted
  } } };
  const cons = {
    1: [{ name: "Flask of Fortification" }, { name: "Well Fed" }],
    3: [{ name: "Elixir of Major Agility" }],
  };
  const talents = { 1: [{ id: 0 }, { id: 47 }, { id: 14 }] }; // Paladin -> Protection
  const r = buildRaidPrep(pd, cons, talents);
  assert.equal(r.players.find((p) => p.name === "Tankman").talents.spec, "Protection");
  assert.equal(r.players.find((p) => p.name === "Dpsguy").talents, null); // no talent data
  assert.equal(r.raidSize, 3);
  assert.equal(r.coverage.flaskReady, 1); // only Tankman (Dpsguy has one elixir)
  assert.equal(r.coverage.food, 1);
  assert.equal(r.coverage.consumablesCovered, 2); // Noinfo's buffs were never fetched
  assert.equal(r.coverage.gearCovered, 2);
  assert.equal(r.coverage.enchanted, 1); // only Dpsguy is fully enchanted
  assert.equal(r.coverage.fullyReady, 1); // Noinfo: all data unknown -> lenient

  const tank = r.players.find((p) => p.name === "Tankman");
  assert.equal(tank.class, "Paladin");
  assert.equal(tank.missingCount, 1);
  assert.equal(tank.issues, 1); // enchant only; flask + food are covered
  assert.equal(tank.consumables.flask, "Flask of Fortification");
  // gear rows carry per-item enchant details for the UI
  const hands = tank.gear.find((g) => g.slotLabel === "Hands");
  assert.equal(hands.enchant, null);
  assert.equal(hands.enchantable, true);
  const head = tank.gear.find((g) => g.slotLabel === "Head");
  assert.ok(head.enchant); // enchanted item resolves to a name
  assert.equal(head.enchantId, 1); // raw enchant id exposed for Wowhead links
  assert.equal(hands.enchantId, null);

  const noinfo = r.players.find((p) => p.name === "Noinfo");
  assert.equal(noinfo.hasGear, false);
  assert.equal(noinfo.missingCount, null);
  assert.equal(noinfo.consumables.unknown, true); // no entry -> unknown
  assert.equal(noinfo.issues, 0); // unknown data is never blamed as an issue

  // ordering: tank bucket first, dps last
  assert.equal(r.players[0].role, "tank");
  assert.equal(r.players.at(-1).role, "dps");
});
