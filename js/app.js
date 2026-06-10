"use strict";
import { CONFIG } from "./config.js";
import { QUALITY_COLORS } from "./analyze.js";
import { getAttendanceMap } from "./attendance.js";
import { ROLE_ICONS } from "./wcl-classes.js";
import { vet } from "./vet.js";
import { WCLError } from "./wcl.js";

const form = document.getElementById("vet-form");
const statusEl = document.getElementById("status");
const feedEl = document.getElementById("feed");
const btn = form.querySelector("button");

const ICON_BASE = "https://assets.rpglogs.com/img/warcraft/abilities/";
const WOWHEAD = "https://www.wowhead.com/tbc/item=";
const FEED_CAP = 12;
const GROUPS = ["g1", "g2", "g3", "g4", "g5"];
const GROUP_SIZE = 5;

document.getElementById("realm-label").textContent =
  CONFIG.REALM ? `${CONFIG.REALM} (${CONFIG.REGION})` : "no realm configured — edit js/config.js";

// ===========================================================================
// Search & result-card feed (newest card on top, older ones pushed down)
// ===========================================================================

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("name").value.trim();
  if (name) lookup(name);
});

let lookupInFlight = false;

async function lookup(name) {
  // The disabled button doesn't stop Enter-key submits; this does. Each
  // duplicate lookup would burn shared WCL rate-limit points for nothing.
  if (lookupInFlight) return;
  lookupInFlight = true;
  setStatus(`Looking up ${name}…`);
  btn.disabled = true;
  try {
    const data = await vet(name);
    setStatus("");
    addCard(data);
  } catch (err) {
    setStatus(err instanceof WCLError ? err.message : `Request failed: ${err}`, true);
  } finally {
    lookupInFlight = false;
    btn.disabled = false;
  }
}

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", !!isError);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function addCard(data) {
  // Re-searching someone removes their old card so the fresh one sits on top.
  const key = data.name.toLowerCase();
  feedEl.querySelector(`[data-card="${CSS.escape(key)}"]`)?.remove();

  const card = document.createElement("div");
  card.className = "card flash";
  card.dataset.card = key;
  card.innerHTML = data.found ? renderResult(data) : renderNoData(data);

  if (data.found) {
    card.querySelector(".add-roster")?.addEventListener("click", () => {
      addToRoster(data);
    });
    fillGuildLine(card, data.name);
  }
  feedEl.prepend(card);
  while (feedEl.children.length > FEED_CAP) feedEl.lastChild.remove();
}

// Fills the "raided with our guild N times" line on a card, asynchronously so
// the card itself never waits on the attendance fetch.
async function fillGuildLine(card, charName) {
  const line = card.querySelector(".guild-line");
  if (!line) return;
  try {
    const map = await getAttendanceMap();
    if (!map) { line.remove(); return; }
    const entry = map.players[charName.toLowerCase()];
    if (entry) {
      const last = entry.lastTs ? new Date(entry.lastTs).toLocaleDateString() : "?";
      line.innerHTML = `🤝 Raided with <b>${esc(map.guildName)}</b> ${entry.count}× · last ${last}`;
      line.classList.add("known");
    } else {
      line.textContent = `No shared raids with ${map.guildName} in the last ${map.reportsScanned} logs.`;
    }
  } catch {
    line.remove(); // attendance is a bonus; never break the card over it
  }
}

function renderNoData(data) {
  return `<div class="no-data" style="border:none;padding:0">
    <b>No logs found</b> for <b>${esc(data.name)}</b> on ${esc(data.realm)} (${esc(data.region)}).<br>
    They may simply have never been logged on Warcraft Logs &mdash; this is not proof they haven't raided.
    Check the spelling of the name.
  </div>`;
}

function renderResult(data) {
  const raids = data.raids || [];
  const totalCleared = raids.reduce((n, r) => n + (r.cleared > 0 ? 1 : 0), 0);
  const lastLog = data.last_log ? new Date(data.last_log).toLocaleDateString() : "—";

  const specTxt = [data.spec, data.class].filter(Boolean).join(" ") || "class unknown";
  const roleIcon = data.role ? ROLE_ICONS[data.role] + " " : "";

  const raidRows = raids.map((r) => {
    const did = r.cleared > 0;
    const parseTxt = r.best_parse == null ? "–" : Math.round(r.best_parse);
    const parseCls = r.best_parse == null ? "parse none" : "parse";
    const parseStyle = r.best_parse == null ? "" : `style="color:${r.color}"`;
    return `<div class="raid-row">
      <span class="rname ${did ? "cleared-yes" : "cleared-no"}">${did ? "✔" : "✗"} ${esc(r.name)}</span>
      <span class="clears">${r.cleared}/${r.total} bosses</span>
      <span class="${parseCls}" ${parseStyle}>${parseTxt}</span>
    </div>`;
  }).join("");

  return `
    <div class="card-top">
      <h2 style="color:${data.classColor}">${esc(data.name)}</h2>
      <span class="spec-badge">${roleIcon}${esc(specTxt)}</span>
      <button class="add-roster" type="button">＋ Add to roster</button>
    </div>
    <div class="meta">${esc(data.realm)} · ${esc(data.region)} &nbsp;·&nbsp; last logged raid: ${lastLog}
      &nbsp;·&nbsp; raids with a kill: ${totalCleared}/${raids.length}</div>
    ${CONFIG.GUILD_NAME ? '<div class="meta guild-line">checking guild raid history…</div>' : ""}

    <div class="section-title">Raid clears &amp; best perf. average</div>
    ${raidRows || '<div class="meta">No raid ranking data.</div>'}

    <div class="section-title">Enchants &amp; gems (from last logged gear)</div>
    ${renderEnchantSummary(data.enchants)}
    ${renderGear(data.gear)}`;
}

function renderEnchantSummary(en) {
  if (!en) return `<div class="meta">No gear data available from logs.</div>`;
  const missing = en.missing_required || 0;
  const ilvl = en.avg_item_level == null ? "—" : en.avg_item_level;

  const enchTxt = missing === 0
    ? `<b class="ok">✔ Fully enchanted</b>`
    : `<b class="warn">⚠ ${missing} missing enchant${missing > 1 ? "s" : ""}</b>`;

  const empty = en.empty_sockets || 0;
  const gemTxt = empty === 0
    ? `<span class="gem-total">💎 ${en.gems_total}/${en.sockets_total} sockets filled</span>`
    : `<span class="warn">💎 ${en.gems_total}/${en.sockets_total} sockets — ${empty} empty</span>`;

  const chips = (en.slots || []).map((s) => {
    let cls = "chip", icon = "·", text = `${s.slot}: empty`;
    if (s.status === "enchanted") { cls += " ok"; icon = "✔"; text = `${s.slot}: ${esc(s.enchant)}`; }
    else if (s.status === "missing") { cls += " missing"; icon = "✗"; text = `${s.slot}: none`; }
    else cls += " empty";
    return `<span class="${cls}">${icon} ${text}</span>`;
  }).join("");

  return `<div class="summary-line">${enchTxt} &nbsp;·&nbsp; ${gemTxt} &nbsp;·&nbsp; avg ilvl ${ilvl}</div>
    <div class="enchants">${chips}</div>`;
}

function renderGear(gear) {
  if (!gear?.length) return "";
  const rows = gear.map((g) => {
    const icon = g.icon
      ? `<img class="gicon" src="${ICON_BASE}${esc(g.icon)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
      : `<span class="gicon"></span>`;
    const color = QUALITY_COLORS[g.quality] ?? "#fff";
    const ench = g.enchant
      ? `<span class="gench" title="${esc(g.enchant)}">${esc(g.enchant)}</span>`
      : (g.enchantable ? `<span class="gench missing">no enchant</span>` : "<span></span>");
    const gems = g.gems.map((gem) => {
      const img = gem.icon
        ? `<img src="${ICON_BASE}${esc(gem.icon)}" alt="gem" loading="lazy" onerror="this.style.visibility='hidden'">`
        : "◆";
      return `<a href="${WOWHEAD}${Number(gem.id)}" target="_blank" rel="noopener" title="gem">${img}</a>`;
    }).join("");
    const emptySock = g.emptySockets
      ? `<span class="gsock-empty" title="${g.emptySockets} empty socket(s)">${"◇".repeat(g.emptySockets)}</span>`
      : "";
    const gemBlock = (gems || emptySock) ? `<span class="ggems">${gems}${emptySock}</span>` : "";
    return `<div class="gear-row">
      ${icon}
      <span class="gslot">${esc(g.slotLabel)}</span>
      <a class="gname" style="color:${color}" href="${WOWHEAD}${Number(g.id)}" target="_blank" rel="noopener">${esc(g.name)}</a>
      <span class="gilvl">${g.itemLevel ?? ""}</span>
      <span class="gextra">${ench}${gemBlock}</span>
    </div>`;
  }).join("");
  return `<details class="gear-details"><summary>Full gear (${gear.length} items)</summary>
    <div class="gear-list">${rows}</div></details>`;
}

// ===========================================================================
// Roster builder (bench + 5 groups of 5, drag & drop, persisted)
// ===========================================================================

const rosterPanel = document.getElementById("roster-panel");
const groupsEl = document.getElementById("groups");
const STORE_KEY = "pvw_roster_v1";

let roster = loadRoster(); // [{id,name,color,spec,role,ilvl,missEnch,emptySock,zone}]

function loadRoster() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? []; }
  catch { return []; }
}
function saveRoster() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(roster)); } catch { /* ignore */ }
}

function addToRoster(data) {
  const id = data.name.toLowerCase();
  if (!roster.some((r) => r.id === id)) {
    roster.push({
      id,
      name: data.name,
      color: data.classColor,
      cls: data.class,
      spec: data.spec,
      role: data.role,
      ilvl: data.enchants?.avg_item_level ?? null,
      missEnch: data.enchants?.missing_required ?? 0,
      emptySock: data.enchants?.empty_sockets ?? 0,
      zone: "bench",
    });
    saveRoster();
  }
  renderRoster();
  // Draw the eye to where the card landed (or already was).
  const el = rosterPanel.querySelector(`[data-id="${CSS.escape(id)}"]`);
  el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  el?.animate([{ outline: "2px solid var(--accent)" }, { outline: "none" }], 900);
}

function moveEntry(id, zone) {
  const entry = roster.find((r) => r.id === id);
  if (!entry) return;
  if (zone !== "bench" && roster.filter((r) => r.zone === zone).length >= GROUP_SIZE
      && entry.zone !== zone) {
    return; // group full
  }
  entry.zone = zone;
  saveRoster();
  renderRoster();
}

function removeEntry(id) {
  roster = roster.filter((r) => r.id !== id);
  saveRoster();
  renderRoster();
}

function renderRosterCard(r) {
  const role = r.role ? `${ROLE_ICONS[r.role]} ` : "";
  const meta = [r.spec, r.cls].filter(Boolean).join(" ") + (r.ilvl ? ` · ${r.ilvl}` : "");
  const warns = [];
  if (r.missEnch) warns.push(`✗${r.missEnch}`);
  if (r.emptySock) warns.push(`◇${r.emptySock}`);
  return `<div class="rcard" draggable="true" data-id="${esc(r.id)}" style="border-left-color:${r.color}">
    <span class="rname" style="color:${r.color}">${esc(r.name)}</span>
    <span class="rmeta">${role}${esc(meta)}</span>
    ${warns.length ? `<span class="rwarn" title="missing enchants / empty sockets">${warns.join(" ")}</span>` : ""}
    <button class="rx" type="button" title="Remove from roster">×</button>
  </div>`;
}

function renderRoster() {
  // Bench
  const bench = rosterPanel.querySelector('[data-zone="bench"]');
  bench.querySelector(".zone-cards").innerHTML =
    roster.filter((r) => r.zone === "bench").map(renderRosterCard).join("");
  const benchN = roster.filter((r) => r.zone === "bench").length;
  bench.querySelector(".zcount").textContent = benchN ? `(${benchN})` : "";

  // Groups
  groupsEl.innerHTML = GROUPS.map((g, i) => {
    const members = roster.filter((r) => r.zone === g);
    return `<div class="dropzone group ${members.length >= GROUP_SIZE ? "full" : ""}" data-zone="${g}">
      <h3>Group ${i + 1} <span class="zcount">${members.length}/${GROUP_SIZE}</span></h3>
      <div class="zone-cards">${members.map(renderRosterCard).join("")}</div>
    </div>`;
  }).join("");

  // Header summary: total + role tally
  const tally = { tank: 0, healer: 0, dps: 0 };
  for (const r of roster) if (r.role) tally[r.role] += 1;
  document.getElementById("roster-summary").textContent = roster.length
    ? `${roster.length} players · ${ROLE_ICONS.tank}${tally.tank} ${ROLE_ICONS.healer}${tally.healer} ${ROLE_ICONS.dps}${tally.dps}`
    : "empty";
}

// --- drag & drop wiring (delegated, zones are re-rendered constantly) ------
rosterPanel.addEventListener("dragstart", (e) => {
  const card = e.target.closest(".rcard");
  if (!card) return;
  e.dataTransfer.setData("text/plain", card.dataset.id);
  e.dataTransfer.effectAllowed = "move";
  card.classList.add("dragging");
});
rosterPanel.addEventListener("dragend", (e) => {
  e.target.closest(".rcard")?.classList.remove("dragging");
});
rosterPanel.addEventListener("dragover", (e) => {
  const zone = e.target.closest(".dropzone");
  if (!zone) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  zone.classList.add("dragover");
});
rosterPanel.addEventListener("dragleave", (e) => {
  const zone = e.target.closest(".dropzone");
  // dragleave also fires when entering a child of the zone; only clear the
  // highlight when the pointer actually left the zone.
  if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove("dragover");
});
rosterPanel.addEventListener("drop", (e) => {
  const zone = e.target.closest(".dropzone");
  if (!zone) return;
  e.preventDefault();
  zone.classList.remove("dragover");
  const id = e.dataTransfer.getData("text/plain");
  if (id) moveEntry(id, zone.dataset.zone);
});
rosterPanel.addEventListener("click", (e) => {
  if (e.target.classList.contains("rx")) {
    removeEntry(e.target.closest(".rcard").dataset.id);
  }
});
document.getElementById("roster-clear").addEventListener("click", () => {
  if (roster.length && confirm("Empty the whole roster?")) {
    roster = [];
    saveRoster();
    renderRoster();
  }
});

renderRoster();

// ===========================================================================
// Guild regulars: who keeps showing up in our guild's logs
// ===========================================================================

const regularsBtn = document.getElementById("regulars-btn");
if (CONFIG.GUILD_NAME) regularsBtn.hidden = false;

regularsBtn.addEventListener("click", async () => {
  regularsBtn.disabled = true;
  setStatus("Loading guild raid history…");
  try {
    const map = await getAttendanceMap();
    if (!map) {
      setStatus(`Guild "${CONFIG.GUILD_NAME}" not found on Warcraft Logs — check js/config.js.`, true);
      return;
    }
    setStatus("");
    const regulars = Object.values(map.players)
      .filter((p) => p.count >= 2)
      .sort((a, b) => b.count - a.count || b.lastTs - a.lastTs);

    feedEl.querySelector('[data-card="__regulars"]')?.remove();
    const card = document.createElement("div");
    card.className = "card flash";
    card.dataset.card = "__regulars";
    const rows = regulars.map((p) => `
      <div class="regular-row">
        <span class="regular-link" data-name="${esc(p.name)}">${esc(p.name)}</span>
        <span class="rcount">${p.count}× </span>
        <span class="rlast">last ${new Date(p.lastTs).toLocaleDateString()}</span>
      </div>`).join("");
    card.innerHTML = `
      <div class="card-top"><h2>🤝 ${esc(map.guildName)} regulars</h2></div>
      <div class="meta">${regulars.length} players appear 2+ times across the last
        ${map.reportsScanned} guild logs. Click a name to vet them.</div>
      <div class="regulars-list">${rows || '<div class="meta">No repeat raiders found yet.</div>'}</div>`;
    feedEl.prepend(card);
  } catch (err) {
    setStatus(err instanceof WCLError ? err.message : `Request failed: ${err}`, true);
  } finally {
    regularsBtn.disabled = false;
  }
});

// Click a name in the regulars list -> vet them.
feedEl.addEventListener("click", (e) => {
  const link = e.target.closest(".regular-link");
  if (!link) return;
  document.getElementById("name").value = link.dataset.name;
  lookup(link.dataset.name);
});

// Tiny debug hook (used by automated verification; harmless in production).
window._pvw = { moveEntry, addToRoster };
