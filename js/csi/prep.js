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

/** Classify a player's buff auras into the consumables that matter for prep. */
export function classifyConsumables(auras) {
  let flask = null;
  const elixirs = [];
  let food = false;
  for (const a of auras ?? []) {
    const n = a.name ?? "";
    if (/^flask of/i.test(n)) flask = n;
    else if (/well fed/i.test(n)) food = true;
    else if (/elixir/i.test(n)) elixirs.push(n);
  }
  return { flask, elixirs, food };
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
      players.push({
        id: p.id,
        name: p.name,
        role,
        hasGear,
        missingCount: en ? en.missing_required : null,
        gear: hasGear ? buildGearList(gearRaw) : [],
        consumables: classifyConsumables(consumablesById[p.id]),
      });
    }
  }

  const total = players.length;
  const withGear = players.filter((p) => p.hasGear);
  const coverage = {
    flask: players.filter((p) => p.consumables.flask).length,
    elixir: players.filter((p) => p.consumables.elixirs.length > 0).length,
    food: players.filter((p) => p.consumables.food).length,
    enchanted: withGear.filter((p) => p.missingCount === 0).length,
    gearCovered: withGear.length,
  };

  // tanks first, then healers, then dps; within a role, unprepared first.
  const order = { tank: 0, healer: 1, dps: 2 };
  const score = (p) => (p.missingCount || 0) + (p.consumables.flask || p.consumables.elixirs.length ? 0 : 5);
  players.sort((a, b) => (order[a.role] - order[b.role]) || (score(b) - score(a)) || a.name.localeCompare(b.name));

  return { raidSize: total, coverage, players };
}
