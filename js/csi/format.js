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
export function actorIndex(report) {
  return new Map(report.actors.map((a) => [a.id, a]));
}
