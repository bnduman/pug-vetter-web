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
// the second role is found. Capped at 8: measured live, players whose first
// several reports all show one role almost never yield a second set later.
const MULTISPEC_SCAN_REPORTS = 8;
// Gear queries per concurrent batch during the multi-role scan.
const GEAR_CONCURRENCY = 5;

function slugifyRealm(realm) {
  return (realm ?? "").trim().toLowerCase().replace(/'/g, "")
    .replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "");
}

// External profile links for a character, built from the locked realm/region.
// WCL: classic.warcraftlogs.com/character/<region>/<realm>/<name>
// Armory: classic-armory.org/character/<region>/<flavor>/<realm>/<name>
// (URL formats verified against both live sites, incl. non-ASCII names.)
function characterLinks(region, realm, name) {
  const reg = (region ?? "").toLowerCase();
  const slug = slugifyRealm(realm);
  const nm = encodeURIComponent(name);
  return {
    wclUrl: `https://classic.warcraftlogs.com/character/${reg}/${slug}/${nm}`,
    armoryUrl:
      `https://classic-armory.org/character/${reg}/${CONFIG.ARMORY_FLAVOR}/${slug}/${nm}`,
  };
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
//
// The scan runs in concurrent batches (measured: sequential scanning was the
// bulk of a slow lookup) and stops as soon as a second role turns up. Batch
// results are processed in report order, so the NEWEST gear per role wins.
async function buildGearSets(reports, charName, className, multi) {
  const sets = [];
  const seenRoles = new Set();
  const slice = reports.slice(0, multi ? MULTISPEC_SCAN_REPORTS : 1);
  let wclError = null;

  for (let i = 0; i < slice.length && sets.length < 2; i += GEAR_CONCURRENCY) {
    const batch = slice.slice(i, i + GEAR_CONCURRENCY);
    const results = await Promise.all(batch.map((rep) =>
      gearSetFromReport(rep, charName, className).catch((e) => {
        if (e instanceof WCLError) wclError = wclError ?? e;
        return null; // a single bad report never sinks the batch
      }),
    ));
    for (const set of results) {
      if (!set) continue;
      const roleKey = set.role ?? "?";
      if (seenRoles.has(roleKey)) continue; // keep the newest gear per role
      seenRoles.add(roleKey);
      sets.push(set);
      if (sets.length >= 2) break; // tank + dps is plenty
    }
  }

  // Surface rate-limit/auth/network failures — but only when they cost us
  // everything; a partial result is still worth showing.
  if (!sets.length && wclError) throw wclError;
  return sets;
}

/**
 * Look up a character. Two-phase for perceived speed: the scorecard (raids,
 * parses, class) is ready after ONE query and is handed to `onScorecard` with
 * `gearPending: true`; the gear/enchant scan then completes and the full
 * result is returned (and cached). Cache hits skip the callback entirely.
 */
export async function vet(name, { onScorecard } = {}) {
  const realm = CONFIG.REALM;
  const region = CONFIG.REGION;
  // "vet7" — cache key versioned; bump when the result shape/values change.
  const key = `vet7/${region}/${slugifyRealm(realm)}/${name.toLowerCase()}`;
  const cached = cacheGet(key, CONFIG.LOOKUP_TTL_SECONDS);
  if (cached) return cached;

  const zones = await getRaidZones();
  const query = buildCharacterQuery(zones.map((z) => z.id));
  const data = await postGraphQL(query, {
    name, serverSlug: slugifyRealm(realm), serverRegion: region,
  });

  const char = data.characterData?.character;
  if (!char) {
    const result = { found: false, name, realm, region, ...characterLinks(region, realm, name) };
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

  // Phase 1: everything except gear — render immediately.
  const partial = {
    found: true,
    name: char.name ?? name,
    realm,
    region,
    ...characterLinks(region, realm, char.name ?? name),
    class: className,
    classColor: CLASS_COLORS[className] ?? "#e8e9ee",
    classID: char.classID ?? null,
    spec: primarySpec(zrList),
    specs: [],
    role: null,
    raids,
    gearSets: [],
    gearError: null,
    gearPending: true,
    enchants: null,
    gearscore: null,
    last_log: lastLog,
  };
  onScorecard?.(partial);

  // Phase 2: gear sets (the slow part — concurrent report scans).
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
    ...partial,
    gearPending: false,
    spec: specs[0] ?? partial.spec,
    specs,
    role: primary?.role ?? null,
    gearSets,
    gearError, // non-null when gear couldn't be fetched (vs genuinely absent)
    enchants: primary?.enchants ?? null, // primary set, for the roster card
    gearscore: maxGs,
  };
  cacheSet(key, result);
  return result;
}
