// The lookup orchestration: character rankings (+ recent reports' boss fights
// in the same query), then gear queries. Produces the full scorecard, with one
// gear set per spec for dual-spec players.
import { CONFIG } from "./config.js";
import {
  analyzeEnchants, buildGearList, distinctRoles, findPlayer, parseColor,
  primarySpec, summarizeZone,
} from "./analyze.js";
import { computeGearScore } from "./gearscore.js";
import { CLASS_COLORS, CLASS_NAMES } from "./wcl-classes.js";
import { cacheGet, cacheSet, postGraphQL, WCLError } from "./wcl.js";
import { getRaidZones } from "./zones.js";

// How many recent reports to scan when hunting for a second role's gear.
// Only multi-role players scan past the first report, and they stop as soon as
// the second role is found — so this is a worst-case bound, not a per-lookup cost.
const MULTISPEC_SCAN_REPORTS = 15;

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
      recentReports(limit: ${MULTISPEC_SCAN_REPORTS}) {
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

// One report -> the character's gear set in it, or null if they're not in it.
async function gearSetFromReport(rep, charName, className) {
  const code = rep.code;
  const fightIds = (rep.fights ?? []).map((f) => f.id).filter((id) => id != null);
  if (!code || !fightIds.length) return null;
  const data = await postGraphQL(REPORT_GEAR_QUERY, { code, fightIDs: fightIds });
  const player = findPlayer(data.reportData?.report?.playerDetails, charName);
  if (!player || !player.gear.length) return null;
  const gear = buildGearList(player.gear);          // stamps per-item gs below
  const enchants = analyzeEnchants(player.gear);
  const gearscore = computeGearScore(gear, className);
  return {
    spec: player.spec,
    role: player.role,
    gear,
    enchants,
    gearscore,
    ilvl: enchants.avg_item_level,
    lastLog: rep.startTime ?? null,
    reportCode: code,
  };
}

// Collect a gear set per distinct ROLE (tank/healer/dps). Single-role players
// cost one query; only genuinely multi-role characters scan further. Grouping
// by role (not spec) avoids splitting a player when WCL mislabels their spec
// with a tier-set name across reports.
async function buildGearSets(reports, charName, className, multi) {
  const sets = [];
  const seenRoles = new Set();
  const limit = multi ? Math.min(reports.length, MULTISPEC_SCAN_REPORTS) : 1;
  for (let i = 0; i < limit; i++) {
    let set;
    try {
      set = await gearSetFromReport(reports[i], charName, className);
    } catch (e) {
      if (e instanceof WCLError) throw e; // surface rate-limit/auth/network failures
      continue; // otherwise skip a single malformed report
    }
    if (!set) continue;
    const roleKey = set.role ?? `set${i}`;
    if (seenRoles.has(roleKey)) continue; // keep the newest gear per role
    seenRoles.add(roleKey);
    sets.push(set);
    if (sets.length >= 2) break; // tank + dps is plenty
  }
  return sets;
}

export async function vet(name) {
  const realm = CONFIG.REALM;
  const region = CONFIG.REGION;
  // "vet5" — cache key versioned; bump when the result shape/values change.
  const key = `vet5/${region}/${slugifyRealm(realm)}/${name.toLowerCase()}`;
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

  const className = CLASS_NAMES[char.classID] ?? null;
  const recent = char.recentReports?.data ?? [];
  const lastLog = recent[0]?.startTime ?? null;

  let gearSets = [];
  let gearError = null;
  if (recent.length) {
    const multi = distinctRoles(zrList).size >= 2;
    try {
      gearSets = await buildGearSets(recent, name, className, multi);
    } catch (e) {
      // Don't disguise an auth/rate-limit/network failure as "no gear".
      gearError = e instanceof WCLError ? e.message : "Gear data could not be loaded.";
    }
  }

  const primary = gearSets[0] ?? null;
  const specs = gearSets.map((s) => s.spec).filter(Boolean);
  const maxGs = gearSets.reduce((m, s) => Math.max(m, s.gearscore ?? 0), 0) || null;

  const result = {
    found: true,
    name: char.name ?? name,
    realm,
    region,
    class: className,
    classColor: CLASS_COLORS[className] ?? "#e8e9ee",
    classID: char.classID ?? null,
    spec: specs[0] ?? primarySpec(zrList),
    specs,
    role: primary?.role ?? null,
    raids,
    gearSets,
    gearError, // non-null when gear couldn't be fetched (vs genuinely absent)
    enchants: primary?.enchants ?? null, // primary set, for the roster card
    gearscore: maxGs,
    last_log: lastLog,
  };
  cacheSet(key, result);
  return result;
}
