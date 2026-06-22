"use strict";
// Per-death recap: reconstruct what happened in the 20s before each death,
// including a chronological play-by-play timeline.

export const RECAP_WINDOW_MS = 20_000;

// Self-cast survival cooldowns we expect a player (esp. a tank) to use.
const DEFENSIVE_ABILITIES = [
  "Shield Wall",
  "Last Stand",
  "Divine Protection",
  "Divine Shield",
  "Holy Shield",
  "Ardent Defender",
  "Power Word: Shield",
  "Pain Suppression",
];

const HEALTHSTONE = /healthstone/i;
const HEALING_POTION = /healing potion/i;

function classifySeverity(victim, avoidableDamage, totalDamage) {
  if (victim.role === "tank") return "critical";
  if (victim.role === "healer") return "high";
  if (totalDamage > 0 && avoidableDamage / totalDamage >= 0.5) return "medium";
  return "low";
}

function analyzeDeath(death, fight, idx) {
  const victimId = death.targetId;
  if (!victimId) return null;
  const victim = idx.get(victimId);
  if (!victim) return null;

  const t = death.timestamp;
  const windowStart = t - RECAP_WINDOW_MS;
  const inWindow = (e) => e.timestamp >= windowStart && e.timestamp <= t;

  const damageByAbility = new Map();
  const timeline = []; // chronological events involving the victim in the window
  let totalDamageTaken = 0;
  let avoidableDamageTaken = 0;
  let healsReceived = 0;
  let healCount = 0;
  let lastHealAt;
  let lastDamage;
  let usedHealthstone = false;
  let usedHealingPotion = false;
  let defensiveUsed = false;

  for (const e of fight.events) {
    if (!inWindow(e)) continue;
    const name = e.abilityName ?? "Unknown";
    const ms = t - e.timestamp; // ms before death

    if (e.sourceId === victimId || e.targetId === victimId) {
      if (HEALTHSTONE.test(name)) usedHealthstone = true;
      if (HEALING_POTION.test(name)) usedHealingPotion = true;
      if (DEFENSIVE_ABILITIES.includes(name)) {
        defensiveUsed = true;
        timeline.push({ ms, kind: "cooldown", ability: name });
      }
    }

    if (e.targetId !== victimId) continue;

    if (e.type === "damage") {
      const amt = e.amount ?? 0;
      totalDamageTaken += amt;
      if (e.avoidable) avoidableDamageTaken += amt;
      const entry = damageByAbility.get(name) ?? { abilityName: name, total: 0, avoidable: !!e.avoidable };
      entry.total += amt;
      entry.avoidable = entry.avoidable || !!e.avoidable;
      damageByAbility.set(name, entry);
      lastDamage = { abilityName: name, amount: amt };
      timeline.push({ ms, kind: "damage", ability: name, amount: amt, avoidable: !!e.avoidable });
    } else if (e.type === "heal") {
      const amt = e.amount ?? 0;
      healsReceived += amt;
      healCount += 1;
      lastHealAt = e.timestamp;
      timeline.push({ ms, kind: "heal", ability: name, amount: amt });
    }
  }

  // earliest first; the death itself is the anchor at ms 0 (rendered separately)
  timeline.sort((a, b) => b.ms - a.ms);

  const damageTaken = [...damageByAbility.values()].sort((a, b) => b.total - a.total);
  const lastHealMsBeforeDeath = lastHealAt !== undefined ? t - lastHealAt : undefined;

  const notes = [];
  if (healCount === 0) {
    notes.push(`No direct heals received in the final ${RECAP_WINDOW_MS / 1000}s.`);
  } else if (lastHealMsBeforeDeath !== undefined && lastHealMsBeforeDeath > 4000) {
    notes.push(`Last direct heal landed ${(lastHealMsBeforeDeath / 1000).toFixed(1)}s before death.`);
  }

  const avoidable = damageTaken.filter((d) => d.avoidable);
  if (avoidable.length > 0) {
    notes.push(`Took avoidable damage (${avoidable.map((d) => d.abilityName).join(", ")}) before dying.`);
  }
  if (!usedHealthstone) notes.push("No Healthstone used.");
  if (victim.role === "tank" && !defensiveUsed) {
    notes.push("No major defensive cooldown active during the spike.");
  }

  return {
    victim,
    timestamp: t,
    severity: classifySeverity(victim, avoidableDamageTaken, totalDamageTaken),
    killingBlow: lastDamage,
    windowMs: RECAP_WINDOW_MS,
    timeline,
    damageTaken,
    totalDamageTaken,
    avoidableDamageTaken,
    healsReceived,
    healCount,
    lastHealMsBeforeDeath,
    usedHealthstone,
    usedHealingPotion,
    defensiveUsed,
    notes,
  };
}

/** Reconstruct every death in a fight, earliest first. */
export function analyzeDeaths(fight, idx) {
  return fight.events
    .filter((e) => e.type === "death")
    .map((d) => analyzeDeath(d, fight, idx))
    .filter((r) => r !== null)
    .sort((a, b) => a.timestamp - b.timestamp);
}
