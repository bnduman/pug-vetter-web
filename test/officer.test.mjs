// Deterministic, offline unit tests for the Officer tab logic.
// Run with: node --test
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRoster, consumablesByFight, reportCardToDiscord } from "../js/officer-data.js";
import { mergeAlts, resolveMain } from "../js/attendance.js";
import {
  avoidableFromDamageTaken, deathsByPlayer, interruptsFromTable,
} from "../js/officer-stats.js";

// --- per-fight consumables from combatantinfo seeds ---------------------------

test("consumablesByFight: tracks flask-equivalent, any-elixir, food, and names", () => {
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
    // p3: single battle elixir — an elixir, but NOT flask-equivalent
    { fight: 1, sourceID: 3, auras: [battle, fed] },
    // junk rows are ignored
    { fight: null, sourceID: 1, auras: [flask] },
    { fight: 2, auras: [flask] },
  ];
  const m = consumablesByFight(rows);
  assert.deepEqual(m.get(1), {
    attended: 2, flaskFights: 2, elixirFights: 2, foodFights: 2,
    consumables: ["Flask of Relentless Assault"],
  });
  assert.deepEqual(m.get(2), {
    attended: 2, flaskFights: 1, elixirFights: 1, foodFights: 0,
    consumables: ["Elixir of Major Agility", "Elixir of Major Fortitude"],
  });
  // the lone-elixir case that was reading as "0/2 = nothing": now elixirFights=1
  assert.deepEqual(m.get(3), {
    attended: 1, flaskFights: 0, elixirFights: 1, foodFights: 1,
    consumables: ["Elixir of Major Agility"],
  });
});

test("consumablesByFight: missing auras array counts as an unprepped pull", () => {
  const m = consumablesByFight([{ fight: 1, sourceID: 1 }]);
  assert.deepEqual(m.get(1), {
    attended: 1, flaskFights: 0, elixirFights: 0, foodFights: 0, consumables: [],
  });
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

test("buildRoster: limit grades against only the newest N reports", () => {
  const { totalReports, rows } = buildRoster(attMapOf(), { limit: 3 });
  assert.equal(totalReports, 3); // r5, r4, r3
  // Fader attended only r1+r2 -> outside the window, not listed at all
  assert.deepEqual(rows.map((r) => r.name), ["Steady", "Newpug"]);
  const steady = rows[0];
  assert.equal(steady.count, 3); // clipped from 5 to the window
  assert.equal(steady.pct, 100);
  assert.equal(rows[1].count, 1); // Newpug: r5 only
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

test("reportCardToDiscord: shames 'no consumable', lists lone-elixir separately", () => {
  const F = (attended, flaskFights, elixirFights, foodFights) =>
    ({ attended, flaskFights, elixirFights, foodFights });
  const card = {
    title: "<SEND IT> TK+SSC",
    players: [
      // flask ran out for the last pull only — NOT shamed
      { name: "Good", missingCount: 0, missingEnchants: [], perFight: F(9, 8, 8, 9) },
      // ran nothing on most pulls — the real offense
      { name: "Cheaper", missingCount: 3, missingEnchants: [{ slot: "Back" }, { slot: "Feet" }, { slot: "Weapon" }], perFight: F(8, 0, 1, 3) },
      // lone elixir every pull: NOT "no consumable" (elixirFights=9), but flagged partial
      { name: "Elixdude", missingCount: 0, missingEnchants: [], perFight: F(9, 0, 9, 9) },
      { name: "Ghost", missingCount: 0, missingEnchants: [], perFight: null }, // no combat data -> never shamed
    ],
  };
  const text = reportCardToDiscord(card);
  assert.match(text, /No flask\/elixir on half the pulls or less: Cheaper 1\/8/);
  assert.ok(!/No flask\/elixir[^\n]*Elixdude/.test(text), "lone-elixir must not be in the 'no consumable' list");
  assert.match(text, /Single elixir, no flask\/pair: Elixdude/);
  // enchants are itemized by slot, not just counted
  assert.match(text, /Missing enchants: Cheaper \(Back, Feet, Weapon\)/);
  assert.ok(!text.includes("Good"), "flask user must not be shamed anywhere");

  const clean = reportCardToDiscord({ title: "t", players: [card.players[0]] });
  assert.match(clean, /No flask\/elixir on half the pulls or less: nobody 🎉/);
  assert.ok(!clean.includes("Single elixir"), "no partial line when nobody is partial");
});

// --- night stats (officer-stats.js) -----------------------------------------

test("deathsByPlayer: splits boss pulls from trash", () => {
  // fights 10/11 are encounters; 4 is trash.
  const d = deathsByPlayer([
    { id: 1, fight: 10 }, { id: 1, fight: 4 }, { id: 1, fight: 11 },
    { id: 2, fight: 4 },
    { id: null, fight: 10 },      // no player id -> ignored
  ], new Set([10, 11]));
  assert.deepEqual(d.get(1), { total: 3, boss: 2, trash: 1 });
  assert.deepEqual(d.get(2), { total: 1, boss: 0, trash: 1 });
  assert.equal(d.size, 2);
  assert.deepEqual(deathsByPlayer(null, []).size, 0);
});

test("avoidableFromDamageTaken: role-aware, and sums only tracked mechanics", () => {
  // Cave In (36240) is 'avoidable'; Cleave is 'frontal' (expected on a tank);
  // Melee is untracked. Same table, two roles -> different verdicts.
  const entries = [
    { id: 1, abilities: [
      { guid: 36240, name: "Cave In", total: 5000 },
      { guid: 1, name: "Melee", total: 10000 },
    ] },
    { id: 2, abilities: [{ name: "Cleave", total: 4000 }] },
    { id: 3, abilities: [{ name: "Cleave", total: 4000 }] },
  ];
  const r = avoidableFromDamageTaken(entries, new Map([[1, "dps"], [2, "tank"], [3, "dps"]]));
  // untracked Melee counts toward `taken` but never toward `avoidable`
  assert.equal(r.get(1).avoidable, 5000);
  assert.equal(r.get(1).taken, 15000);
  assert.equal(r.get(1).abilities.get("Cave In").total, 5000);
  assert.equal(r.get(2).avoidable, 0);      // frontal on the tank: expected
  assert.equal(r.get(3).avoidable, 4000);   // same hit on a dps: avoidable
});

test("interruptsFromTable: inverts spell-keyed rows into per-interrupter counts", () => {
  const r = interruptsFromTable({ entries: [{ entries: [
    { name: "Frostbolt", details: [
      { id: 20, total: 2, actors: [{ name: "Staff of Disintegration" }] },
      { id: 21, total: 1, actors: [{ name: "Staff of Disintegration" }] },
    ] },
    { name: "Greater Heal", details: [{ id: 20, total: 3, actors: [{ name: "Coilfang Priestess" }] }] },
    { name: "Nameless", details: [{ id: 22, total: 1 }] }, // no source actor
  ] }] });
  assert.equal(r.get(20).count, 5);
  assert.equal(r.get(20).spells.get("Frostbolt (Staff of Disintegration)"), 2);
  assert.equal(r.get(20).spells.get("Greater Heal (Coilfang Priestess)"), 3);
  assert.equal(r.get(21).count, 1);
  assert.equal(r.get(22).spells.get("Nameless"), 1); // falls back to bare name
  assert.equal(interruptsFromTable(null).size, 0);
});

test("fetchDeepStats: a degraded scan is NOT cached, so a retry re-queries", async () => {
  // Pinning a failed scan would hand the same short totals to every retry
  // without issuing a query — the bug this guards.
  const { fetchDeepStats, clearDeepCache } = await import("../js/officer-stats.js");
  const wcl = await import("../js/wcl.js");
  clearDeepCache();
  const realFetch = globalThis.fetch;
  let calls = 0;
  let healthy = false;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("oauth")) {
      return { ok: true, status: 200, headers: new Map(),
        json: async () => ({ access_token: "t", expires_in: 3600 }) };
    }
    calls += 1;
    if (!healthy) return { ok: false, status: 500, headers: new Map(), text: async () => "boom" };
    return { ok: true, status: 200, headers: new Map(),
      json: async () => ({ data: { reportData: { report: { table: { data: { entries: [] } } } } } }) };
  };
  try {
    const fights = [{ id: 1, startTime: 0, endTime: 100 }];
    const bad = await fetchDeepStats("RPT", fights, new Map());
    assert.ok(bad.failed > 0, "expected the failing scan to report failures");
    const callsAfterBad = calls;
    healthy = true;
    const good = await fetchDeepStats("RPT", fights, new Map());
    assert.ok(calls > callsAfterBad, "retry must issue real queries, not replay the failed scan");
    assert.equal(good.failed, 0);
    // ...and a clean scan IS cached.
    const before = calls;
    await fetchDeepStats("RPT", fights, new Map());
    assert.equal(calls, before, "a complete scan should be served from cache");
  } finally {
    globalThis.fetch = realFetch;
    clearDeepCache();
  }
});
