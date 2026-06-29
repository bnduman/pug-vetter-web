"use strict";
// Fetch a WCL report and normalize it into the CSI model — reusing the existing
// wcl.js client (token + GraphQL + caching) and config.js credentials, so there
// is one WCL client and one key across the whole site.
import { CONFIG } from "../config.js";
import { cacheGet, cacheSet, postGraphQL, WCLError } from "../wcl.js";
import { buildReport } from "./normalize.js";
import { raidConsumables, raidEnchants } from "./prep.js";
import {
  BUFFS_TABLE_QUERY, PLAYER_DETAILS_QUERY, REPORT_EVENTS_QUERY, REPORT_META_QUERY,
} from "./queries.js";

// Friendly-side event streams the death-recap engine needs. Minimal, to limit
// rate-limit cost: deaths, damage taken, healing, casts (for defensives).
const EVENT_DATA_TYPES = ["Deaths", "DamageTaken", "Healing", "Casts"];
const MAX_EVENT_PAGES = 50;
const TTL = CONFIG.LOOKUP_TTL_SECONDS;

// Raw event streams are large (~1 MB/fight) and would blow the ~5 MB
// localStorage quota after a few fights. Cache them in memory for the session
// instead; only the small meta/playerDetails blobs go to localStorage.
const eventCache = new Map();

async function fetchMeta(code) {
  const key = `csi_meta_${code}`;
  const cached = cacheGet(key, TTL);
  if (cached) return cached;
  const data = await postGraphQL(REPORT_META_QUERY, { code });
  const report = data?.reportData?.report;
  if (!report) throw new WCLError(`No report found for code '${code}'.`);
  cacheSet(key, report);
  return report;
}

async function fetchEventStream(code, fightID, start, end, dataType) {
  const out = [];
  let pageStart = start;
  for (let i = 0; i < MAX_EVENT_PAGES; i++) {
    const data = await postGraphQL(REPORT_EVENTS_QUERY, {
      code, fightID, start: pageStart, end, dataType,
    });
    const block = data?.reportData?.report?.events ?? {};
    out.push(...(block.data ?? []));
    const next = block.nextPageTimestamp;
    if (!next || next <= pageStart) break;
    pageStart = next;
  }
  return out;
}

async function fetchFightEvents(code, fightId, start, end) {
  const all = [];
  for (const dt of EVENT_DATA_TYPES) {
    all.push(...(await fetchEventStream(code, fightId, start, end, dt)));
  }
  return all;
}

async function fetchPlayerDetails(code, fightId) {
  const data = await postGraphQL(PLAYER_DETAILS_QUERY, { code, fightIDs: [fightId] });
  return data?.reportData?.report?.playerDetails;
}

async function fetchBuffsTable(code, fightId, start, end) {
  const data = await postGraphQL(BUFFS_TABLE_QUERY, { code, fightID: fightId, start, end });
  return data?.reportData?.report?.table ?? null;
}

/**
 * fetchReport(code)           -> overview: all boss fights, no events
 * fetchReport(code, fightId)  -> that fight with its events + player roles
 */
export async function fetchReport(code, fightId = null) {
  const report = await fetchMeta(code);
  const eventsByFight = {};

  if (fightId != null) {
    const fight = (report.fights ?? []).find((f) => f.id === fightId);
    if (!fight) throw new WCLError(`Fight ${fightId} not found in report ${code}.`);

    const evKey = `csi_events_${code}_${fightId}`;
    let events = eventCache.get(evKey);
    if (!events) {
      events = await fetchFightEvents(code, fightId, fight.startTime ?? 0, fight.endTime ?? 0);
      eventCache.set(evKey, events);
    }
    eventsByFight[fightId] = events;

    // playerDetails now carries gear (includeCombatantInfo) and the buffs table
    // is sizable, so both ride the in-memory cache rather than localStorage.
    const pdKey = `csi_pd_${code}_${fightId}`;
    let pd = eventCache.get(pdKey);
    if (pd === undefined) {
      pd = (await fetchPlayerDetails(code, fightId)) ?? null;
      eventCache.set(pdKey, pd);
    }
    report.playerDetails = pd;

    const buKey = `csi_buffs_${code}_${fightId}`;
    let buffs = eventCache.get(buKey);
    if (buffs === undefined) {
      buffs = await fetchBuffsTable(code, fightId, fight.startTime ?? 0, fight.endTime ?? 0);
      eventCache.set(buKey, buffs);
    }

    const built = buildReport(code, report, fightId, eventsByFight);
    const builtFight = built.fights.find((f) => f.id === String(fightId));
    if (builtFight) {
      const enchants = raidEnchants(pd);
      builtFight.prep = { enchants, consumables: raidConsumables(buffs, enchants.total) };
    }
    return built;
  }

  return buildReport(code, report, fightId, eventsByFight);
}
