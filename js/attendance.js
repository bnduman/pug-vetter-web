// "Has this player raided with our guild before?" — aggregated from WCL's
// guild attendance (the player lists of every report uploaded under the
// guild's banner). Cached in localStorage; refreshed every few hours.
import { CONFIG } from "./config.js";
import { WCLError, cacheGet, cacheSet, postGraphQL } from "./wcl.js";

const ATTENDANCE_QUERY = `
query($name: String!, $serverSlug: String!, $serverRegion: String!, $page: Int!) {
  guildData {
    guild(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      name
      attendance(limit: 25, page: $page) {
        total
        per_page
        current_page
        data {
          code
          startTime
          zone { name }
          players { name presence }
        }
      }
    }
  }
}`;

const slugify = (realm) =>
  (realm ?? "").trim().toLowerCase().replace(/'/g, "").replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "");

// --- alt bundling (CONFIG.ALTS: MAIN -> [alts...]) --------------------------
// WCL has no public character->account link (Character.claimed is permission-
// gated), so same-person characters are declared by hand in config.

/** The configured main for a character name; the name itself if not an alt. */
export function resolveMain(name, alts = CONFIG.ALTS) {
  const key = (name ?? "").toLowerCase();
  for (const [main, altNames] of Object.entries(alts ?? {})) {
    if ((altNames ?? []).some((a) => a.toLowerCase() === key)) return main;
  }
  return name;
}

/** Merge alt entries of an attendance `players` map into their mains, in
 *  place. Raids are deduped by report code (a player can appear in the same
 *  report on two characters); the main gains an `alts` name list. */
export function mergeAlts(players, alts = CONFIG.ALTS) {
  for (const [main, altNames] of Object.entries(alts ?? {})) {
    const mainKey = main.toLowerCase();
    let entry = players[mainKey];
    const absorbed = [];
    for (const altName of altNames ?? []) {
      const altKey = altName.toLowerCase();
      const alt = altKey === mainKey ? null : players[altKey];
      if (!alt) continue;
      if (!entry) entry = players[mainKey] = { name: main, count: 0, lastTs: 0, raids: [] };
      entry.raids.push(...alt.raids);
      absorbed.push(alt.name);
      delete players[altKey];
    }
    if (!absorbed.length) continue;
    const seen = new Set();
    entry.raids = entry.raids
      .filter((r) => {
        const k = r.code ?? `ts:${r.ts}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => b.ts - a.ts);
    entry.count = entry.raids.length;
    entry.lastTs = entry.raids[0]?.ts ?? entry.lastTs;
    entry.alts = [...(entry.alts ?? []), ...absorbed];
  }
  return players;
}

// WCL's attendance endpoint intermittently hangs past our 20s timeout
// (observed 2026-07-16 while switching guilds: identical queries alternated
// between ~400ms and timeouts for ~10 minutes). One retry rescues those runs;
// non-timeout errors (auth, bad query) still surface immediately.
async function attendancePage(vars) {
  try {
    return await postGraphQL(ATTENDANCE_QUERY, vars);
  } catch (err) {
    if (err instanceof WCLError && /timed out/i.test(err.message)) {
      return postGraphQL(ATTENDANCE_QUERY, vars);
    }
    throw err;
  }
}

// -> { guildName, reportsScanned, players: { nameLower:
//      {name, count, lastTs, raids: [{code, ts, zone}] (newest first)} } }
// or null when no guild is configured / the guild can't be found.
export async function getAttendanceMap() {
  if (!CONFIG.GUILD_NAME) return null;
  // "att2": key versioned; bump when the cached shape changes. The page count
  // is part of the key so raising ATTENDANCE_MAX_PAGES takes effect
  // immediately instead of serving the shallower cached map for up to 6h.
  const key = `guild_att2/${CONFIG.GUILD_REGION}/${slugify(CONFIG.GUILD_REALM)}/${CONFIG.GUILD_NAME.toLowerCase()}/p${CONFIG.ATTENDANCE_MAX_PAGES}`;
  // The RAW map is what's cached; alts merge on every return so edits to
  // CONFIG.ALTS take effect without waiting out the attendance TTL.
  const cached = cacheGet(key, CONFIG.ATTENDANCE_TTL_SECONDS);
  if (cached) {
    mergeAlts(cached.players);
    return cached;
  }

  const vars = {
    name: CONFIG.GUILD_NAME,
    serverSlug: slugify(CONFIG.GUILD_REALM),
    serverRegion: CONFIG.GUILD_REGION,
  };
  const players = {};
  let guildName = CONFIG.GUILD_NAME;
  let reportsScanned = 0;

  for (let page = 1; page <= CONFIG.ATTENDANCE_MAX_PAGES; page++) {
    const data = await attendancePage({ ...vars, page });
    const guild = data.guildData?.guild;
    if (!guild) return null; // guild not found on WCL
    guildName = guild.name ?? guildName;
    const att = guild.attendance;
    for (const report of att?.data ?? []) {
      reportsScanned += 1;
      for (const p of report.players ?? []) {
        if (!p?.name) continue;
        // WCL marks bench/standby sign-ups with presence === 2; only presence
        // === 1 (actually in the raid) counts as "raided with us". Treat a
        // missing/unknown value as present so we never silently drop everyone
        // if the field shape changes.
        if (p.presence === 2) continue;
        const k = p.name.toLowerCase();
        const entry = players[k] ?? { name: p.name, count: 0, lastTs: 0, raids: [] };
        entry.count += 1;
        entry.lastTs = Math.max(entry.lastTs, report.startTime ?? 0);
        entry.raids.push({
          code: report.code ?? null,
          ts: report.startTime ?? 0,
          zone: report.zone?.name ?? "?",
        });
        players[k] = entry;
      }
    }
    const seen = (att?.current_page ?? page) * (att?.per_page ?? 25);
    if (!att || seen >= (att.total ?? 0)) break; // no more pages
  }

  for (const entry of Object.values(players)) {
    entry.raids.sort((a, b) => b.ts - a.ts); // newest first
  }
  const result = { guildName, reportsScanned, players };
  cacheSet(key, result); // raw, pre-merge (see cache note above)
  mergeAlts(players);
  return result;
}

// Re-aggregate attendance relative to ONE character ("me"): for every other
// player, how many of *my* logged raids they also attended.
// -> { guildName, meName, mePresent, meRaidCount, reportsScanned,
//      players: { nameLower: {name, withMe, shared:[{code,ts,zone}], lastTs} } }
// or null when no guild is configured / found.
export async function getCoraidMap() {
  const map = await getAttendanceMap();
  if (!map) return null;

  // ME_NAME may itself be an alt — measure against the merged main entry.
  const meKey = resolveMain(CONFIG.ME_NAME || "").toLowerCase();
  const me = meKey ? map.players[meKey] : null;

  // myCodes = the reports to measure against. null = "all reports" (guild
  // mode, when no ME_NAME is configured); a set otherwise.
  let myCodes;
  if (!meKey) myCodes = null;            // guild mode: count every report
  else if (me) myCodes = new Set(me.raids.map((r) => r.code).filter(Boolean));
  else myCodes = new Set();              // configured main not found -> nothing

  const players = {};
  for (const [k, p] of Object.entries(map.players)) {
    if (meKey && k === meKey) continue; // don't list yourself
    const shared = myCodes === null ? p.raids : p.raids.filter((r) => r.code && myCodes.has(r.code));
    if (shared.length) {
      players[k] = { name: p.name, withMe: shared.length, shared, lastTs: shared[0]?.ts ?? 0 };
    }
  }
  return {
    guildName: map.guildName,
    meName: CONFIG.ME_NAME || map.guildName,
    mePresent: !meKey || !!me,
    meRaidCount: myCodes === null ? map.reportsScanned : myCodes.size,
    reportsScanned: map.reportsScanned,
    players,
  };
}
