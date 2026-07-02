"use strict";
// Turn a fight's deaths into a wipe diagnosis: primary cause, contributing
// factors, a next-pull checklist, and a confidence rating.
import { analyzeDeaths } from "./deaths.js";
import { applyMechanicRules, mechanicFindings } from "./mechanics.js";

const LATE_DEATH_MS = 20_000;

function confidenceFor(fight, deaths) {
  if (fight.events.length < 20 || deaths.length === 0) return "low";
  if (fight.events.length < 80) return "medium";
  return "high";
}

function formatRel(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function summarizeFight(fight, idx) {
  // Tag avoidable mechanic damage before analyzing deaths, so death recaps and
  // the avoidable-death logic reflect real boss mechanics on live reports.
  applyMechanicRules(fight, idx);
  const mechanics = mechanicFindings(fight, idx);
  const deaths = analyzeDeaths(fight, idx);

  if (fight.kill) {
    return {
      kill: true,
      primaryCause: { text: "Boss killed — clean pull.", severity: "low" },
      contributingFactors: [],
      nextPullChecklist: [],
      mechanics,
      confidence: confidenceFor(fight, deaths),
      deaths,
    };
  }

  const lateThreshold = fight.durationMs - LATE_DEATH_MS;
  const lateDeaths = deaths.filter((d) => d.timestamp >= lateThreshold);
  const tankDeaths = deaths.filter((d) => d.victim.role === "tank");
  const healerDeaths = deaths.filter((d) => d.victim.role === "healer");
  const avoidableDeaths = deaths.filter(
    (d) => d.totalDamageTaken > 0 && d.avoidableDamageTaken / d.totalDamageTaken >= 0.5,
  );

  const contributingFactors = [];
  const checklist = [];

  // A tank death is the ROOT cause only if it set off the collapse (tank died
  // first) or it's a late death with nothing else to blame. A tank dying last,
  // after others fell, is a symptom — not the cause.
  const firstDeath = deaths[0];
  const tankDiedFirst = !!firstDeath && firstDeath.victim.role === "tank";
  const lateTankDeath = tankDeaths.find((d) => d.timestamp >= lateThreshold);
  // Healer deaths only explain a wipe if they happened BEFORE the collapse.
  const earlyHealerDeaths = healerDeaths.filter((d) => d.timestamp < lateThreshold);

  // Describe a tank death from the evidence instead of assuming "unmitigated":
  // a defensive may have been up, or it may have been an avoidable mechanic.
  const tankDeathFinding = (d) => {
    const mostlyAvoidable =
      d.totalDamageTaken > 0 && d.avoidableDamageTaken / d.totalDamageTaken >= 0.5;
    if (mostlyAvoidable) {
      const ab = d.damageTaken.filter((s) => s.avoidable).map((s) => s.abilityName).join(", ") || "avoidable damage";
      checklist.push("Tank repositions/avoids the mechanic before it lands.");
      return { text: `Tank ${d.victim.name} died to avoidable damage (${ab}).`, severity: "critical", evidence: d.notes };
    }
    if (!d.defensiveUsed) {
      checklist.push("Tank pre-casts a defensive cooldown before the known spike.");
      checklist.push("Healers assign one person to hard-focus the tank in the danger window.");
      return { text: "Tank died during an unmitigated damage spike.", severity: "critical", evidence: d.notes };
    }
    checklist.push("Review tank healing coverage — a defensive was already used, so this is a healing gap or raw burst, not a missed cooldown.");
    const defNames = [...new Set((d.defensives ?? []).map((x) =>
      x.source ? `${x.ability} from ${x.source}` : x.ability))].join(", ");
    return {
      text: `Tank ${d.victim.name} died${d.killingBlow ? ` to ${d.killingBlow.abilityName}` : ""} despite ${defNames || "an active defensive"}.`,
      severity: "critical",
      evidence: d.notes,
    };
  };

  let primaryCause;
  if (tankDiedFirst) {
    primaryCause = tankDeathFinding(firstDeath);
  } else if (avoidableDeaths.length >= 3) {
    primaryCause = {
      text: `Multiple players (${avoidableDeaths.length}) died to avoidable mechanics.`,
      severity: "critical",
      evidence: avoidableDeaths.map(
        (d) => `${d.victim.name}: ${d.damageTaken.filter((s) => s.avoidable).map((s) => s.abilityName).join(", ") || "avoidable damage"}`,
      ),
    };
    checklist.push("Raid reacts faster to the avoidable mechanic — move on the cast, not the hit.");
  } else if (earlyHealerDeaths.length >= 2) {
    primaryCause = {
      text: "Healer deaths left the raid without enough healing.",
      severity: "high",
      evidence: earlyHealerDeaths.map((d) => `${d.victim.name} died at ${formatRel(d.timestamp)}`),
    };
    checklist.push("Protect healers — assign cooldowns/positioning so they survive the danger window.");
  } else if (lateTankDeath) {
    primaryCause = tankDeathFinding(lateTankDeath);
  } else if (fight.bossPercentRemaining !== undefined && fight.bossPercentRemaining < 5) {
    primaryCause = {
      text: `Near-kill (${fight.bossPercentRemaining}% left) — likely an execution/cleanup issue.`,
      severity: "medium",
    };
    checklist.push("Hold cooldowns/consumables for the final push.");
  } else if (deaths.length > 0) {
    const first = deaths[0];
    primaryCause = {
      text: `First death: ${first.victim.name}${first.killingBlow ? ` to ${first.killingBlow.abilityName}` : ""}.`,
      severity: first.severity,
      evidence: first.notes,
    };
  } else {
    primaryCause = { text: "No deaths recorded — wipe cause unclear from this data.", severity: "low" };
  }

  if (lateDeaths.length >= 2) {
    contributingFactors.push({
      text: `${lateDeaths.length} players died in the final ${LATE_DEATH_MS / 1000}s as the pull collapsed.`,
      severity: "high",
    });
  }
  const noHealthstone = deaths.filter((d) => !d.usedHealthstone);
  if (noHealthstone.length > 0) {
    contributingFactors.push({
      text: `${noHealthstone.length}/${deaths.length} of the players who died had not used a Healthstone.`,
      severity: "medium",
    });
    checklist.push("Everyone uses a Healthstone before they hit execute range.");
  }
  if (avoidableDeaths.length > 0 && !primaryCause.text.startsWith("Multiple")) {
    contributingFactors.push({
      text: `${avoidableDeaths.length} death(s) were mostly avoidable damage.`,
      severity: "high",
    });
  }
  // Turn the deadliest identified mechanic into concrete next-pull advice.
  const fatalMechanic = mechanics.find((m) => m.deaths > 0);
  if (fatalMechanic) {
    checklist.push(`${fatalMechanic.ability}: ${fatalMechanic.advice}`);
  }

  return {
    kill: false,
    primaryCause,
    contributingFactors,
    nextPullChecklist: [...new Set(checklist)],
    mechanics,
    confidence: confidenceFor(fight, deaths),
    deaths,
  };
}
