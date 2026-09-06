"use strict";
// Small formatting + lookup helpers shared by the Wipe Autopsy tab.

/** 287000 -> "4:47". Negative/NaN -> "0:00". */
export function mmss(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Thousands separators: 7840 -> "7,840". */
export function num(n) {
  return Math.round(n).toLocaleString("en-US");
}

/** id -> Actor lookup for a report. */
// `fight` is optional but matters: a player's ROLE is per-fight (it comes from
// that fight's playerDetails), and role decides whether a frontal counts
// against someone. Opening one pull used to overwrite the report-wide actor
// list, so a player who tanked pull 1 and DPS'd pull 5 had pull 1 re-diagnosed
// the moment you looked at pull 5 — earlier verdicts silently changing based on
// where you clicked. A fight that carries its own actors is graded with them;
// one that was never opened individually falls back to the report-wide list.
export function actorIndex(report, fight) {
  return new Map((fight?.actors ?? report.actors).map((a) => [a.id, a]));
}
