"use strict";
// Turn a fight's deaths into a wipe diagnosis: primary cause, contributing
// factors, a next-pull checklist, and a confidence rating.
import { analyzeDeaths } from "./deaths.js";

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
  const deaths = analyzeDeaths(fight, idx);

  if (fight.kill) {
    return {
      kill: true,
      primaryCause: { text: "Boss killed — clean pull.", severity: "low" },
      contributingFactors: [],
      nextPullChecklist: [],
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
  // first) or it's a late spike death with nothing else to blame. A tank dying
  // last, after others fell, is a symptom — not the cause.
  const firstDeath = deaths[0];
  const tankDiedFirst = !!firstDeath && firstDeath.victim.role === "tank";
  const lateTankDeath = tankDeaths.find((d) => d.timestamp >= lateThreshold && !d.defensiveUsed);

  const tankSpikeFinding = (evidence) => {
    checklist.push("Tank pre-casts a defensive cooldown before the known spike.");
    checklist.push("Healers assign one person to hard-focus the tank in the danger window.");
    return { text: "Tank died during an unmitigated damage spike.", severity: "critical", evidence };
  };

  let primaryCause;
  if (tankDiedFirst) {
    primaryCause = tankSpikeFinding(firstDeath.notes);
  } else if (avoidableDeaths.length >= 3) {
    primaryCause = {
      text: `Multiple players (${avoidableDeaths.length}) died to avoidable mechanics.`,
      severity: "critical",
      evidence: avoidableDeaths.map(
        (d) => `${d.victim.name}: ${d.damageTaken.filter((s) => s.avoidable).map((s) => s.abilityName).join(", ") || "avoidable damage"}`,
      ),
    };
    checklist.push("Raid reacts faster to the avoidable mechanic — move on the cast, not the hit.");
  } else if (healerDeaths.length >= 2) {
    primaryCause = {
      text: "Healer deaths left the raid without enough healing.",
      severity: "high",
      evidence: healerDeaths.map((d) => `${d.victim.name} died at ${formatRel(d.timestamp)}`),
    };
    checklist.push("Protect healers — assign cooldowns/positioning so they survive the danger window.");
  } else if (lateTankDeath) {
    primaryCause = tankSpikeFinding(lateTankDeath.notes);
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

  return {
    kill: false,
    primaryCause,
    contributingFactors,
    nextPullChecklist: [...new Set(checklist)],
    confidence: confidenceFor(fight, deaths),
    deaths,
  };
}
