// The lookup orchestration: character rankings (+ latest report's boss fights
// in the same query), then one gear query. Produces the full scorecard.
import { CONFIG } from "./config.js";
import {
  analyzeEnchants, buildGearList, findPlayer, parseColor, primarySpec, summarizeZone,
} from "./analyze.js";
import { computeGearScore } from "./gearscore.js";
import { CLASS_COLORS, CLASS_NAMES } from "./wcl-classes.js";
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

// -> {enchants, gear, role} or null when the character isn't in the report.
async function fetchGearInfo(reportCode, fightIds, charName) {
  if (!fightIds.length) return null;
  const data = await postGraphQL(REPORT_GEAR_QUERY, { code: reportCode, fightIDs: fightIds });
  const details = data.reportData?.report?.playerDetails;
  const player = findPlayer(details, charName);
  if (!player) return null;
  return {
    enchants: analyzeEnchants(player.gear),
    gear: buildGearList(player.gear),
    role: player.role,
  };
}

export async function vet(name) {
  const realm = CONFIG.REALM;
  const region = CONFIG.REGION;
  // "vet3" — cache key versioned; bump when the result shape changes.
  const key = `vet3/${region}/${slugifyRealm(realm)}/${name.toLowerCase()}`;
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

  const zrList = zones.map((z) => char[`z${z.id}`]);
  const raids = zones.map((z, i) => {
    const summary = summarizeZone(z.name, zrList[i]);
    const { tier, color } = parseColor(summary.best_parse);
    return { ...summary, tier, color };
  });

  let gearInfo = null;
  let lastLog = null;
  const recent = char.recentReports?.data ?? [];
  if (recent.length) {
    lastLog = recent[0].startTime ?? null;
    const code = recent[0].code;
    const fightIds = (recent[0].fights ?? []).map((f) => f.id).filter((id) => id != null);
    if (code && fightIds.length) {
      try {
        gearInfo = await fetchGearInfo(code, fightIds, name);
      } catch {
        gearInfo = null; // gear is a bonus; never fail the whole lookup over it
      }
    }
  }

  const className = CLASS_NAMES[char.classID] ?? null;
  // Also stamps a per-item `gs` onto each gear entry for the detail view.
  const gearscore = gearInfo?.gear?.length
    ? computeGearScore(gearInfo.gear, className)
    : null;
  const result = {
    found: true,
    name: char.name ?? name,
    realm,
    region,
    class: className,
    classColor: CLASS_COLORS[className] ?? "#e8e9ee",
    spec: primarySpec(zrList),
    role: gearInfo?.role ?? null,
    raids,
    enchants: gearInfo?.enchants ?? null,
    gear: gearInfo?.gear ?? null,
    gearscore,
    last_log: lastLog,
  };
  cacheSet(key, result);
  return result;
}
