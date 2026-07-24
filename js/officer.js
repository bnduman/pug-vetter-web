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
import { fetchDeepStats } from "./officer-stats.js";
import { CLASS_COLORS, ROLE_ICONS } from "./wcl-classes.js";

const root = document.getElementById("officer");

let reports = null;   // guild report picker entries
let roster = null;    // buildRoster() output
let card = null;      // current report card
let pickedCode = null; // dropdown choice — survives re-renders before "Load"
let showEveryone = false;
let deep = null;      // opt-in deep stats for the loaded card (see officer-stats.js)
// Report code of the scan currently in flight, or null. A code (not a bool)
// because the scan takes ~10s: the officer can load a different report while
// it runs, and the result must only ever land on the report it scanned.
let deepScanCode = null;
const MIN_RAIDS = 3;  // roster filter: hide one-off pugs by default

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function msg(e) {
  return e instanceof WCLError ? e.message : `Request failed: ${e}`;
}

const dateOf = (ts) => new Date(ts).toISOString().slice(0, 10);

// "N of M attended pulls" cell; green when perfect, amber at <= half.
function ratioCell(perFight, key) {
  if (!perFight || !perFight.attended) {
    return '<td class="dim mono" title="No combat data logged for this player">–</td>';
  }
  const n = perFight[key];
  const m = perFight.attended;
  const cls = n === m ? "ok" : n <= m / 2 ? "warn" : "";
  return `<td class="mono ${cls}">${n}/${m}</td>`;
}

// Shorten a flask/elixir name for the inline label: any flask -> "flask",
// "Elixir of Draenic Wisdom" -> "Draenic Wisdom", "Spellpower Elixir" -> "Spellpower".
function shortCons(name) {
  if (/flask of/i.test(name)) return "flask";
  return name.replace(/^Elixir of /i, "").replace(/ Elixir$/i, "");
}

// Consumables cell: counts pulls with ANY flask/elixir (what people mean by
// "using consumables"), colored by prep tier, with the actual names shown so a
// lone-elixir raider reads as "0 flasks but running Draenic Wisdom", not blank.
//   green  - flask-equivalent every pull      amber - some flask/elixir, not always full
//   red    - no flask/elixir on some pulls
function consCell(pf) {
  if (!pf || !pf.attended) {
    return '<td class="dim mono" title="No combat data logged for this player">–</td>';
  }
  const { flaskFights: n, elixirFights: e, attended: m, consumables = [] } = pf;
  const cls = n === m ? "ok" : e > 0 ? "warn" : "bad";
  const labels = [...new Set(consumables.map(shortCons))];
  const label = labels.join(", ") || "nothing";
  const title = consumables.length
    ? `flask-equivalent on ${n}/${m} pulls · ran: ${consumables.join(", ")}`
    : "no flask or elixir on any pull";
  return `<td class="mono ${cls}" title="${esc(title)}">${e}/${m}<span class="off-cons">${esc(label)}</span></td>`;
}

const num = (n) => (n ?? 0).toLocaleString();

// Deaths cell: boss pulls vs trash. Trash deaths are called out separately —
// dying to trash is a different conversation from dying to a boss mechanic.
function deathCell(p) {
  const d = p.deaths;
  // null = the deaths query failed. Say so rather than showing a confident 0.
  if (!d) return '<td class="mono dim" title="Death data could not be loaded for this report">no data</td>';
  if (!d.total) return '<td class="mono dim">–</td>';
  const trash = d.trash ? `<span class="off-cons">${d.trash} on trash</span>` : "";
  const cls = d.total >= 5 ? "warn" : "";
  return `<td class="mono ${cls}" title="${d.boss} on boss pulls, ${d.trash} on trash">${d.total}${trash}</td>`;
}

// Avoidable damage cell (deep stats only): total avoidable damage taken and
// what share of all damage they took it was, with the worst abilities named.
function avoidCell(p) {
  if (!deep) return "";
  const a = deep.avoidable.get(p.id);
  if (!a || !a.taken) return '<td class="mono dim">–</td>';
  const pct = a.taken ? Math.round((a.avoidable / a.taken) * 100) : 0;
  if (!a.avoidable) return '<td class="mono ok">0</td>';
  const worst = [...a.abilities.entries()].sort((x, y) => y[1].total - x[1].total);
  const label = worst.slice(0, 2).map(([n]) => n).join(", ");
  const cls = pct >= 40 ? "bad" : pct >= 15 ? "warn" : "";
  const title = worst.map(([n, v]) => `${n}: ${num(v.total)}`).join("\n");
  return `<td class="mono ${cls}" title="${esc(title)}">${num(a.avoidable)} <span class="dim">(${pct}%)</span>`
    + `<span class="off-cons">${esc(label)}</span></td>`;
}

function interruptCell(p) {
  if (!deep) return "";
  const i = deep.interrupts.get(p.id);
  if (!i || !i.count) return '<td class="mono dim">–</td>';
  const title = [...i.spells.entries()].map(([s, n]) => `${s} ×${n}`).join("\n");
  return `<td class="mono ok" title="${esc(title)}">${i.count}</td>`;
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

// The deep scan costs ~2 queries per boss pull against a rate limit shared by
// every visitor, so it's never automatic — the officer asks for it, and the
// button says up front what it will cost.
function deepButton(c) {
  const pulls = c.fights.length;
  if (deepScanCode === c.code) {
    return '<button id="off-deep-progress" class="secondary" type="button" disabled>Analysing…</button>';
  }
  if (deep && deep.failed) {
    // A degraded scan isn't cached, so re-running really does re-query.
    return `<button id="off-deep" class="secondary" type="button"
      title="${deep.failed} pull(s) failed — their damage and interrupts are missing from these totals">
      Re-analyse (${deep.failed} pull(s) failed)</button>`;
  }
  if (deep) {
    return `<span class="off-deep-done">✓ Deep stats: ${deep.fightsScanned} pulls scanned</span>`;
  }
  return `<button id="off-deep" class="secondary" type="button"
    title="Fetches avoidable damage and interrupts for each boss pull (~${pulls * 2} queries on the shared Warcraft Logs key)">
    Analyse night (${pulls} pulls)</button>`;
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
      ? (p.missingCount === 0
          ? '<span class="ok">✓</span>'
          : `<span class="warn" title="${esc((p.missingEnchants ?? []).map((m) => m.item ? `${m.slot}: ${m.item}` : m.slot).join("\n"))}">${p.missingCount} missing</span>`
            + `<span class="off-cons">${esc((p.missingEnchants ?? []).map((m) => m.slot).join(", "))}</span>`)
      : '<span class="dim" title="No gear data logged for this player">no data</span>';
    return `<tr>
      <td><span style="color:${color}">${esc(p.name)}</span> ${ROLE_ICONS[p.role] ?? ""}${altTag}</td>
      <td class="dim">${esc(spec)}</td>
      <td class="mono dim">${p.perFight ? p.perFight.attended : "?"}/${c.fights.length}</td>
      ${consCell(p.perFight)}
      ${ratioCell(p.perFight, "foodFights")}
      <td>${ench}</td>
      ${deathCell(p)}
      ${avoidCell(p)}
      ${interruptCell(p)}
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
    ${deepButton(c)}
    <table class="csi-table">
      <thead><tr><th>Player</th><th>Spec</th><th>Fights</th><th>Consumables</th><th>Food</th><th>Enchants</th>
        <th title="Deaths across the whole night, trash included">Deaths</th>
        ${deep ? '<th title="Damage taken from mechanics that were avoidable for this role">Avoidable dmg</th><th title="Enemy casts interrupted">Interrupts</th>' : ""}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="csi-hint">Consumables = pulls entered with any flask or elixir, out of the boss pulls
      each player attended (from per-pull combat snapshots), with what they ran.
      <span class="ok">Green</span> = flask or battle+guardian pair every pull;
      <span class="warn">amber</span> = a single elixir or an inconsistent night; red = nothing.</p>
    <p class="csi-hint"><b>Deaths</b> cover the whole night, trash included.
      ${deep
        ? `<b>Avoidable dmg</b> and <b>Interrupts</b> cover the ${deep.fightsScanned} <b>boss pulls only</b> —
           anything that happened on trash isn't counted, so these run lower than a full-night tally.
           Avoidable is judged per role: a frontal (Cleave, Mortal Cleave) is expected on the active
           tank and only counts against everyone else.`
        : "Avoidable damage and interrupts need the deep scan above."}</p>`;
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
  deep = null; // deep stats belong to one report; never carry them across
  try {
    card = await fetchOfficerCard(code, (text) => loading(text));
    view();
  } catch (e) {
    card = null;
    view(msg(e));
  }
}

async function runDeep() {
  // One scan at a time — it's the heaviest thing the app does, on a key every
  // visitor shares. A complete scan is final; a degraded one may be retried.
  if (!card || deepScanCode) return;
  if (deep && !deep.failed) return;
  const scanCode = card.code;
  deepScanCode = scanCode;
  if (deep) deep = null; // retrying: drop the degraded numbers while we re-run
  view();
  const roleById = new Map(card.players.map((p) => [p.id, p.role]));
  try {
    const result = await fetchDeepStats(scanCode, card.fights, roleById, (done, total) => {
      if (card?.code === scanCode) setDeepProgress(`Analysing pull ${done}/${total}…`);
    });
    deepScanCode = null;
    // The officer may have loaded another report while this ran. These numbers
    // are keyed by THAT report's actor ids — never show them on a different one.
    if (card?.code !== scanCode) return;
    deep = result;
    view();
  } catch (e) {
    deepScanCode = null;
    if (card?.code === scanCode) view(msg(e));
  }
}

// Live progress without re-rendering the whole card mid-scan.
function setDeepProgress(text) {
  const btn = root.querySelector("#off-deep-progress");
  if (btn) btn.textContent = text;
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
  } else if (e.target.closest("#off-deep")) {
    runDeep();
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
