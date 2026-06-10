// Resolve which WCL zone IDs to vet against: the live (non-frozen) raids of
// the current Anniversary expansion. Cached in localStorage for a day.
import { CONFIG } from "./config.js";
import { WCLError, cacheGet, cacheSet, postGraphQL } from "./wcl.js";

const EXPANSIONS_QUERY = `
query {
  worldData {
    expansions {
      id
      name
      zones { id name frozen }
    }
  }
}`;

const excluded = (name) =>
  CONFIG.EXCLUDE_ZONE_PATTERNS.some((p) => (name ?? "").toLowerCase().includes(p.toLowerCase()));

export async function getRaidZones() {
  // Config values are part of the key so edits to js/config.js take effect
  // immediately instead of being masked by a day-old cache entry.
  const cacheKey = `wcl_raid_zones/${CONFIG.CURRENT_EXPANSION_ID}/${CONFIG.RAID_ZONE_IDS.join(",")}`;
  const cached = cacheGet(cacheKey, CONFIG.ZONES_TTL_SECONDS);
  if (cached) return cached;

  const data = await postGraphQL(EXPANSIONS_QUERY);
  const exps = data.worldData?.expansions ?? [];
  const raids = [];

  if (CONFIG.RAID_ZONE_IDS.length) {
    const byId = new Map();
    for (const e of exps) for (const z of e.zones ?? []) byId.set(z.id, z);
    for (const zid of CONFIG.RAID_ZONE_IDS) {
      const z = byId.get(zid);
      if (z) raids.push({ id: zid, name: z.name });
    }
    if (!raids.length) {
      throw new WCLError(
        `None of RAID_ZONE_IDS [${CONFIG.RAID_ZONE_IDS}] matched a Warcraft Logs zone — ` +
        "fix RAID_ZONE_IDS in js/config.js.");
    }
  } else {
    const target = exps.find((e) => e.id === CONFIG.CURRENT_EXPANSION_ID);
    if (!target) {
      const known = exps.map((e) => `${e.id} (${e.name})`).join(", ") || "none returned";
      throw new WCLError(
        `CURRENT_EXPANSION_ID=${CONFIG.CURRENT_EXPANSION_ID} doesn't match any Warcraft Logs ` +
        `expansion (known: ${known}). The Anniversary realms may have advanced — update ` +
        "CURRENT_EXPANSION_ID in js/config.js.");
    }
    for (const z of target.zones ?? []) {
      if (z.frozen || excluded(z.name)) continue;
      raids.push({ id: z.id, name: z.name });
    }
    raids.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    if (!raids.length) {
      throw new WCLError(
        `Expansion '${target.name}' (id ${CONFIG.CURRENT_EXPANSION_ID}) has no live raid zones ` +
        "right now — check CURRENT_EXPANSION_ID / EXCLUDE_ZONE_PATTERNS in js/config.js.");
    }
  }

  cacheSet(cacheKey, raids);
  return raids;
}
