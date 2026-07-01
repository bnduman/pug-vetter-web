// Deterministic, offline unit tests for the Wipe Autopsy (CSI) engine.
// Run with: node --test
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseReportUrl } from "../js/csi/parse-url.js";
import { normalizeEvent, normalizeActors, playerRoles, normalizeFight } from "../js/csi/normalize.js";
import { actorIndex } from "../js/csi/format.js";
import { applyMechanicRules, mechanicFindings } from "../js/csi/mechanics.js";
import { summarizeFight } from "../js/csi/summary.js";
import { buildRaidPrep, classifyConsumables, playerList } from "../js/csi/prep.js";

// --- helpers ---------------------------------------------------------------
const idxOf = (actors) => new Map(actors.map((a) => [a.id, a]));
const dmg = (t, tgt, ab, amt, opts = {}) => ({
  timestamp: t, type: "damage", sourceId: opts.src ?? "boss", targetId: tgt,
  abilityName: ab, amount: amt, avoidable: opts.avoidable, hpPct: opts.hp,
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
    { name: "Power Word: Fortitude" }, // not a consumable
  ]);
  assert.equal(c.flask, "Flask of Relentless Assault");
  assert.equal(c.food, true);
  assert.deepEqual(c.elixirs, ["Elixir of Draenic Wisdom"]);
  const none = classifyConsumables([]);
  assert.equal(none.flask, null);
  assert.equal(none.food, false);
  assert.deepEqual(none.elixirs, []);
});

test("playerList: flattens roles with ids", () => {
  const pd = { data: { playerDetails: {
    tanks: [{ id: 1, name: "T" }], healers: [], dps: [{ id: 3, name: "D" }],
  } } };
  assert.deepEqual(playerList(pd), [
    { id: 1, name: "T", role: "tank" }, { id: 3, name: "D", role: "dps" },
  ]);
});

test("buildRaidPrep: per-player gear/enchants + consumables, coverage, ordering", () => {
  const pd = { data: { playerDetails: {
    tanks: [{ id: 1, name: "Tankman", combatantInfo: { gear: gearWith(9) } }], // missing Hands
    healers: [{ id: 2, name: "Noinfo" }], // no combatantInfo
    dps: [{ id: 3, name: "Dpsguy", combatantInfo: { gear: gearWith(null) } }], // all enchanted
  } } };
  const cons = {
    1: [{ name: "Flask of Fortification" }, { name: "Well Fed" }],
    3: [{ name: "Elixir of Major Agility" }],
  };
  const r = buildRaidPrep(pd, cons);
  assert.equal(r.raidSize, 3);
  assert.equal(r.coverage.flask, 1);
  assert.equal(r.coverage.elixir, 1);
  assert.equal(r.coverage.food, 1);
  assert.equal(r.coverage.gearCovered, 2);
  assert.equal(r.coverage.enchanted, 1); // only Dpsguy is fully enchanted

  const tank = r.players.find((p) => p.name === "Tankman");
  assert.equal(tank.missingCount, 1);
  assert.equal(tank.consumables.flask, "Flask of Fortification");
  // gear rows carry per-item enchant details for the UI
  const hands = tank.gear.find((g) => g.slotLabel === "Hands");
  assert.equal(hands.enchant, null);
  assert.equal(hands.enchantable, true);
  const head = tank.gear.find((g) => g.slotLabel === "Head");
  assert.ok(head.enchant); // enchanted item resolves to a name

  const noinfo = r.players.find((p) => p.name === "Noinfo");
  assert.equal(noinfo.hasGear, false);
  assert.equal(noinfo.missingCount, null);

  // ordering: tank bucket first, dps last
  assert.equal(r.players[0].role, "tank");
  assert.equal(r.players.at(-1).role, "dps");
});
