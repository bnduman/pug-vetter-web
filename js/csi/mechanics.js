"use strict";
// Apply the mechanic catalogue to a fight: tag avoidable damage events and
// build a per-mechanic breakdown (the spec's "ground effect" primitive).
import { isAvoidableHit, lookupRule } from "./rules.js";
import { RECAP_WINDOW_MS } from "./deaths.js";
import { num } from "./format.js";

const ORDER = ["low", "medium", "high", "critical"];

function normSeverity(s) {
  if (s === "major") return "high";
  if (s === "info") return "low";
  return s;
}
function bump(s) {
  const i = ORDER.indexOf(s);
  return ORDER[Math.min(i + 1, ORDER.length - 1)];
}

/**
 * Set event.avoidable = true on damage events that match an avoidable/chain
 * mechanic (or a frontal hit on a non-tank). Idempotent; never clears a flag,
 * so hand-authored demo flags are preserved.
 */
export function applyMechanicRules(fight, idx) {
  for (const e of fight.events) {
    if (e.type !== "damage" || e.avoidable) continue;
    const rule = lookupRule(e.abilityName);
    if (!rule) continue;
    const role = e.targetId ? idx.get(e.targetId)?.role : undefined;
    if (isAvoidableHit(rule, role)) e.avoidable = true;
  }
}

/**
 * Build a breakdown of avoidable mechanics in the fight: per ability, how many
 * players were hit, total damage, tick count, and how many deaths it fed into.
 * Returns findings sorted by deaths then damage.
 */
export function mechanicFindings(fight, idx) {
  const byAbility = new Map();

  for (const e of fight.events) {
    if (e.type !== "damage") continue;
    const rule = lookupRule(e.abilityName);
    if (!rule) continue;
    const role = e.targetId ? idx.get(e.targetId)?.role : undefined;
    if (!isAvoidableHit(rule, role)) continue;

    let m = byAbility.get(e.abilityName);
    if (!m) {
      m = {
        ability: e.abilityName,
        encounter: rule.encounter,
        category: rule.category,
        advice: rule.advice,
        base: normSeverity(rule.severity),
        total: 0,
        ticks: 0,
        players: new Set(),
        deaths: new Set(),
      };
      byAbility.set(e.abilityName, m);
    }
    m.total += e.amount ?? 0;
    m.ticks += 1;
    if (e.targetId) m.players.add(e.targetId);
  }

  // Attribute deaths: a mechanic "fed" a death if the victim took it within the
  // 10s before dying.
  for (const d of fight.events) {
    if (d.type !== "death" || !d.targetId) continue;
    const role = idx.get(d.targetId)?.role;
    const windowStart = d.timestamp - RECAP_WINDOW_MS;
    for (const e of fight.events) {
      if (e.type !== "damage" || e.targetId !== d.targetId) continue;
      if (e.timestamp < windowStart || e.timestamp > d.timestamp) continue;
      const rule = lookupRule(e.abilityName);
      if (!isAvoidableHit(rule, role)) continue;
      byAbility.get(e.abilityName)?.deaths.add(d.targetId);
    }
  }

  return [...byAbility.values()]
    .map((m) => {
      const playersHit = m.players.size;
      const deaths = m.deaths.size;
      let severity = m.base;
      if (deaths > 0) severity = "critical";
      else if (m.ticks >= 3 || playersHit >= 3) severity = bump(severity);
      else if (m.ticks <= 1) severity = ORDER[Math.min(ORDER.indexOf(severity), 1)]; // cap single hit at medium

      const deathTxt = deaths > 0 ? `, ${deaths} death${deaths > 1 ? "s" : ""}` : "";
      // Label with the actual fight's boss (the catalogue's encounter is just a
      // hint and can be wrong for names shared across bosses, e.g. Whirlwind).
      const encounter = fight.bossName;
      const text = `${m.ability} (${encounter}) — ${playersHit} player${playersHit > 1 ? "s" : ""} hit, ${num(m.total)} dmg over ${m.ticks} tick${m.ticks > 1 ? "s" : ""}${deathTxt}. ${m.advice}`;

      return {
        ability: m.ability,
        encounter,
        category: m.category,
        advice: m.advice,
        playersHit,
        totalDamage: m.total,
        ticks: m.ticks,
        deaths,
        severity,
        text,
      };
    })
    .sort((a, b) => b.deaths - a.deaths || b.totalDamage - a.totalDamage);
}
