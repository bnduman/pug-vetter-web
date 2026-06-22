"use strict";
// Parse a Warcraft Logs report URL (or bare code) into { reportCode, fightId }.
// Supports classic/www/fresh subdomains and #fight=5 / #fight=last fragments.

const BARE_CODE = /^[a-zA-Z0-9]{12,}$/;
const REPORT_PATH = /\/reports\/([a-zA-Z0-9]+)/;
const FIGHT_FRAGMENT = /[#&]fight=(last|\d+)/;

export function parseReportUrl(input) {
  const trimmed = (input || "").trim();
  if (!trimmed) return null;

  // Bare report code (no slashes, no protocol).
  if (!trimmed.includes("/") && BARE_CODE.test(trimmed)) {
    return { reportCode: trimmed, fightId: undefined };
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!/warcraftlogs\.com$/i.test(url.hostname)) return null;

  const pathMatch = url.pathname.match(REPORT_PATH);
  if (!pathMatch) return null;

  const fightMatch = (url.hash || url.search).match(FIGHT_FRAGMENT);
  let fightId;
  if (fightMatch) fightId = fightMatch[1] === "last" ? "last" : Number(fightMatch[1]);

  return { reportCode: pathMatch[1], fightId };
}
