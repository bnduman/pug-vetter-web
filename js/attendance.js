// "Has this player raided with our guild before?" — aggregated from WCL's
// guild attendance (the player lists of every report uploaded under the
// guild's banner). Cached in localStorage; refreshed every few hours.
import { CONFIG } from "./config.js";
import { cacheGet, cacheSet, postGraphQL } from "./wcl.js";

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

// -> { guildName, reportsScanned, players: { nameLower:
//      {name, count, lastTs, raids: [{code, ts, zone}] (newest first)} } }
// or null when no guild is configured / the guild can't be found.
export async function getAttendanceMap() {
  if (!CONFIG.GUILD_NAME) return null;
  // "att2": key versioned; bump when the cached shape changes.
  const key = `guild_att2/${CONFIG.GUILD_REGION}/${slugify(CONFIG.GUILD_REALM)}/${CONFIG.GUILD_NAME.toLowerCase()}`;
  const cached = cacheGet(key, CONFIG.ATTENDANCE_TTL_SECONDS);
  if (cached) return cached;

  const vars = {
    name: CONFIG.GUILD_NAME,
    serverSlug: slugify(CONFIG.GUILD_REALM),
    serverRegion: CONFIG.GUILD_REGION,
  };
  const players = {};
  let guildName = CONFIG.GUILD_NAME;
  let reportsScanned = 0;

  for (let page = 1; page <= CONFIG.ATTENDANCE_MAX_PAGES; page++) {
    const data = await postGraphQL(ATTENDANCE_QUERY, { ...vars, page });
    const guild = data.guildData?.guild;
    if (!guild) return null; // guild not found on WCL
    guildName = guild.name ?? guildName;
    const att = guild.attendance;
    for (const report of att?.data ?? []) {
      reportsScanned += 1;
      for (const p of report.players ?? []) {
        if (!p?.name) continue;
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
  cacheSet(key, result);
  return result;
}
