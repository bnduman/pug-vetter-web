// Deterministic, offline unit tests for the Officer tab logic.
// Run with: node --test
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRoster, consumablesByFight, reportCardToDiscord } from "../js/officer-data.js";
import { mergeAlts, resolveMain } from "../js/attendance.js";

// --- per-fight consumables from combatantinfo seeds ---------------------------

test("consumablesByFight: counts flask-equivalent and food per attended pull", () => {
  const flask = { name: "Flask of Relentless Assault" };
  const battle = { name: "Elixir of Major Agility" };
  const guardian = { name: "Elixir of Major Fortitude" };
  const fed = { name: "Well Fed" };
  const rows = [
    // p1: flasked+fed on both pulls
    { fight: 1, sourceID: 1, auras: [flask, fed] },
    { fight: 2, sourceID: 1, auras: [flask, fed] },
    // p2: elixir pair on pull 1 (flask-equivalent), naked on pull 2
    { fight: 1, sourceID: 2, auras: [battle, guardian] },
    { fight: 2, sourceID: 2, auras: [] },
    // p3: single battle elixir is NOT flask-equivalent
    { fight: 1, sourceID: 3, auras: [battle, fed] },
    // junk rows are ignored
    { fight: null, sourceID: 1, auras: [flask] },
    { fight: 2, auras: [flask] },
  ];
  const m = consumablesByFight(rows);
  assert.deepEqual(m.get(1), { attended: 2, flaskFights: 2, foodFights: 2 });
  assert.deepEqual(m.get(2), { attended: 2, flaskFights: 1, foodFights: 0 });
  assert.deepEqual(m.get(3), { attended: 1, flaskFights: 0, foodFights: 1 });
});

test("consumablesByFight: missing auras array counts as an unprepped pull", () => {
  const m = consumablesByFight([{ fight: 1, sourceID: 1 }]);
  assert.deepEqual(m.get(1), { attended: 1, flaskFights: 0, foodFights: 0 });
});

// --- alt bundling --------------------------------------------------------------

test("resolveMain: alt -> main (case-insensitive), others unchanged", () => {
  const alts = { Sahmeran: ["Hayvann"] };
  assert.equal(resolveMain("hayvann", alts), "Sahmeran");
  assert.equal(resolveMain("Hayvann", alts), "Sahmeran");
  assert.equal(resolveMain("Sahmeran", alts), "Sahmeran");
  assert.equal(resolveMain("Peerica", alts), "Peerica");
  assert.equal(resolveMain("x", {}), "x");
});

test("mergeAlts: absorbs alt raids into the main, deduping shared reports", () => {
  const players = {
    sahmeran: { name: "Sahmeran", count: 2, lastTs: 2000, raids: [
      { code: "r2", ts: 2000, zone: "z" }, { code: "r1", ts: 1000, zone: "z" },
    ] },
    hayvann: { name: "Hayvann", count: 2, lastTs: 5000, raids: [
      { code: "r5", ts: 5000, zone: "z" }, { code: "r2", ts: 2000, zone: "z" }, // r2 shared: swapped chars mid-raid
    ] },
    other: { name: "Other", count: 1, lastTs: 1000, raids: [{ code: "r1", ts: 1000, zone: "z" }] },
  };
  mergeAlts(players, { Sahmeran: ["Hayvann"] });
  assert.equal(players.hayvann, undefined);
  const s = players.sahmeran;
  assert.equal(s.count, 3); // r1, r2 (once), r5
  assert.equal(s.lastTs, 5000);
  assert.deepEqual(s.raids.map((r) => r.code), ["r5", "r2", "r1"]); // newest first
  assert.deepEqual(s.alts, ["Hayvann"]);
  assert.equal(players.other.count, 1); // untouched
});

test("mergeAlts: creates the main when only the alt was ever logged", () => {
  const players = {
    hayvann: { name: "Hayvann", count: 1, lastTs: 5000, raids: [{ code: "r5", ts: 5000, zone: "z" }] },
  };
  mergeAlts(players, { Sahmeran: ["Hayvann"] });
  assert.equal(players.sahmeran.name, "Sahmeran");
  assert.equal(players.sahmeran.count, 1);
  assert.deepEqual(players.sahmeran.alts, ["Hayvann"]);
});

test("mergeAlts: unknown alts and empty config are no-ops", () => {
  const players = { peerica: { name: "Peerica", count: 1, lastTs: 1, raids: [{ code: "r1", ts: 1, zone: "z" }] } };
  const before = JSON.stringify(players);
  mergeAlts(players, { Sahmeran: ["Hayvann"], Peerica: [] });
  mergeAlts(players, {});
  assert.equal(JSON.stringify(players), before);
});

test("buildRoster: merged mains carry their alts through", () => {
  const players = {
    sahmeran: { name: "Sahmeran", count: 1, lastTs: 2000, raids: [{ code: "r2", ts: 2000, zone: "z" }] },
    hayvann: { name: "Hayvann", count: 1, lastTs: 1000, raids: [{ code: "r1", ts: 1000, zone: "z" }] },
  };
  mergeAlts(players, { Sahmeran: ["Hayvann"] });
  const { rows } = buildRoster({ guildName: "g", reportsScanned: 2, players });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 2);
  assert.deepEqual(rows[0].alts, ["Hayvann"]);
});

// --- attendance roster -------------------------------------------------------

function attMapOf() {
  // 5 reports r5 (newest) .. r1 (oldest)
  const R = (code, ts) => ({ code, ts, zone: "SSC / TK" });
  const reports = [R("r5", 5000), R("r4", 4000), R("r3", 3000), R("r2", 2000), R("r1", 1000)];
  const raidsFor = (...codes) => reports.filter((r) => codes.includes(r.code));
  return {
    guildName: "SEND IT",
    reportsScanned: 5,
    players: {
      steady: { name: "Steady", count: 5, lastTs: 5000, raids: raidsFor("r1", "r2", "r3", "r4", "r5") },
      fader: { name: "Fader", count: 2, lastTs: 2000, raids: raidsFor("r1", "r2") },
      newpug: { name: "Newpug", count: 1, lastTs: 5000, raids: raidsFor("r5") },
    },
  };
}

test("buildRoster: pct, streak, and fading detection", () => {
  const { totalReports, rows } = buildRoster(attMapOf());
  assert.equal(totalReports, 5);
  const [steady, fader, newpug] = rows; // sorted by count desc
  assert.equal(steady.name, "Steady");
  assert.equal(steady.pct, 100);
  assert.equal(steady.streak, 5);
  assert.equal(steady.fading, false);
  // Fader: 2/5 raids is below the history bar max(3, 20%) = 3 -> NOT fading
  assert.equal(fader.name, "Fader");
  assert.equal(fader.streak, 0);
  assert.equal(fader.fading, false);
  assert.equal(newpug.streak, 1);
});

test("buildRoster: a regular who missed the last 3 reports is fading", () => {
  const map = attMapOf();
  map.players.fader.count = 3;
  map.players.fader.raids = map.players.fader.raids.concat([{ code: "r3", ts: 3000, zone: "x" }]);
  // Fader now has r1,r2,r3 (count 3 >= history bar 3); recentWindow=3 checks
  // r5,r4,r3 and r3 was attended -> still not fading.
  assert.equal(buildRoster(map).rows.find((r) => r.name === "Fader").fading, false);
  // With recentWindow=2 (missed r5+r4) they are.
  assert.equal(buildRoster(map, { recentWindow: 2 }).rows.find((r) => r.name === "Fader").fading, true);
});

// --- discord export ----------------------------------------------------------

test("reportCardToDiscord: worst-first shame lists at <= half of pulls", () => {
  const card = {
    title: "<SEND IT> TK+SSC",
    players: [
      // flask ran out for the last pull only — NOT shamed
      { name: "Good", missingCount: 0, perFight: { attended: 9, flaskFights: 8, foodFights: 9 } },
      { name: "Cheap", missingCount: 2, perFight: { attended: 9, flaskFights: 4, foodFights: 3 } },
      { name: "Cheaper", missingCount: 3, perFight: { attended: 8, flaskFights: 0, foodFights: 3 } },
      { name: "Ghost", missingCount: 0, perFight: null }, // no combat data -> never shamed
    ],
  };
  const text = reportCardToDiscord(card);
  assert.match(text, /Flask\/elixirs on half the pulls or less: Cheaper 0\/8, Cheap 4\/9/);
  assert.match(text, /Food on half the pulls or less: Cheap 3\/9, Cheaper 3\/8/);
  assert.match(text, /Missing enchants: Cheaper \(3\), Cheap \(2\)/);
  assert.ok(!text.includes("Good"), "8/9 flask must not be shamed");
  assert.ok(!text.includes("Ghost 0"), "unknown-data players must not be shamed");

  const clean = reportCardToDiscord({ title: "t", players: [card.players[0]] });
  assert.match(clean, /Flask\/elixirs on half the pulls or less: nobody 🎉/);
});
