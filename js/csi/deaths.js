"use strict";
// Per-death recap: reconstruct what happened in the 20s before each death,
// including a chronological play-by-play timeline.

export const RECAP_WINDOW_MS = 20_000;

// EMERGENCY survival cooldowns (self-cast or external). Deliberately excludes
// rotational mitigation like Holy Shield — a prot paladin has that up almost
// permanently, so counting it would make "died despite a defensive" (and
// suppress "unmitigated spike") on virtually every paladin death.
const EMERGENCY_DEFENSIVES = [
  "Shield Wall",
  "Last Stand",
  "Divine Protection",
  "Divine Shield",
  "Ardent Defender",
  "Power Word: Shield",
  "Pain Suppression",
  "Ice Block",
  "Barkskin",
  "Frenzied Regeneration",
  "Lay on Hands",
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

  // Consumables are tracked across the WHOLE fight: a Healthstone used early
  // still counts, so we never falsely report it as unused.
  let usedHealthstone = false;
  let usedHealingPotion = false;
  for (const e of fight.events) {
    if (e.sourceId !== victimId && e.targetId !== victimId) continue;
    const n = e.abilityName ?? "";
    if (HEALTHSTONE.test(n)) usedHealthstone = true;
    if (HEALING_POTION.test(n)) usedHealingPotion = true;
    if (usedHealthstone && usedHealingPotion) break;
  }

  const damageByAbility = new Map();
  const timeline = []; // chronological events involving the victim in the window
  let totalDamageTaken = 0;
  let avoidableDamageTaken = 0;
  let healsReceived = 0;
  let healCount = 0;
  let lastHealAt;
  let lastDamage;
  let lastDamageAt; // timestamp of the killing-blow candidate
  const defensives = []; // emergency cooldowns in the window: {ms, ability, source?}
  // Collapse a defensive's cast + its HoT heal ticks (Frenzied Regen, Lay on
  // Hands) into ONE use, while keeping genuinely distinct uses (a priest
  // re-shielding after Weakened Soul expires) as separate entries: events with
  // the same ability+caster chain together while <= this gap apart.
  const DEFENSIVE_CHAIN_MS = 6000;
  const defensiveLastSeen = new Map(); // "ability|caster" -> last event timestamp

  for (const e of fight.events) {
    if (!inWindow(e)) continue;
    const name = e.abilityName ?? "Unknown";
    const ms = t - e.timestamp; // ms before death

    // A defensive counts for the victim only when the victim RECEIVED it —
    // self-cast, or an external like a priest's Pain Suppression. One the
    // victim cast on someone ELSE is not protecting them. Live WCL self-buff
    // casts (Shield Wall, Ice Block…) carry targetID -1 ("environment"), so a
    // victim-sourced event whose target isn't a known actor is a self-cast.
    const protectedVictim = e.targetId === victimId ||
      (e.sourceId === victimId && (e.targetId == null || !idx.get(e.targetId)));
    if (protectedVictim && EMERGENCY_DEFENSIVES.includes(name)) {
      const chainKey = `${name}|${e.sourceId ?? "?"}`;
      const last = defensiveLastSeen.get(chainKey);
      defensiveLastSeen.set(chainKey, e.timestamp);
      if (last === undefined || e.timestamp - last > DEFENSIVE_CHAIN_MS) {
        // Attribute externals (a priest's PW:S / Pain Suppression) to the caster.
        const source = e.sourceId && e.sourceId !== victimId ? idx.get(e.sourceId)?.name : undefined;
        defensives.push({ ms, ability: name, source });
        timeline.push({ ms, kind: "cooldown", ability: name, source });
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
      // Killing blow = the damage closest to death by TIMESTAMP, not by array
      // order (event streams are normally sorted, but don't rely on it).
      if (lastDamageAt === undefined || e.timestamp >= lastDamageAt) {
        lastDamage = { abilityName: name, amount: amt };
        lastDamageAt = e.timestamp;
      }
      timeline.push({
        ms, kind: "damage", ability: name, amount: amt, avoidable: !!e.avoidable,
        source: idx.get(e.sourceId)?.name, hpPct: e.hpPct,
      });
    } else if (e.type === "heal") {
      const amt = e.amount ?? 0;
      healsReceived += amt;
      healCount += 1;
      lastHealAt = e.timestamp;
      timeline.push({
        ms, kind: "heal", ability: name, amount: amt,
        source: idx.get(e.sourceId)?.name, hpPct: e.hpPct,
      });
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
  if (!usedHealthstone) notes.push("No Healthstone used all fight.");
  if (victim.role === "tank" && !defensives.length) {
    notes.push(`No emergency defensive cooldown used in the final ${RECAP_WINDOW_MS / 1000}s.`);
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
    defensiveUsed: defensives.length > 0,
    defensives,
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
