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
import { mmss } from "./csi/format.js";
import { CLASS_COLORS, ROLE_ICONS } from "./wcl-classes.js";

const root = document.getElementById("officer");

let reports = null;   // guild report picker entries
let roster = null;    // buildRoster() output
let card = null;      // current report card
let pickedCode = null; // dropdown choice — survives re-renders before "Load"
let showEveryone = false;
let rosterError = null;   // why the attendance half is missing, if it is
let rosterPartial = false; // scan stopped early (WCL hung) — history is short
let rosterLoading = false; // attendance still in flight under a usable tab
let deep = null;      // opt-in deep stats for the loaded card (see officer-stats.js)
// Report code of the scan currently in flight, or null. A code (not a bool)
// because the scan takes ~10s: the officer can load a different report while
// it runs, and the result must only ever land on the report it scanned.
let deepScanCode = null;
// Report code of the card fetch currently in flight, or null. Same reason as
// deepScanCode: the result must only ever land on the report it was asked for.
let cardLoadCode = null;
// Progress text while a card fetch is in flight. It renders INSIDE the card
// slot rather than through loading(), which blanks the whole tab: a card load
// is 5 queries and an uncached report can take many seconds, and wiping the
// picker and the attendance roster for that long — the two things the officer
// was just reading — is a poor trade for a spinner.
let cardLoading = null;
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
  const { flaskFights: n, elixirFights: e, attended: m, consumables = [], scrolls = [], scrollFights = 0 } = pf;
  const cls = n === m ? "ok" : e > 0 ? "warn" : "bad";
  const labels = [...new Set(consumables.map(shortCons))];
  // Scrolls aren't elixirs and never count toward the ratio, but "scrolls only"
  // is a different conversation from "brought nothing", so say which it was.
  const label = labels.join(", ")
    || (scrolls.length ? `scrolls only (${scrollFights}/${m})` : "nothing");
  const scrollNote = scrolls.length ? `\nscrolls on ${scrollFights}/${m} pulls: ${scrolls.join(", ")}` : "";
  const title = (consumables.length
    ? `flask-equivalent on ${n}/${m} pulls · ran: ${consumables.join(", ")}`
    : "no flask or elixir on any pull") + scrollNote;
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
  if (!a || (!a.avoidable && !a.taken)) return '<td class="mono dim">–</td>';
  if (!a.avoidable) return '<td class="mono ok">0</td>';
  // `taken` comes only from the unfiltered pass. If that one job was the batch
  // that failed, the damage is still real — show it without a made-up share
  // rather than returning "–" and hiding it.
  const pct = a.taken ? Math.round((a.avoidable / a.taken) * 100) : null;
  const worst = [...a.abilities.entries()].sort((x, y) => y[1].total - x[1].total);
  const label = worst.slice(0, 2).map(([n]) => n).join(", ");
  const cls = pct == null ? "" : pct >= 40 ? "bad" : pct >= 15 ? "warn" : "";
  const title = worst.map(([n, v]) => `${n}: ${num(v.total)}`).join("\n")
    + (pct == null ? "\n(share of all damage taken unavailable)" : "");
  const share = pct == null ? '<span class="dim">(?%)</span>' : `<span class="dim">(${pct}%)</span>`;
  return `<td class="mono ${cls}" title="${esc(title)}">${num(a.avoidable)} ${share}`
    + `<span class="off-cons">${esc(label)}</span></td>`;
}

function interruptCell(p) {
  if (!deep) return "";
  const i = deep.interrupts.get(p.id);
  if (!i || !i.count) return '<td class="mono dim">–</td>';
  const title = [...i.spells.entries()].map(([s, n]) => `${s} ×${n}`).join("\n");
  return `<td class="mono ok" title="${esc(title)}">${i.count}</td>`;
}

// Consumables actually used over the night: potions drunk, stones eaten, drums
// beaten. Distinct from the "Consumables" prep column, which is about whether
// they turned up with a flask.
function usedCell(p) {
  if (!deep) return "";
  const c = deep.consumables.get(p.id);
  if (!c || !c.total) return '<td class="mono dim">–</td>';
  const g = c.byGroup;
  // Every group the total counts must appear here, or the number and the
  // breakdown under it disagree (Flame Cap, Fel Blossom & co are "misc").
  const brief = [
    g.mana ? `${g.mana} mana` : "",
    g.healing ? `${g.healing} hp` : "",
    g.drums ? `${g.drums} drums` : "",
    g.utility ? `${g.utility} misc` : "",
  ].filter(Boolean).join(", ");
  const title = [...c.items.entries()].sort((a, b) => b[1] - a[1])
    .map(([n, v]) => `${n} ×${v}`).join("\n");
  return `<td class="mono" title="${esc(title)}">${c.total}<span class="off-cons">${esc(brief)}</span></td>`;
}

// --- screens ---------------------------------------------------------------

function loading(text) {
  root.innerHTML = `<div class="csi-loading" role="status" aria-live="polite">🛡️ ${esc(text)}</div>`;
}

// view() replaces the whole root, which drops focus. That matters because the
// attendance half lands a second or two AFTER first paint and redraws
// underneath an already-usable tab: without this, an officer who went straight
// for the report picker gets it closed under them. Only ever restores focus to
// something that already had it inside this tab, so it can never steal focus
// from the vetter tab or the page at large.
function withFocusPreserved(render) {
  const active = document.activeElement;
  const id = active && active.id && root.contains(active) ? active.id : null;
  render();
  if (id) document.getElementById(id)?.focus();
}

function view(error) {
  withFocusPreserved(() => renderView(error));
}

function renderView(error) {
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
      <div id="off-card">${cardLoading
        ? `<p class="csi-loading" role="status" aria-live="polite">🛡️ ${esc(cardLoading)}</p>`
        : card ? cardHtml(card) : '<p class="sub">Pick a raid night and load its report card.</p>'}</div>

      <h3 class="off-h3">Attendance <span class="dim">— last ${roster?.totalReports ?? 0} guild reports</span></h3>
      <label class="off-toggle"><input type="checkbox" id="off-all" ${showEveryone ? "checked" : ""} />
        show everyone (incl. one-off pugs)</label>
      ${rosterHtml()}
    </div>`;
}

// The deep scan costs a fixed ~20 whole-report queries against a rate limit
// shared by every visitor, so it's never automatic — the officer asks for it,
// and the button says up front what it will cost.
function deepButton(c) {
  const pulls = c.fights.length;
  if (deepScanCode === c.code) {
    return '<button id="off-deep-progress" class="secondary" type="button" disabled>Analysing…</button>';
  }
  if (deep && deep.failed) {
    // A degraded scan isn't cached, so re-running really does re-query.
    return `<button id="off-deep" class="secondary" type="button"
      title="${deep.failed} of ${deep.queries} query batches failed — some avoidable damage, interrupts or consumables are missing from these totals">
      Re-analyse (${deep.failed}/${deep.queries} batches failed)</button>`;
  }
  if (deep) {
    return `<span class="off-deep-done">✓ Whole night analysed (${deep.queries} queries, trash included)</span>`;
  }
  return `<button id="off-deep" class="secondary" type="button"
    title="Avoidable damage, interrupts and consumables for the whole night — trash included, not just the ${pulls} boss pulls (~20 queries on the shared Warcraft Logs key)">
    Analyse night</button>`;
}

// Raid-debuff coverage over the boss pulls. Raid-wide, so it's its own panel
// rather than a per-player column. Thresholds are deliberately loose: a debuff
// that has to be re-applied after every death or phase change never reads 100%.
function debuffsHtml(c) {
  if (!c.debuffs) {
    // Not cached in this state, so "load it again" really does re-query.
    return `<p class="csi-hint warn">⚠ Raid-debuff uptimes couldn't be read for this report
      — load it again to retry.</p>`;
  }
  const rows = c.debuffs.rows.map((d) => {
    if (!d.hasProvider) {
      const who = d.specs
        ? `${d.specs.join("/")} ${d.providers.join("/")}`
        : d.providers.join(" or ");
      return `<tr class="dim">
        <td>${esc(d.label)}</td>
        <td class="mono">–</td>
        <td colspan="2">no ${esc(who)} in the raid</td>
      </tr>`;
    }
    const cls = d.pct >= 80 ? "ok" : d.pct >= 50 ? "warn" : "bad";
    const bar = `<span class="off-bar"><span class="off-bar-fill ${cls}" style="width:${Math.min(100, d.pct)}%"></span></span>`;
    return `<tr>
      <td>${esc(d.label)}${d.core ? "" : ' <span class="dim" title="Situational — nice to have, not expected every pull">·</span>'}</td>
      <td class="mono ${cls}">${d.pct}%</td>
      <td>${bar}</td>
      <td class="dim">${esc(d.spells.join(", ") || "never applied")}</td>
    </tr>`;
  }).join("");
  return `
    <table class="csi-table off-debuffs">
      <thead><tr><th>Raid debuff</th><th>Uptime</th><th></th><th>Applied as</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="csi-hint">Uptime across the <b>${c.fights.length} boss pulls</b> only (${mmss(c.debuffs.totalTime)} of fighting),
      not the whole night — downtime between pulls would make everything look terrible.
      A row greys out when nobody in the raid could apply it. Measured on any enemy in the
      pull, so adds can flatter a debuff that never reached the boss.</p>`;
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
      ${usedCell(p)}
    </tr>`;
  }).join("");

  // A degraded scan still renders per-player numbers, and a number with no
  // caveat reads as authoritative. The button above says a batch failed; mark
  // the affected columns too, so a low figure can't be mistaken for a good one.
  const partialMark = deep?.failed
    ? ' <span class="warn" title="Some query batches failed — these totals are incomplete">⚠</span>'
    : "";

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
        ${deep ? `<th title="Damage taken from mechanics that were avoidable for this role">Avoidable dmg${partialMark}</th>`
          + `<th title="Enemy casts interrupted">Interrupts${partialMark}</th>`
          + `<th title="Potions, healthstones and drums actually consumed">Used${partialMark}</th>` : ""}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="csi-hint">Consumables = pulls entered with any flask or elixir, out of the boss pulls
      each player attended (from per-pull combat snapshots), with what they ran.
      <span class="ok">Green</span> = flask or battle+guardian pair every pull;
      <span class="warn">amber</span> = a single elixir or an inconsistent night; red = nothing.</p>
    <p class="csi-hint"><b>Deaths</b> cover the whole night, trash included.
      ${deep
        ? `<b>Avoidable dmg</b>, <b>Interrupts</b> and <b>Used</b> also cover the whole night, trash included.
           Avoidable is judged per role: a frontal (Cleave, Mortal Cleave) is expected on the active
           tank and only counts against everyone else — it's damage from tracked boss mechanics, so an
           ability the catalogue doesn't know isn't counted (regenerate with <code>npm run gen:rule-ids</code>).
           <b>Used</b> counts potions, healthstones and drums consumed, not the flask you turned up with.`
        : "Avoidable damage, interrupts and consumables used need the deep scan above."}</p>
    ${deep?.failed ? `<p class="csi-hint warn">⚠ ${deep.failed} of ${deep.queries} query batches failed,
      so the ⚠ columns are <b>lower bounds</b> — a small number there may just be missing data.
      Re-analyse above to fill them in.</p>` : ""}
    <h4 class="off-h4">Raid debuffs</h4>
    ${debuffsHtml(c)}`;
}

function rosterHtml() {
  if (rosterLoading) {
    return '<p class="sub" role="status">⏳ Loading attendance… (Warcraft Logs is slow on this endpoint)</p>';
  }
  if (!roster) {
    // The report card above still works — say so, and offer just this retry.
    return `<p class="sub">${esc(rosterError ?? "Attendance not loaded.")}
      ${rosterError ? ' <button id="off-roster-retry" class="linklike" type="button">retry attendance</button>' : ""}</p>`;
  }
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
      Streak = consecutive most-recent guild reports attended.
      ${rosterPartial
        ? '<span class="warn">⚠ Warcraft Logs stopped responding partway — this covers fewer raids than usual. '
          + '<button id="off-roster-retry" class="linklike" type="button">retry</button></span>'
        : ""}</p>`;
}

// --- data ------------------------------------------------------------------

let initStarted = false;

async function init() {
  if (initStarted) return;
  initStarted = true;
  loading("Loading guild data…");

  // Two independent halves, rendered as they arrive — NOT awaited together.
  // The report picker answers in ~0.3s while WCL's guild attendance endpoint
  // intermittently hangs for minutes (measured 2026-07-24: 352s, and 1019s for
  // both halves together). Waiting on both is what made clicking the tab look
  // like a timeout: nothing painted until the slow half finally gave up.
  // Attendance is fired and forgotten here, and redraws underneath a tab that
  // is already usable. Guarded so retrying the picker can't start a second
  // attendance scan alongside one still in flight.
  if (!roster && !rosterLoading) loadRoster();

  try {
    reports = (await listGuildReports(20)) ?? [];
    view();
  } catch (e) {
    // Even with no picker, paint now and let the roster arrive underneath —
    // awaiting it here is exactly the multi-minute hang this rework removes.
    reports = [];
    initStarted = false; // the picker can be retried
    view(`${msg(e)} — the report picker is unavailable.`);
  }
}

// Loads (or reloads) just the attendance half, redrawing when it settles.
async function loadRoster() {
  rosterLoading = true;
  rosterError = null;
  try {
    const attMap = await getAttendanceMap();
    roster = attMap ? buildRoster(attMap, { limit: CONFIG.OFFICER_ROSTER_REPORTS }) : null;
    rosterPartial = !!attMap?.partial;
    if (!attMap) rosterError = `Guild "${CONFIG.GUILD_NAME}" was not found on Warcraft Logs.`;
  } catch (e) {
    rosterError = msg(e);
  } finally {
    rosterLoading = false;
  }
  // Only redraw if the tab has actually rendered — otherwise init's own
  // view() call, which comes later, would be clobbered by this one.
  if (reports) view();
}

// Retry just the attendance half, leaving the report card alone.
function retryRoster(btn) {
  if (rosterLoading) return;
  if (btn) { btn.disabled = true; btn.textContent = "retrying…"; }
  loadRoster();
}

async function loadCard(code) {
  if (!code) return;
  // Same hazard runDeep guards against, one function down: a card load is
  // several queries and an uncached report can take seconds, so the officer
  // can pick a different one (or one already in the session cache, which
  // answers instantly) while this is still in flight. Without a guard the
  // slower load lands last and shows report A under a picker reading B — and
  // its progress callbacks wipe B's rendered card back to a spinner meanwhile.
  if (cardLoadCode === code) return; // this exact report is already loading
  cardLoadCode = code;
  cardLoading = "Loading report card…";
  deep = null; // deep stats belong to one report; never carry them across
  card = null; // the old card belongs to a different report
  view();
  try {
    const result = await fetchOfficerCard(code, (text) => {
      if (cardLoadCode !== code) return;
      cardLoading = text;
      view();
    });
    if (cardLoadCode !== code) return; // a newer load took over; drop this one
    cardLoadCode = null;
    cardLoading = null;
    card = result;
    view();
  } catch (e) {
    if (cardLoadCode !== code) return;
    cardLoadCode = null;
    cardLoading = null;
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
    const result = await fetchDeepStats(scanCode, card.reportDurationMs, roleById, (done, total) => {
      if (card?.code === scanCode) setDeepProgress(`Analysing… ${done}/${total}`);
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
  } else if (e.target.closest("#off-roster-retry")) {
    retryRoster(e.target.closest("#off-roster-retry"));
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
