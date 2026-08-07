// Deterministic, offline unit tests for the Officer tab logic.
// Run with: node --test
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRoster, consumablesByFight, reportCardToDiscord } from "../js/officer-data.js";
import { mergeAlts, resolveMain } from "../js/attendance.js";
import {
  abilityHostility, avoidableFromDamageTaken, avoidableSpellIds, batchIds,
  castCountsByCatalogue, deathsByPlayer, debuffUptimes, dispelCountOf,
  dispelsAsUtility, invertSpellKeyedTable, mergeBands, mergeCastCounts,
} from "../js/officer-stats.js";
import { CONSUMABLE_CASTS, CONSUMABLE_CAST_IDS } from "../js/consumable-casts.js";
import { UTILITY_CASTS, UTILITY_CAST_IDS } from "../js/utility-casts.js";

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
    attended: 2, flaskFights: 2, elixirFights: 2, foodFights: 2, scrollFights: 0,
    consumables: ["Flask of Relentless Assault"], scrolls: [],
  });
  assert.deepEqual(m.get(2), {
    attended: 2, flaskFights: 1, elixirFights: 1, foodFights: 0, scrollFights: 0,
    consumables: ["Elixir of Major Agility", "Elixir of Major Fortitude"], scrolls: [],
  });
  // the lone-elixir case that was reading as "0/2 = nothing": now elixirFights=1
  assert.deepEqual(m.get(3), {
    attended: 1, flaskFights: 0, elixirFights: 1, foodFights: 1, scrollFights: 0,
    consumables: ["Elixir of Major Agility"], scrolls: [],
  });
});

test("consumablesByFight: scrolls are counted apart from elixirs", () => {
  // A raider who only ever scrolled must not read as "brought nothing", but
  // must not gain a flask-equivalent pull either.
  const m = consumablesByFight([
    { fight: 1, sourceID: 5, auras: [{ ability: 33077, name: "Agility" }, { ability: 33082, name: "Strength" }] },
    { fight: 2, sourceID: 5, auras: [] },
  ]);
  assert.deepEqual(m.get(5), {
    attended: 2, flaskFights: 0, elixirFights: 0, foodFights: 0, scrollFights: 1,
    consumables: [], scrolls: ["Scroll of Agility", "Scroll of Strength"],
  });
});

test("consumablesByFight: missing auras array counts as an unprepped pull", () => {
  const m = consumablesByFight([{ fight: 1, sourceID: 1 }]);
  assert.deepEqual(m.get(1), {
    attended: 1, flaskFights: 0, elixirFights: 0, foodFights: 0, scrollFights: 0,
    consumables: [], scrolls: [],
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
    { id: 1, total: 15000, abilities: [
      { guid: 36240, name: "Cave In", total: 5000 },
      { guid: 1, name: "Melee", total: 10000 },
    ] },
    { id: 2, total: 4000, abilities: [{ name: "Cleave", total: 4000 }] },
    { id: 3, total: 4000, abilities: [{ name: "Cleave", total: 4000 }] },
  ];
  const r = avoidableFromDamageTaken(entries, new Map([[1, "dps"], [2, "tank"], [3, "dps"]]),
    { recordTotal: true });
  // untracked Melee is part of the denominator but never of `avoidable`
  assert.equal(r.get(1).avoidable, 5000);
  assert.equal(r.get(1).taken, 15000);
  assert.equal(r.get(1).abilities.get("Cave In").total, 5000);
  assert.equal(r.get(2).avoidable, 0);      // frontal on the tank: expected
  assert.equal(r.get(3).avoidable, 4000);   // same hit on a dps: avoidable
});

// --- raid debuff uptimes ------------------------------------------------------

const band = (startTime, endTime) => ({ startTime, endTime });

test("mergeBands: unions overlapping and touching intervals", () => {
  assert.deepEqual(mergeBands([band(50, 70), band(0, 10), band(5, 20), band(20, 30)]),
    [band(0, 30), band(50, 70)]);
  assert.deepEqual(mergeBands([band(5, 5)]), []); // zero-length is not coverage
  assert.deepEqual(mergeBands(null), []);
});

test("debuffUptimes: a slot's spells are unioned, never summed", () => {
  // Both druid flavours of Faerie Fire up at the same time must be 50%, not
  // 100% — summing their uptimes would invent coverage that never happened.
  const auras = [
    { guid: 26993, name: "Faerie Fire", totalUptime: 500, bands: [band(0, 500)] },
    { guid: 27011, name: "Faerie Fire (Feral)", totalUptime: 500, bands: [band(250, 750)] },
  ];
  const [ff] = debuffUptimes(auras, 1500, [{ class: "Druid", spec: "Feral Combat" }],
    [{ key: "faerie", label: "Faerie Fire", ids: [26993, 27011], providers: ["Druid"], effect: "", core: true }]);
  assert.equal(ff.uptimeMs, 750);  // union 0..750, not 1000
  assert.equal(ff.pct, 50);
  assert.deepEqual(ff.spells, ["Faerie Fire", "Faerie Fire (Feral)"]);
  assert.equal(ff.hasProvider, true);
});

test("debuffUptimes: a slot nobody can apply is flagged, not scored as failure", () => {
  const cat = [
    { key: "wc", label: "Winter's Chill", ids: [12579], providers: ["Mage"], effect: "", core: false },
    { key: "misery", label: "Misery", ids: [33200], providers: ["Priest"], effect: "", core: true },
  ];
  const misery900 = [{ guid: 33200, name: "Misery", totalUptime: 900, bands: [band(0, 900)] }];
  const [wc, misery] = debuffUptimes(misery900, 1000,
    [{ class: "Priest", spec: "Shadow" }, { class: "Warrior", spec: "Fury" }], cat);
  assert.equal(wc.hasProvider, false);   // no mage present
  assert.equal(wc.pct, 0);
  assert.deepEqual(wc.spells, []);
  assert.equal(misery.hasProvider, true);
  assert.equal(misery.pct, 90);
  // with no comp information, nothing is excused
  assert.equal(debuffUptimes([], 1000, null, cat)[0].hasProvider, true);
});

test("debuffUptimes: spec decides the provider, and unknown spec stays lenient", () => {
  // Misery is a SHADOW priest talent: a raid of healer priests can't supply it,
  // so 0% is a comp fact and must not read as a failure.
  const cat = [{ key: "misery", label: "Misery", ids: [33200], providers: ["Priest"],
    specs: ["Shadow"], effect: "", core: true }];
  const healersOnly = [{ class: "Priest", spec: "Holy" }, { class: "Priest", spec: "Discipline" }];
  assert.equal(debuffUptimes([], 1000, healersOnly, cat)[0].hasProvider, false);

  const withShadow = [...healersOnly, { class: "Priest", spec: "Shadow" }];
  assert.equal(debuffUptimes([], 1000, withShadow, cat)[0].hasProvider, true);

  // no talent data logged -> can't disprove it, so still ask the question
  assert.equal(debuffUptimes([], 1000, [{ class: "Priest", spec: null }], cat)[0].hasProvider, true);
  // wrong class is never a provider, spec or not
  assert.equal(debuffUptimes([], 1000, [{ class: "Mage", spec: "Fire" }], cat)[0].hasProvider, false);
});

test("debuffUptimes: falls back to totalUptime when bands are absent", () => {
  const cat = [{ key: "m", label: "Misery", ids: [33200], providers: ["Priest"], effect: "", core: true }];
  const [row] = debuffUptimes([{ guid: 33200, name: "Misery", totalUptime: 400 }], 800, null, cat);
  assert.equal(row.uptimeMs, 400); // understated-but-honest, never a false zero
  assert.equal(row.pct, 50);
});

test("abilityHostility: Boss/NPC sources are hostile, player-only is not", () => {
  const m = abilityHostility([
    { guid: 38235, name: "Water Tomb", sources: [{ name: "Hydross", type: "Boss" }] },
    { guid: 27213, name: "Hellfire", sources: [{ name: "Vaidilë", type: "Warlock" }] },
    { guid: 6603, name: "Melee", sources: [{ name: "Add", type: "NPC" }] },
    // boss auras log with no sources at all (Watery Grave, Reverberation)
    { guid: 38028, name: "Watery Grave", sources: [] },
    // same ability from both a boss and a mind-controlled player -> hostile wins
    { guid: 999, name: "Mixed", sources: [{ type: "Mage" }] },
    { guid: 999, name: "Mixed", sources: [{ type: "Boss" }] },
  ]);
  assert.equal(m.get(38235), true);
  assert.equal(m.get(27213), false);
  assert.equal(m.get(6603), true);
  assert.equal(m.get(38028), true);
  assert.equal(m.get(999), true);
  assert.equal(m.has(12345), false); // unseen ability isn't in the map
});

test("avoidableFromDamageTaken: a player's own ability isn't blamed as a boss mechanic", () => {
  // Hellfire/Blizzard/Cleave/Whirlwind all collide with catalogue names and
  // reach the NAME fallback (no harvested boss id), so only the source tells
  // them apart. Chain mechanics are friendly-sourced BY DESIGN and must stay.
  const entries = [{ id: 1, total: 100000, abilities: [
    { guid: 27213, name: "Hellfire", total: 3000 },     // warlock's own
    { guid: 1680, name: "Whirlwind", total: 1300 },      // warrior's own
    { guid: 38281, name: "Static Charge", total: 40000 }, // chain: legit
    { guid: 36240, name: "Cave In", total: 5000 },        // real boss mechanic
  ] }];
  const hostileById = new Map([
    [27213, false], [1680, false], [38281, false], [36240, true],
  ]);
  const roles = new Map([[1, "dps"]]);

  const guarded = avoidableFromDamageTaken(entries, roles, { hostileById });
  assert.equal(guarded.get(1).avoidable, 45000); // Static Charge + Cave In only
  assert.ok(!guarded.get(1).abilities.has("Hellfire"));
  assert.ok(!guarded.get(1).abilities.has("Whirlwind"));
  assert.ok(guarded.get(1).abilities.has("Static Charge"), "chain must survive the guard");

  // Without the map (query failed) nothing is dropped — degrade, don't lose data.
  assert.equal(avoidableFromDamageTaken(entries, roles).get(1).avoidable, 49300);
});

test("invertSpellKeyedTable: inverts spell-keyed rows into per-player counts", () => {
  const r = invertSpellKeyedTable({ entries: [{ entries: [
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
  assert.equal(invertSpellKeyedTable(null).size, 0);
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
    const bad = await fetchDeepStats("RPT", 100000, new Map());
    assert.ok(bad.failed > 0, "expected the failing scan to report failures");
    const callsAfterBad = calls;
    healthy = true;
    const good = await fetchDeepStats("RPT", 100000, new Map());
    assert.ok(calls > callsAfterBad, "retry must issue real queries, not replay the failed scan");
    assert.equal(good.failed, 0);
    // ...and a clean scan IS cached.
    const before = calls;
    await fetchDeepStats("RPT", 100000, new Map());
    assert.equal(calls, before, "a complete scan should be served from cache");
  } finally {
    globalThis.fetch = realFetch;
    clearDeepCache();
  }
});

test("fetchOfficerCard: a card whose debuff query failed is not cached", async () => {
  // Every optional extra follows the same rule as deaths: a degraded card must
  // never be pinned for the session, or the retry silently replays the hole.
  const { fetchOfficerCard } = await import("../js/officer-data.js");
  const realFetch = globalThis.fetch;
  let debuffCalls = 0;
  let debuffsHealthy = false;
  const reply = (body) => ({ ok: true, status: 200, headers: new Map(), json: async () => body });

  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("oauth")) {
      return reply({ access_token: "t", expires_in: 3600 });
    }
    const q = JSON.parse(opts.body).query;
    if (/dataType: Debuffs/.test(q)) {
      debuffCalls += 1;
      if (!debuffsHealthy) return { ok: false, status: 500, headers: new Map(), text: async () => "boom" };
      return reply({ data: { reportData: { report: { table: { data: { auras: [], totalTime: 1000 } } } } } });
    }
    if (/fights\(killType/.test(q)) {
      return reply({ data: { reportData: { report: {
        title: "T", startTime: 0, endTime: 1000, zone: { name: "Z" },
        fights: [{ id: 1, name: "Boss", kill: true, startTime: 0, endTime: 1000 }],
      } } } });
    }
    if (/playerDetails/.test(q)) {
      return reply({ data: { reportData: { report: { playerDetails: { data: { playerDetails: {
        tanks: [], healers: [], dps: [{ id: 1, name: "P", type: "Mage" }],
      } } } } } } });
    }
    if (/CombatantInfo/.test(q)) {
      return reply({ data: { reportData: { report: { events: { data: [], nextPageTimestamp: null } } } } });
    }
    return reply({ data: { reportData: { report: { table: { data: { entries: [] } } } } } }); // Deaths
  };

  try {
    const bad = await fetchOfficerCard("CARDX", () => {});
    assert.equal(bad.debuffs, null, "a failed debuff query yields no panel");
    const after = debuffCalls;
    debuffsHealthy = true;
    const good = await fetchOfficerCard("CARDX", () => {});
    assert.ok(debuffCalls > after, "reloading a degraded card must re-query, not serve the cache");
    assert.ok(good.debuffs, "the retry should now produce a panel");
    // ...and a healthy card IS cached.
    const before = debuffCalls;
    await fetchOfficerCard("CARDX", () => {});
    assert.equal(debuffCalls, before, "a complete card should be served from cache");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("batchIds: batches stay under the table's top-5 ability cap", () => {
  const b = batchIds([1, 2, 3, 4, 5, 6, 7, 8, 9], 4);
  assert.deepEqual(b, [[1, 2, 3, 4], [5, 6, 7, 8], [9]]);
  assert.ok(b.every((x) => x.length <= 4), "a batch of >4 ids could be truncated at 5");
  assert.deepEqual(batchIds([], 4), []);
});

test("avoidableSpellIds: only ids that could ever be blamed on someone", async () => {
  const ids = avoidableSpellIds();
  assert.ok(ids.length > 0);
  // 36240 = Gruul Cave In, an 'avoidable' rule -> must be queried for.
  assert.ok(ids.includes(36240), "a plain avoidable mechanic must be included");
  // Every returned id must actually be avoidable for at least one role.
  const { lookupRule, isAvoidableHit } = await import("../js/csi/rules.js");
  for (const id of ids) {
    const r = lookupRule(undefined, id);
    assert.ok(isAvoidableHit(r, "dps") || isAvoidableHit(r, "tank"),
      `id ${id} is never avoidable — querying it wastes a request`);
  }
});

test("castCountsByCatalogue: groups by kind and ignores uncatalogued casts", () => {
  const r = castCountsByCatalogue([
    { id: 1, abilities: [
      { guid: 28499, name: "Restore Mana", total: 21 },   // mana potion
      { guid: 27237, name: "Master Healthstone", total: 3 }, // healing
      { guid: 27230, name: "Create Healthstone", total: 5 }, // MAKING one: not a use
      { guid: 999999, name: "Shadow Bolt", total: 400 },     // rotation: ignored
    ] },
    { id: 2, abilities: [{ guid: 35476, name: "Drums of Battle", total: 25 }] },
  ]);
  const a = r.get(1);
  assert.equal(a.total, 24);            // 21 + 3, not 29 and not 429
  assert.equal(a.byGroup.mana, 21);
  assert.equal(a.byGroup.healing, 3);
  assert.equal(a.items.get("Super Mana Potion"), 21);
  assert.ok(!a.items.has("Create Healthstone"));
  assert.equal(r.get(2).byGroup.drums, 25);
});

// --- raid utility: nets / innervates / bombs / threat drops / dispels ---------

test("castCountsByCatalogue: counts raid utility and ignores consumable ids", () => {
  const r = castCountsByCatalogue([
    { id: 1, abilities: [
      { guid: 31367, name: "Netherweave Net", total: 4 },
      { guid: 31460, name: "Netherweave Net", total: 9 },   // TAILORING the nets
      { guid: 28499, name: "Restore Mana", total: 12 },     // a consumable: not ours
    ] },
    { id: 2, abilities: [
      { guid: 29166, name: "Innervate", total: 6 },
      { guid: 30216, name: "Fel Iron Bomb", total: 3 },
      { guid: 30486, name: "Super Sapper Charge", total: 2 },
    ] },
  ], UTILITY_CASTS);

  // 31460 is the recipe that CREATES nets, not a net thrown at anything. If it
  // ever gets added to the catalogue, a tailor's crafting session reads as
  // elite add control.
  const a = r.get(1);
  assert.equal(a.total, 4, "only the net that was USED counts");
  assert.equal(a.byGroup.nets, 4);
  assert.ok(!a.items.has("Restore Mana"));

  const b = r.get(2);
  assert.equal(b.byGroup.innervate, 6);
  assert.equal(b.byGroup.bombs, 5, "bombs from different items add up");
  assert.equal(b.items.get("Fel Iron Bomb"), 3);
  assert.equal(b.total, 11);
});

test("the two cast catalogues are disjoint", () => {
  // Load-bearing: fetchDeepStats counts every filtered Casts table into BOTH
  // catalogues, so an id in both would be counted twice — once under "Used" and
  // once under "Utility". This is exactly how Super Sapper Charge started out.
  const shared = CONSUMABLE_CAST_IDS.filter((id) => UTILITY_CAST_IDS.includes(id));
  assert.deepEqual(shared, [],
    `ids in both catalogues would be double-counted: ${shared.join(", ")}`);
});

test("every utility cast id has a label and a known group", () => {
  // "dispels" is deliberately NOT here: it comes from the Dispels TABLE, not
  // from a cast id, so a catalogue entry claiming that group would be counted
  // twice — once as a cast and once from the table.
  const groups = new Set(["nets", "innervate", "bombs", "threat"]);
  for (const [id, v] of Object.entries(UTILITY_CASTS)) {
    assert.ok(v.label, `id ${id} has no label`);
    assert.ok(groups.has(v.group), `id ${id} has unknown group "${v.group}"`);
  }
});

test("threat drops count the CAST id, never the resulting aura", () => {
  // masterData lists most of these twice: the cast, and the buff it applies.
  // Counting the aura id would count the effect landing rather than the player
  // deciding to use it — and for Misdirection the aura fires on every redirected
  // hit, which would inflate one cast into dozens.
  const auraIds = [32612, 35079, 32835, 26888, 29448];
  for (const id of auraIds) {
    assert.ok(!(id in UTILITY_CASTS), `${id} is an effect/aura id, not a cast`);
  }
  for (const id of [66, 34477, 29858, 26889]) {
    assert.equal(UTILITY_CASTS[id].group, "threat");
  }
  // Druid Cower is excluded BY DECISION (2026-08-07), not by oversight: spammed
  // on cooldown it posted 44 in a night and drowned the deliberate drops.
  assert.ok(!(27004 in UTILITY_CASTS), "Cower was deliberately removed — see utility-casts.js");
});

test("dispelsAsUtility: table credit becomes the utility shape", () => {
  // The label must say the aura came OFF that unit. `actors` is the dispel
  // TARGET here, but the same field is the CASTER in the Interrupts table —
  // reusing the interrupt format would print a friendly cleanse as though the
  // raid member had cast the debuff on themselves.
  const off = (spell, target) => `${spell} off ${target}`;
  const inverted = invertSpellKeyedTable({ entries: [{ entries: [
    { name: "Fire Destruction", details: [
      { id: 14, total: 4, actors: [{ name: "Greyheart Nether-Mage" }] },
      { id: 36, total: 1, actors: [{ name: "Greyheart Nether-Mage" }] },
    ] },
    { name: "Flame Shock", details: [{ id: 14, total: 2, actors: [{ name: "Bluebrixx" }] }] },
    { name: "Nameless", details: [{ id: 14, total: 1 }] }, // no actor recorded
  ] }] }, off);
  const u = dispelsAsUtility(inverted);
  const a = u.get(14);
  assert.equal(a.total, 7);
  assert.equal(a.byGroup.dispels, 7);
  // What was REMOVED, and off whom, is the useful detail in the tooltip.
  assert.equal(a.items.get("Fire Destruction off Greyheart Nether-Mage"), 4);
  assert.equal(a.items.get("Flame Shock off Bluebrixx"), 2);
  assert.equal(a.items.get("Nameless"), 1);
  assert.equal(u.get(36).total, 1);
});

test("dispelCountOf: Shield Slam's automatic purge is subtracted", () => {
  // A detail row's `abilities` names what the dispeller cast, with per-ability
  // totals summing to the row's total (verified live 2026-08-07).
  // Mixed row: 3 real dispels + 2 Shield Slams -> only the 3 count.
  assert.equal(dispelCountOf({ total: 5, abilities: [
    { name: "Cleanse", total: 3 }, { name: "Shield Slam", total: 2 },
  ] }), 3);
  // Shield-Slam-only row -> 0, and the inversion must then SKIP the row so the
  // tank reads as a dash, not as a proud 0-dispel entry.
  assert.equal(dispelCountOf({ total: 2, abilities: [{ name: "Shield Slam", total: 2 }] }), 0);
  // No abilities data at all degrades to counting everything — better to
  // overcount a rare malformed row than to hide real dispels.
  assert.equal(dispelCountOf({ total: 4 }), 4);

  const u = dispelsAsUtility(invertSpellKeyedTable({ entries: [{ entries: [
    { name: "Heroism", details: [
      { id: 9, total: 2, actors: [{ name: "Serpentguard" }],
        abilities: [{ name: "Shield Slam", total: 2 }] },          // tank: all automatic
      { id: 11, total: 3, actors: [{ name: "Serpentguard" }],
        abilities: [{ name: "Purge", total: 3 }] },                // shaman: deliberate
    ] },
  ] }] }, (spell, target) => `${spell} off ${target}`, dispelCountOf));
  assert.ok(!u.has(9), "a Shield-Slam-only dispeller gets no entry at all");
  assert.equal(u.get(11).total, 3);
});

test("invertSpellKeyedTable: default label keeps the interrupt reading", () => {
  // Interrupts must be untouched by the dispel label work: there `actors` IS
  // the caster, so "Frostbolt (Staff of Disintegration)" is correct as-is.
  const r = invertSpellKeyedTable({ entries: [{ entries: [
    { name: "Frostbolt", details: [{ id: 20, total: 2, actors: [{ name: "Staff of Disintegration" }] }] },
  ] }] });
  assert.equal(r.get(20).spells.get("Frostbolt (Staff of Disintegration)"), 2);
});

test("dispels merge into the same utility totals as casts, without collision", () => {
  // The Utility column sums two completely different queries. A player who both
  // dispelled and dropped threat must end up with one row carrying both.
  const utility = new Map();
  mergeCastCounts(utility, castCountsByCatalogue(
    [{ id: 7, abilities: [{ guid: 25429, name: "Fade", total: 3 }] }], UTILITY_CASTS));
  mergeCastCounts(utility, dispelsAsUtility(invertSpellKeyedTable({ entries: [{ entries: [
    { name: "Chains of Ice", details: [{ id: 7, total: 5, actors: [{ name: "Bluebrixx" }] }] },
  ] }] }, (spell, target) => `${spell} off ${target}`)));
  const e = utility.get(7);
  assert.equal(e.total, 8);
  assert.equal(e.byGroup.threat, 3);
  assert.equal(e.byGroup.dispels, 5);
  assert.equal(e.items.get("Fade"), 3);
  assert.equal(e.items.get("Chains of Ice off Bluebrixx"), 5);
});

test("the combined cast id pool batches under the top-5 table cap", () => {
  // The Casts table returns only each player's top 5 abilities, so a batch of
  // 5+ ids could silently truncate. Consumables and utility share one pool.
  for (const batch of batchIds([...CONSUMABLE_CAST_IDS, ...UTILITY_CAST_IDS])) {
    assert.ok(batch.length <= 4, `batch of ${batch.length} ids risks truncation`);
  }
});

test("avoidableFromDamageTaken: the denominator is `total`, NOT the sum of the rows", () => {
  // Load-bearing WCL contract, measured 2026-07-25 on a 26-player report:
  // the table returns only each player's TOP 5 abilities, but `total` stays
  // the TRUE total damage taken. Σ total came to 11,617,920 — matching the
  // ability-keyed view exactly — while the listed rows summed to 7,474,345.
  // So the avoidable % must divide by `total`; "fixing" this to sum the
  // visible rows would silently inflate every player's percentage.
  const truncated = [{
    id: 1,
    total: 1000000,                 // real damage taken
    abilities: [                    // only the 5 biggest survived the cap
      { guid: 36240, name: "Cave In", total: 50000 },
      { guid: 1, name: "Melee", total: 300000 },
      { guid: 2, name: "Melee (2)", total: 100000 },
      { guid: 3, name: "Melee (3)", total: 90000 },
      { guid: 4, name: "Melee (4)", total: 60000 },
    ],                              // ...400,000 of damage is not listed at all
  }];
  const r = avoidableFromDamageTaken(truncated, new Map([[1, "dps"]]), { recordTotal: true });
  assert.equal(r.get(1).taken, 1000000, "must use total, not the 600,000 of visible rows");
  assert.equal(r.get(1).avoidable, 50000);
  // 5% of real damage, not the 8.3% that summing the rows would report
  assert.equal(Math.round((r.get(1).avoidable / r.get(1).taken) * 100), 5);
});

test("avoidableFromDamageTaken: real denominator comes only from the unfiltered pass", () => {
  // Filtered tables only contain avoidable ids, so counting their totals as
  // "all damage taken" makes every non-tank exactly 100%. The unfiltered pass
  // supplies the true per-player total via `total`.
  const filtered = [{ id: 1, total: 8000, abilities: [
    { guid: 36240, name: "Cave In", total: 5000 },
  ] }];
  const noTotal = avoidableFromDamageTaken(filtered, new Map([[1, "dps"]]));
  assert.equal(noTotal.get(1).avoidable, 5000);
  assert.equal(noTotal.get(1).taken, 0, "a filtered table must not set the denominator");

  // The unfiltered pass records the real total AND skips ids the batches cover.
  const unfiltered = [{ id: 1, total: 250000, abilities: [
    { guid: 36240, name: "Cave In", total: 5000 },   // already counted -> skip
    { name: "Shadow Nova", total: 9000 },            // name-only rule -> count
    { guid: 1, name: "Melee", total: 200000 },       // untracked -> not avoidable
  ] }];
  const withTotal = avoidableFromDamageTaken(unfiltered, new Map([[1, "dps"]]),
    { skipIds: new Set([36240]), recordTotal: true });
  const a = withTotal.get(1);
  assert.equal(a.taken, 250000);
  assert.equal(a.avoidable, 9000, "skipped id must not be double counted");
  assert.ok(a.abilities.has("Shadow Nova"), "name-only catalogue rules must still be recovered");
  assert.ok(!a.abilities.has("Cave In"));
});

test("getAttendanceMap: a later page timing out keeps the pages that worked", async () => {
  // WCL's attendance endpoint hangs intermittently. Throwing away page 1
  // because page 2 died is what made the Officer tab show only "timed out".
  const { getAttendanceMap } = await import("../js/attendance.js");
  const { CONFIG } = await import("../js/config.js");
  const realFetch = globalThis.fetch;
  const realPages = CONFIG.ATTENDANCE_MAX_PAGES;
  CONFIG.ATTENDANCE_MAX_PAGES = 3;
  let page = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("oauth")) {
      return { ok: true, status: 200, headers: new Map(),
        json: async () => ({ access_token: "t", expires_in: 3600 }) };
    }
    page += 1;
    if (page > 1) throw new Error("hang"); // pages 2+ die
    return { ok: true, status: 200, headers: new Map(), json: async () => ({
      data: { guildData: { guild: { name: "SEND IT", attendance: {
        total: 75, per_page: 25, current_page: 1,
        data: [{ code: "r1", startTime: 1000, zone: { name: "SSC" },
                 players: [{ name: "Peerica", presence: 1 }] }],
      } } } },
    }) };
  };
  try {
    const map = await getAttendanceMap();
    assert.ok(map, "page 1 succeeded, so there must be a map");
    assert.equal(map.partial, true, "must be flagged partial so the UI can say so");
    assert.equal(map.reportsScanned, 1);
    assert.ok(map.players.peerica, "the page that worked must survive");
  } finally {
    globalThis.fetch = realFetch;
    CONFIG.ATTENDANCE_MAX_PAGES = realPages;
  }
});
