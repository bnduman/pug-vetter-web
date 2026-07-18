"use strict";
// 🛡️ Officer tab — guild attendance roster + per-report raid-prep report card
// (consumable uptimes, enchant gaps, specs). Vanilla DOM in the same style as
// autopsy.js. Data is lazy: nothing is fetched until the tab is first opened.
import { CONFIG } from "./config.js";
import { WCLError } from "./wcl.js";
import { getAttendanceMap, resolveMain } from "./attendance.js";
import {
  buildRoster, fetchOfficerCard, listGuildReports, reportCardToDiscord,
} from "./officer-data.js";
import { CLASS_COLORS, ROLE_ICONS } from "./wcl-classes.js";

const root = document.getElementById("officer");

let reports = null;   // guild report picker entries
let roster = null;    // buildRoster() output
let card = null;      // current report card
let pickedCode = null; // dropdown choice — survives re-renders before "Load"
let showEveryone = false;
const MIN_RAIDS = 3;  // roster filter: hide one-off pugs by default

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function msg(e) {
  return e instanceof WCLError ? e.message : `Request failed: ${e}`;
}

const dateOf = (ts) => new Date(ts).toISOString().slice(0, 10);

// "flasked on N of M attended pulls" cell; green when perfect, red at <= half.
function ratioCell(perFight, key) {
  if (!perFight || !perFight.attended) {
    return '<td class="dim mono" title="No combat data logged for this player">–</td>';
  }
  const n = perFight[key];
  const m = perFight.attended;
  const cls = n === m ? "ok" : n <= m / 2 ? "warn" : "";
  return `<td class="mono ${cls}">${n}/${m}</td>`;
}

// --- screens ---------------------------------------------------------------

function loading(text) {
  root.innerHTML = `<div class="csi-loading" role="status" aria-live="polite">🛡️ ${esc(text)}</div>`;
}

function view(error) {
  if (!CONFIG.GUILD_NAME) {
    root.innerHTML = `<div class="csi-home"><h2>Officer tools</h2>
      <p class="sub">Set <code>GUILD_NAME</code> in js/config.js to enable the officer view.</p></div>`;
    return;
  }
  const selectedCode = pickedCode ?? card?.code;
  const options = (reports ?? []).map((r) =>
    `<option value="${esc(r.code)}"${selectedCode === r.code ? " selected" : ""}>${esc(r.title)} · ${dateOf(r.ts)}</option>`).join("");

  root.innerHTML = `
    <div class="csi-report">
      <h2>🛡️ ${esc(CONFIG.GUILD_NAME)} — officer view</h2>
      <p class="sub">${esc(CONFIG.GUILD_REALM)} (${esc(CONFIG.GUILD_REGION)}) · raid-prep report card &amp; attendance</p>
      ${error ? `<p class="csi-error">${esc(error)}</p>` : ""}

      <div class="csi-row">
        <select id="off-report" aria-label="Guild report">${options}</select>
        <button id="off-load" type="button">Load report card</button>
      </div>
      <div id="off-card">${card ? cardHtml(card) : '<p class="sub">Pick a raid night and load its report card.</p>'}</div>

      <h3 class="off-h3">Attendance <span class="dim">— last ${roster?.totalReports ?? 0} guild reports</span></h3>
      <label class="off-toggle"><input type="checkbox" id="off-all" ${showEveryone ? "checked" : ""} />
        show everyone (incl. one-off pugs)</label>
      ${rosterHtml()}
    </div>`;
}

function cardHtml(c) {
  if (!c.fights.length) {
    return `<p class="sub">「${esc(c.title)}」 has no boss pulls — nothing to grade.
      Trash-only and non-raid logs can't produce a report card.</p>`;
  }
  const kills = c.fights.filter((f) => f.kill).length;
  const cov = c.coverage;
  const chip = (label, val) =>
    `<div class="csi-stat"><div class="csi-stat-label">${label}</div><div class="csi-stat-val mono">${val}</div></div>`;

  const rows = c.players.map((p) => {
    const color = CLASS_COLORS[p.class] ?? "var(--text)";
    const main = resolveMain(p.name);
    const altTag = main !== p.name ? ` <span class="dim">(${esc(main)}'s alt)</span>` : "";
    const spec = p.talents ? `${p.talents.spec ?? "?"} ${p.talents.distribution}` : "?";
    const ench = p.hasGear
      ? (p.missingCount === 0 ? '<span class="ok">✓</span>' : `<span class="warn">${p.missingCount} missing</span>`)
      : '<span class="dim" title="No gear data logged for this player">no data</span>';
    return `<tr>
      <td><span style="color:${color}">${esc(p.name)}</span> ${ROLE_ICONS[p.role] ?? ""}${altTag}</td>
      <td class="dim">${esc(spec)}</td>
      <td class="mono dim">${p.perFight ? p.perFight.attended : "?"}/${c.fights.length}</td>
      ${ratioCell(p.perFight, "flaskFights")}
      ${ratioCell(p.perFight, "foodFights")}
      <td>${ench}</td>
    </tr>`;
  }).join("");

  return `
    <div class="csi-stats">
      ${chip("Raiders", c.raidSize)}
      ${chip("Kills", `${kills}/${c.fights.length} pulls`)}
      ${chip("Always flasked", `${cov.alwaysFlasked}/${cov.tracked}`)}
      ${chip("Always fed", `${cov.alwaysFed}/${cov.tracked}`)}
      ${chip("Fully enchanted", `${cov.enchanted}/${cov.gearCovered}`)}
    </div>
    <button id="off-copy" class="secondary" type="button">Copy for Discord</button>
    <table class="csi-table">
      <thead><tr><th>Player</th><th>Spec</th><th>Fights</th><th>Flask/elixirs</th><th>Food</th><th>Enchants</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="csi-hint">Flask/elixirs = pulls entered with a flask or a battle+guardian elixir pair,
      out of the boss pulls each player attended (read from per-pull combat snapshots).
      Kills and wipes both count — pre-pull prep is the point.</p>`;
}

function rosterHtml() {
  if (!roster) return '<p class="sub">Attendance not loaded.</p>';
  const rows = roster.rows.filter((r) => showEveryone || r.count >= MIN_RAIDS);
  const body = rows.map((r) => `
    <tr>
      <td>${esc(r.name)}${r.alts?.length ? ` <span class="dim" title="Counted together (js/config.js ALTS)">+ ${esc(r.alts.join(", "))}</span>` : ""}${r.fading ? ' <span class="warn" title="Regular who missed the last 3 raids">⚠ fading</span>' : ""}</td>
      <td class="mono">${r.count}/${roster.totalReports}</td>
      <td class="mono ${r.pct >= 66 ? "ok" : ""}">${r.pct}%</td>
      <td class="mono">${r.streak || "–"}</td>
      <td class="dim mono">${dateOf(r.lastTs)}</td>
    </tr>`).join("");
  return `
    <table class="csi-table">
      <thead><tr><th>Player</th><th>Raids</th><th>%</th><th>Streak</th><th>Last raid</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    <p class="csi-hint">${rows.length} of ${roster.rows.length} logged players shown.
      Streak = consecutive most-recent guild reports attended.</p>`;
}

// --- data ------------------------------------------------------------------

let initStarted = false;

async function init() {
  if (initStarted) return;
  initStarted = true;
  loading("Loading guild data…");
  try {
    const [reportList, attMap] = await Promise.all([listGuildReports(20), getAttendanceMap()]);
    reports = reportList ?? [];
    roster = attMap ? buildRoster(attMap, { limit: CONFIG.OFFICER_ROSTER_REPORTS }) : null;
    view(attMap ? undefined : `Guild "${CONFIG.GUILD_NAME}" was not found on Warcraft Logs.`);
  } catch (e) {
    initStarted = false; // allow retry on next tab open
    root.innerHTML = `<div class="csi-home"><p class="csi-error">${esc(msg(e))}</p>
      <p class="csi-or"><button id="off-retry" class="linklike" type="button">try again</button></p></div>`;
  }
}

async function loadCard(code) {
  if (!code) return;
  loading("Loading report card…");
  try {
    card = await fetchOfficerCard(code, (text) => loading(text));
    view();
  } catch (e) {
    card = null;
    view(msg(e));
  }
}

async function copyCard(btn) {
  if (!card) return;
  try {
    await navigator.clipboard.writeText(reportCardToDiscord(card));
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = "Copy for Discord"), 2000);
  } catch {
    btn.textContent = "Copy failed";
  }
}

// --- event delegation (root is re-rendered constantly) ---------------------

root.addEventListener("click", (e) => {
  if (e.target.closest("#off-load")) {
    loadCard(document.getElementById("off-report")?.value);
  } else if (e.target.closest("#off-copy")) {
    copyCard(e.target.closest("#off-copy"));
  } else if (e.target.closest("#off-retry")) {
    init();
  }
});

root.addEventListener("change", (e) => {
  if (e.target.id === "off-all") {
    showEveryone = e.target.checked;
    view();
  } else if (e.target.id === "off-report") {
    pickedCode = e.target.value; // keep the choice across re-renders
  }
});

// Lazy: load guild data the first time the tab is opened (click OR keyboard —
// the tablist's arrow-key handler activates tabs via .click()).
document.getElementById("tab-officer")?.addEventListener("click", init);
