"use strict";
// Per-pull raid prep: for each player, their full gear list with the enchant on
// every item, and their specific consumables (flask / elixirs / food). Reuses
// the PuG Vetter gear + enchant logic.
import { analyzeEnchants, buildGearList } from "../analyze.js";

function unwrapPlayerDetails(pd) {
  if (pd && typeof pd === "object" && pd.data && typeof pd.data === "object") {
    return pd.data.playerDetails ?? pd;
  }
  return pd ?? {};
}

const ROLE_BUCKETS = [["tanks", "tank"], ["healers", "healer"], ["dps", "dps"]];

/** Flat list of {id, name, role} for every player in a playerDetails blob. */
export function playerList(playerDetails) {
  const pd = unwrapPlayerDetails(playerDetails);
  const out = [];
  for (const [bucket, role] of ROLE_BUCKETS) {
    for (const p of pd[bucket] ?? []) out.push({ id: p.id, name: p.name, role });
  }
  return out;
}

// TBC battle/guardian elixir names (lowercased), for telling a half-prepped
// player which half they're missing. The game only allows one of each active.
const BATTLE_ELIXIRS = new Set([
  "adept's elixir", "spellpower elixir", "greater arcane elixir",
  "elixir of major agility", "elixir of major strength", "elixir of the mongoose",
  "elixir of major firepower", "elixir of major frost power", "elixir of major shadow power",
  "elixir of healing power", "elixir of demonslaying", "elixir of mastery",
  "fel strength elixir", "onslaught elixir", "elixir of empowerment",
]);
const GUARDIAN_ELIXIRS = new Set([
  "elixir of major fortitude", "elixir of major defense", "elixir of major mageblood",
  "elixir of draenic wisdom", "elixir of ironskin", "earthen elixir",
  "elixir of superior defense", "elixir of fortitude", "elixir of greater defense",
]);

/** Classify a player's buff auras into the consumables that matter for prep.
 *  `auras` null/undefined means the data COULDN'T be fetched -> unknown, which
 *  is rendered as "no data", never as "unprepped". An empty array is a real
 *  answer: the player genuinely had nothing. */
export function classifyConsumables(auras) {
  if (auras == null) {
    return { unknown: true, flask: null, elixirs: [], battle: null, guardian: null, food: false, drums: false, flaskReady: false };
  }
  let flask = null;
  const elixirs = [];
  let battle = null;
  let guardian = null;
  let food = false;
  let drums = false;
  for (const a of auras) {
    const n = a.name ?? "";
    // unanchored: catches "Flask of ..." AND the Bash'ir "Unstable Flask of ..."
    if (/flask of/i.test(n)) flask = n;
    else if (/well fed/i.test(n)) food = true;
    else if (/^drums of battle/i.test(n)) drums = true;
    else if (/elixir/i.test(n)) {
      elixirs.push(n);
      const key = n.toLowerCase();
      if (BATTLE_ELIXIRS.has(key)) battle = n;
      else if (GUARDIAN_ELIXIRS.has(key)) guardian = n;
    }
  }
  // Flask-equivalent: a flask, or a battle+guardian pair. Two active elixirs
  // are always such a pair (the game caps one of each), so 2+ counts even when
  // a name isn't in our lists.
  const flaskReady = !!flask || (!!battle && !!guardian) || elixirs.length >= 2;
  return { unknown: false, flask, elixirs, battle, guardian, food, drums, flaskReady };
}

/**
 * Build the full per-pull prep model.
 * @param playerDetails  WCL playerDetails (includeCombatantInfo) for the fight
 * @param consumablesById  map of player id -> their buff auras (per-player)
 */
export function buildRaidPrep(playerDetails, consumablesById = {}) {
  const pd = unwrapPlayerDetails(playerDetails);
  const players = [];
  for (const [bucket, role] of ROLE_BUCKETS) {
    for (const p of pd[bucket] ?? []) {
      const gearRaw = p.combatantInfo?.gear ?? [];
      const hasGear = gearRaw.length > 0;
      const en = hasGear ? analyzeEnchants(gearRaw) : null;
      const consumables = classifyConsumables(consumablesById[p.id]);
      const missingCount = en ? en.missing_required : null;
      // Readiness issues: not flask-ready, no food, missing enchants.
      // Unknown data (no combat info / failed buff query) is never an issue.
      const issues =
        (consumables.unknown ? 0 : (consumables.flaskReady ? 0 : 1) + (consumables.food ? 0 : 1)) +
        (missingCount ? 1 : 0);
      players.push({
        id: p.id,
        name: p.name,
        role,
        class: p.type ?? null,
        hasGear,
        missingCount,
        gear: hasGear ? buildGearList(gearRaw) : [],
        consumables,
        issues,
      });
    }
  }

  const total = players.length;
  const withGear = players.filter((p) => p.hasGear);
  const withCons = players.filter((p) => !p.consumables.unknown);
  const coverage = {
    flaskReady: withCons.filter((p) => p.consumables.flaskReady).length,
    food: withCons.filter((p) => p.consumables.food).length,
    drums: withCons.filter((p) => p.consumables.drums).length,
    consumablesCovered: withCons.length,
    enchanted: withGear.filter((p) => p.missingCount === 0).length,
    gearCovered: withGear.length,
    fullyReady: players.filter((p) => p.issues === 0).length,
  };

  // tanks first, then healers, then dps; within a role, least-ready first.
  const order = { tank: 0, healer: 1, dps: 2 };
  players.sort((a, b) =>
    (order[a.role] - order[b.role]) ||
    (b.issues - a.issues) ||
    ((b.missingCount ?? 0) - (a.missingCount ?? 0)) ||
    a.name.localeCompare(b.name));

  return { raidSize: total, coverage, players };
}
