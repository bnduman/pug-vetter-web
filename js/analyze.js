// Pure functions that turn raw Warcraft Logs JSON into a vetting scorecard.
// Ported from the Python version (pug-vetter), extended with socket math,
// spec detection and the full gear list.
import { ENCHANT_NAMES } from "./enchant-names.js";
import { ENCHANT_SLOTS, NON_ILVL_SLOTS } from "./enchant-rules.js";
import { ITEM_SOCKETS } from "./item-sockets.js";
import { SPEC_ROLE } from "./wcl-classes.js";

export const SLOT_LABELS = [
  "Head", "Neck", "Shoulder", "Shirt", "Chest", "Belt", "Legs", "Feet",
  "Wrist", "Hands", "Ring", "Ring", "Trinket", "Trinket", "Back",
  "Main Hand", "Off Hand", "Ranged", "Tabard",
];

export const QUALITY_COLORS = {
  0: "#9d9d9d", 1: "#ffffff", 2: "#1eff00", 3: "#0070dd", 4: "#a335ee", 5: "#ff8000",
};

export function parseColor(pct) {
  if (pct == null) return { tier: "none", color: "#6b6b6b" };
  const p = Math.round(pct);
  if (p >= 100) return { tier: "artifact", color: "#e5cc80" };
  if (p >= 99) return { tier: "astounding", color: "#e268a8" };
  if (p >= 95) return { tier: "legendary", color: "#ff8000" };
  if (p >= 75) return { tier: "epic", color: "#a335ee" };
  if (p >= 50) return { tier: "rare", color: "#0070ff" };
  if (p >= 25) return { tier: "uncommon", color: "#1eff00" };
  return { tier: "common", color: "#9d9d9d" };
}

// Reduce a zoneRankings blob to {name, cleared, total, best_parse, encounters}.
// Tolerates the {"error": "..."} blob WCL returns for an unsupported zone.
export function summarizeZone(zoneName, zoneRankings) {
  const base = { name: zoneName, cleared: 0, total: 0, best_parse: null, encounters: [] };
  if (!zoneRankings || typeof zoneRankings !== "object" || !("rankings" in zoneRankings)) {
    return base;
  }
  const encounters = [];
  const parses = [];
  let cleared = 0;
  for (const r of zoneRankings.rankings ?? []) {
    if (!r || typeof r !== "object") continue;
    const kills = r.totalKills ?? 0;
    let rp = r.rankPercent;
    if (typeof rp !== "number") rp = null; // WCL uses "-" for unranked
    if (kills > 0) cleared += 1;
    if (rp != null) parses.push(rp);
    encounters.push({ name: r.encounter?.name ?? "?", kills, parse: rp });
  }
  let best = zoneRankings.bestPerformanceAverage;
  if (typeof best !== "number") best = parses.length ? Math.max(...parses) : null;
  return { ...base, cleared, total: encounters.length, best_parse: best, encounters };
}

// Spec tally across a character's boss rankings (each entry carries the spec it
// was earned with). -> Map<spec, count>, most-played first when iterated by count.
function specTally(zoneRankingsList) {
  const tally = new Map();
  for (const zr of zoneRankingsList) {
    if (!zr || typeof zr !== "object") continue;
    for (const r of zr.rankings ?? []) {
      const spec = r?.spec;
      if (spec) tally.set(spec, (tally.get(spec) ?? 0) + 1);
    }
  }
  return tally;
}

// The spec a player plays most (or null).
export function primarySpec(zoneRankingsList) {
  let best = null;
  let bestN = 0;
  for (const [spec, n] of specTally(zoneRankingsList)) if (n > bestN) { best = spec; bestN = n; }
  return best;
}

// The distinct ROLES a character has ranked parses in (tank/healer/dps), mapped
// from real spec names. Used (for free, from data we already fetch) to decide
// whether to scan for a second-role gear set. Unknown/set-name specs ignored.
export function distinctRoles(zoneRankingsList) {
  const roles = new Set();
  for (const spec of specTally(zoneRankingsList).keys()) {
    const role = SPEC_ROLE[spec];
    if (role) roles.add(role);
  }
  return roles;
}

// Locate a character inside a playerDetails blob -> {gear, role, spec} or null.
// WCL wraps the payload as {"data": {"playerDetails": {tanks, healers, dps}}}.
// `spec` is the spec they played most in this report.
export function findPlayer(playerDetails, charName) {
  let pd = playerDetails;
  if (pd && typeof pd === "object" && pd.data && typeof pd.data === "object") {
    pd = pd.data.playerDetails ?? pd;
  }
  if (!pd || typeof pd !== "object" || Array.isArray(pd)) return null;
  const target = (charName ?? "").toLowerCase();
  const roles = { tanks: "tank", healers: "healer", dps: "dps" };
  for (const [bucket, role] of Object.entries(roles)) {
    for (const player of pd[bucket] ?? []) {
      if ((player.name ?? "").toLowerCase() === target) {
        const specs = [...(player.specs ?? [])].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
        return { gear: player.combatantInfo?.gear ?? [], role, spec: specs[0]?.spec ?? null };
      }
    }
  }
  return null;
}

// Collapse the gear array to one item per slot. It can contain several fights'
// worth of gear, so per slot we keep the item equipped in the MOST fights
// (mode) rather than the highest item level: averaging best-ilvl-per-slot
// across fights can fabricate a set the player never actually wore together,
// inflating GearScore (e.g. a one-off weapon/trinket swap). Ties break toward
// higher item level.
// Enchants and gems are only ever ADDED during a raid night (they can be
// replaced, never removed), so when the same item shows different states
// across fights, the fullest snapshot is the truest.
const snapshotScore = (item) =>
  (item.permanentEnchant ? 10 : 0) + (item.gems?.length ?? 0);

function gearBySlot(gear) {
  const perSlot = new Map(); // slot -> Map(itemId -> { item, count })
  for (const item of gear ?? []) {
    if (!item || typeof item !== "object" || item.slot == null) continue;
    const counts = perSlot.get(item.slot) ?? new Map();
    const k = String(item.id ?? 0);
    const entry = counts.get(k) ?? { item, count: 0 };
    entry.count += 1;
    if (snapshotScore(item) > snapshotScore(entry.item)) entry.item = item;
    counts.set(k, entry);
    perSlot.set(item.slot, counts);
  }
  const best = new Map();
  for (const [slot, counts] of perSlot) {
    let pick = null;
    for (const e of counts.values()) {
      const better = !pick || e.count > pick.count ||
        (e.count === pick.count && (e.item.itemLevel ?? 0) > (pick.item.itemLevel ?? 0));
      if (better) pick = e;
    }
    if (pick) best.set(slot, pick.item);
  }
  return best;
}

const socketsOf = (item) => (item?.id ? ITEM_SOCKETS[item.id] ?? 0 : 0);
const gemsOf = (item) => (item?.gems?.length ?? 0);
// WCL never reports more gems than sockets, but clamp just in case.
const emptySocketsOf = (item) => Math.max(0, socketsOf(item) - gemsOf(item));

const enchantNameOf = (item) =>
  ENCHANT_NAMES[item.permanentEnchant] ?? item.permanentEnchantName ?? `#${item.permanentEnchant}`;

/** @param className  the player's class, for rules that only apply to some
 *  (a hunter's scopeable ranged weapon vs a caster's wand). Omitted/unknown
 *  class skips those rules entirely rather than guessing. */
export function analyzeEnchants(gear, className) {
  const bySlot = gearBySlot(gear);
  const slots = [];
  let missingRequired = 0;
  for (const rule of ENCHANT_SLOTS) {
    // A class-scoped slot isn't "missing" for everyone else — it's not a slot
    // they have. Leave it out of the list entirely so nothing renders for them.
    if (rule.classes && !rule.classes.includes(className)) continue;
    const item = bySlot.get(rule.slot);
    const gems = gemsOf(item);
    if (!item || !item.id) {
      slots.push({ slot: rule.label, slotId: rule.slot, status: "empty", enchant: null, gems, required: rule.required });
      continue;
    }
    if (item.permanentEnchant) {
      slots.push({ slot: rule.label, slotId: rule.slot, status: "enchanted", enchant: enchantNameOf(item), gems, required: rule.required });
    } else {
      slots.push({ slot: rule.label, slotId: rule.slot, status: "missing", enchant: null, gems, required: rule.required });
      if (rule.required) missingRequired += 1;
    }
  }

  const ilvls = [];
  let gemsTotal = 0;
  let socketsTotal = 0;
  for (const [slot, item] of bySlot) {
    gemsTotal += gemsOf(item);
    socketsTotal += socketsOf(item);
    if (NON_ILVL_SLOTS.has(slot) || !item.id) continue;
    if (item.itemLevel && item.itemLevel > 1) ilvls.push(item.itemLevel);
  }
  const avgIlvl = ilvls.length
    ? Math.round((ilvls.reduce((a, b) => a + b, 0) / ilvls.length) * 10) / 10
    : null;

  return {
    slots,
    missing_required: missingRequired,
    avg_item_level: avgIlvl,
    gems_total: gemsTotal,
    sockets_total: socketsTotal,
    empty_sockets: Math.max(0, socketsTotal - gemsTotal),
  };
}

// The full equipment list for the detailed gear view: one entry per worn slot,
// in equipment-slot order, with quality/enchant/gem/socket details.
export function buildGearList(gear) {
  const bySlot = gearBySlot(gear);
  const out = [];
  for (const [slot, item] of [...bySlot.entries()].sort((a, b) => a[0] - b[0])) {
    if (!item.id) continue; // empty slot
    out.push({
      slot,
      slotLabel: SLOT_LABELS[slot] ?? `Slot ${slot}`,
      id: item.id,
      name: item.name ?? `Item ${item.id}`,
      icon: item.icon ?? null,
      quality: item.quality ?? 1,
      itemLevel: item.itemLevel ?? null,
      enchant: item.permanentEnchant ? enchantNameOf(item) : null,
      enchantId: item.permanentEnchant || null,
      enchantable: ENCHANT_SLOTS.some((r) => r.slot === slot),
      gems: (item.gems ?? []).map((g) => ({ id: g.id, icon: g.icon ?? null })),
      sockets: socketsOf(item),
      emptySockets: emptySocketsOf(item),
    });
  }
  return out;
}
