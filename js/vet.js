// The lookup orchestration: character rankings (+ latest report's boss fights
// in the same query), then one gear query. Returns the same scorecard shape
// the Flask version's /api/vet produced.
import { CONFIG } from "./config.js";
import { analyzeEnchants, findPlayerGear, parseColor, summarizeZone } from "./analyze.js";
import { cacheGet, cacheSet, postGraphQL } from "./wcl.js";
import { getRaidZones } from "./zones.js";

function slugifyRealm(realm) {
  return (realm ?? "").trim().toLowerCase().replace(/'/g, "")
    .replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function buildCharacterQuery(zoneIds) {
  const aliases = zoneIds.map((zid) => `      z${zid}: zoneRankings(zoneID: ${zid})`).join("\n");
  return `
query($name: String!, $serverSlug: String!, $serverRegion: String!) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      id
      name
      classID
      recentReports(limit: 1) {
        data { code startTime fights(killType: Encounters) { id } }
      }
${aliases}
    }
  }
}`;
}

const REPORT_GEAR_QUERY = `
query($code: String!, $fightIDs: [Int]!) {
  reportData {
    report(code: $code) {
      playerDetails(fightIDs: $fightIDs, includeCombatantInfo: true)
    }
  }
}`;

async function fetchEnchants(reportCode, fightIds, charName) {
  if (!fightIds.length) return null;
  const data = await postGraphQL(REPORT_GEAR_QUERY, { code: reportCode, fightIDs: fightIds });
  const details = data.reportData?.report?.playerDetails;
  const gear = findPlayerGear(details, charName);
  return gear ? analyzeEnchants(gear) : null;
}

export async function vet(name) {
  const realm = CONFIG.REALM;
  const region = CONFIG.REGION;
  const key = `vet/${region}/${slugifyRealm(realm)}/${name.toLowerCase()}`;
  const cached = cacheGet(key, CONFIG.LOOKUP_TTL_SECONDS);
  if (cached) return cached;

  const zones = await getRaidZones();
  const query = buildCharacterQuery(zones.map((z) => z.id));
  const data = await postGraphQL(query, {
    name, serverSlug: slugifyRealm(realm), serverRegion: region,
  });

  const char = data.characterData?.character;
  if (!char) {
    const result = { found: false, name, realm, region };
    cacheSet(key, result);
    return result;
  }

  const raids = zones.map((z) => {
    const summary = summarizeZone(z.name, char[`z${z.id}`]);
    const { tier, color } = parseColor(summary.best_parse);
    return { ...summary, tier, color };
  });

  let enchants = null;
  let lastLog = null;
  const recent = char.recentReports?.data ?? [];
  if (recent.length) {
    lastLog = recent[0].startTime ?? null;
    const code = recent[0].code;
    const fightIds = (recent[0].fights ?? []).map((f) => f.id).filter((id) => id != null);
    if (code && fightIds.length) {
      try {
        enchants = await fetchEnchants(code, fightIds, name);
      } catch {
        enchants = null; // gear is a bonus; never fail the whole lookup over it
      }
    }
  }

  const result = {
    found: true,
    name: char.name ?? name,
    realm,
    region,
    classID: char.classID ?? null,
    raids,
    enchants,
    last_log: lastLog,
  };
  cacheSet(key, result);
  return result;
}
