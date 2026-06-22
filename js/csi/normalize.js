"use strict";
// Normalize raw Warcraft Logs report data into the CSI internal model.
// Pure functions (no network). The analysis engine never sees WCL's raw format.

// WCL event "type" -> CSI event type. Unmapped types are dropped.
const EVENT_TYPE = {
  damage: "damage",
  heal: "heal",
  death: "death",
  cast: "cast",
  begincast: "cast",
  applybuff: "applybuff",
  removebuff: "removebuff",
  applydebuff: "applydebuff",
  removedebuff: "removedebuff",
  interrupt: "interrupt",
  dispel: "dispel",
};

const ACTOR_TYPE = { Player: "player", NPC: "npc", Pet: "pet", Boss: "npc" };

/** Map actor id -> [role, spec] from a playerDetails JSON blob.
 *  WCL wraps it as {data: {playerDetails: {tanks, healers, dps}}}. */
export function playerRoles(playerDetails) {
  let pd = playerDetails;
  if (pd && typeof pd === "object" && pd.data && typeof pd.data === "object") {
    pd = pd.data.playerDetails ?? pd;
  }
  const roles = new Map();
  if (!pd || typeof pd !== "object") return roles;
  for (const [key, role] of [["tanks", "tank"], ["healers", "healer"], ["dps", "dps"]]) {
    for (const p of pd[key] ?? []) {
      if (p.id == null) continue;
      const specs = p.specs ?? [];
      const spec = specs[0] && typeof specs[0] === "object" ? specs[0].spec : undefined;
      roles.set(p.id, [role, spec]);
    }
  }
  return roles;
}

export function normalizeActors(masterActors, playerDetails) {
  const roles = playerRoles(playerDetails);
  const actors = [];
  for (const a of masterActors ?? []) {
    if (a.id == null) continue;
    const atype = ACTOR_TYPE[a.type] ?? "npc";
    const actor = { id: String(a.id), name: a.name ?? `#${a.id}`, type: atype };
    if (atype === "player") {
      if (a.subType) actor.class = a.subType;
      const r = roles.get(a.id);
      if (r) {
        actor.role = r[0];
        if (r[1]) actor.spec = r[1];
      }
    }
    actors.push(actor);
  }
  return actors;
}

function abilitiesByGameId(masterAbilities) {
  const out = new Map();
  for (const ab of masterAbilities ?? []) {
    if (ab.gameID != null) out.set(ab.gameID, ab.name);
  }
  return out;
}

/** One WCL event -> a CSI event, or null to drop it. */
export function normalizeEvent(ev, fightStart, abilities) {
  const etype = EVENT_TYPE[ev.type];
  if (!etype) return null;
  const out = { timestamp: Math.round(ev.timestamp ?? 0) - fightStart, type: etype };
  if (ev.sourceID != null) out.sourceId = String(ev.sourceID);
  if (ev.targetID != null) out.targetId = String(ev.targetID);
  if (ev.abilityGameID != null) {
    out.abilityId = ev.abilityGameID;
    const name = abilities.get(ev.abilityGameID);
    if (name) out.abilityName = name;
  }
  if (ev.amount != null) out.amount = ev.amount;
  if (ev.absorbed) out.absorbed = ev.absorbed;
  // damage "overkill" and heal "overheal" both map to CSI's overkill field.
  const over = ev.overkill ?? ev.overheal;
  if (over) out.overkill = over;
  if (ev.mitigated) out.mitigated = ev.mitigated;
  return out;
}

/** Percentages arrive as 0-100 or 0-10000 depending on field; -> 0-100 (1dp). */
function scalePercent(value) {
  if (typeof value !== "number") return undefined;
  const pct = value > 100 ? value / 100 : value;
  return Math.round(pct * 10) / 10;
}

export function normalizeFight(f, reportStart, events = []) {
  const start = Math.round(f.startTime ?? 0);
  const end = Math.round(f.endTime ?? start);
  const fight = {
    id: String(f.id),
    bossName: f.name ?? "Unknown",
    startTime: reportStart + start,
    endTime: reportStart + end,
    durationMs: end - start,
    kill: Boolean(f.kill),
    events,
  };
  if (f.encounterID) fight.encounterId = f.encounterID;
  if (f.difficulty != null) fight.difficulty = String(f.difficulty);
  if (!fight.kill) {
    const bp = scalePercent(f.bossPercentage);
    if (bp != null) fight.bossPercentRemaining = bp;
  }
  return fight;
}

/** Assemble a CSI report from a WCL reportData.report payload. If fightId is
 *  given, only that fight is included (with events); else all fights, no events. */
export function buildReport(code, report, fightId = null, eventsByFight = {}) {
  const master = report.masterData ?? {};
  const abilities = abilitiesByGameId(master.abilities);
  const actors = normalizeActors(master.actors, report.playerDetails);
  const reportStart = Math.round(report.startTime ?? 0);

  const fights = [];
  for (const f of report.fights ?? []) {
    if (fightId != null && f.id !== fightId) continue;
    const raw = eventsByFight[f.id] ?? [];
    const fightStart = Math.round(f.startTime ?? 0);
    const norm = raw
      .map((e) => normalizeEvent(e, fightStart, abilities))
      .filter((e) => e !== null)
      .sort((a, b) => a.timestamp - b.timestamp);
    fights.push(normalizeFight(f, reportStart, norm));
  }

  const out = { id: code, source: "warcraftlogs", title: report.title ?? code, actors, fights };
  const owner = report.owner?.name;
  if (owner) out.owner = owner;
  const zone = report.zone?.name;
  if (zone) out.zone = zone;
  return out;
}
