"use strict";
// Wipe Autopsy tab — paste a WCL report, reconstruct deaths, diagnose the wipe,
// and copy a Discord-ready summary. Vanilla DOM in the same style as app.js.
import { WCLError } from "./wcl.js";
import { parseReportUrl } from "./csi/parse-url.js";
import { fetchReport } from "./csi/fetch-report.js";
import { actorIndex, mmss, num } from "./csi/format.js";
import { summarizeFight } from "./csi/summary.js";
import { toDiscordMarkdown } from "./csi/discord.js";
import { gruulDemo } from "./csi/demo.js";
import { QUALITY_COLORS } from "./analyze.js";
import { ENCHANT_SPELLS } from "./enchant-spells.js";
import { CLASS_COLORS, ROLE_ICONS } from "./wcl-classes.js";

const WOWHEAD_ITEM = "https://www.wowhead.com/tbc/item=";
const WOWHEAD_SPELL = "https://www.wowhead.com/tbc/spell=";

const root = document.getElementById("autopsy");

let report = null;
let reportCode = null;
let currentFight = null;
let currentSummary = null;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function msg(e) {
  return e instanceof WCLError ? e.message : `Request failed: ${e}`;
}

// --- screens ---------------------------------------------------------------

function home(error, urlValue) {
  report = null;
  reportCode = null;
  root.innerHTML = `
    <div class="csi-home">
      <h2>Why did we wipe?</h2>
      <p class="sub">Paste a Warcraft Logs report — CSI reconstructs each death, names the
        likely cause, and hands you a Discord-ready &ldquo;fix next pull&rdquo; checklist.</p>
      <div class="csi-row">
        <input id="csi-url" aria-label="Warcraft Logs report URL" value="${esc(urlValue ?? "")}" placeholder="https://classic.warcraftlogs.com/reports/ABC123#fight=5" />
        <button id="csi-analyze" type="button">Analyze</button>
      </div>
      <p class="csi-hint">Paste a whole report to see every pull, or add <code>#fight=5</code> to jump to one.</p>
      ${error ? `<p class="csi-error">${esc(error)}</p>` : ""}
      <p class="csi-or">or <button id="csi-demo" class="linklike" type="button">load a demo report</button></p>
    </div>`;
}

function loading(text) {
  root.innerHTML = `<div class="csi-loading" role="status" aria-live="polite">🔍 ${esc(text)}</div>`;
}

function overview(error) {
  const idx = actorIndex(report);
  const rows = report.fights.map((f) => ({
    f,
    s: f.events.length > 0 ? summarizeFight(f, idx) : null,
  }));
  const wipes = rows.filter((r) => !r.f.kill);
  const kills = rows.filter((r) => r.f.kill);
  const avg = wipes.length ? wipes.reduce((n, r) => n + r.f.durationMs, 0) / wipes.length : 0;

  const analyzedWipes = rows.filter((r) => !r.f.kill && r.s);
  const counts = new Map();
  for (const r of analyzedWipes) {
    const t = r.s.primaryCause.text;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  // Only meaningful once 2+ wipes have been analyzed; a single opened fight is
  // not "most common".
  const common = analyzedWipes.length >= 2
    ? [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    : null;

  const tableRows = rows.map((r, i) => `
    <tr class="csi-fight-row" role="button" tabindex="0" data-fight="${esc(r.f.id)}" aria-label="Analyze ${esc(r.f.bossName)} ${r.f.kill ? "kill" : "wipe"}">
      <td class="dim mono">${i + 1}</td>
      <td>${esc(r.f.bossName)}</td>
      <td>${r.f.kill ? '<span class="ok">Kill</span>' : '<span class="bad">Wipe</span>'}</td>
      <td class="mono">${mmss(r.f.durationMs)}</td>
      <td class="dim">${r.s ? esc(r.s.primaryCause.text) : '<span class="link">Select to analyze →</span>'}</td>
    </tr>`).join("");

  root.innerHTML = `
    <div class="csi-report">
      <button id="csi-home-link" class="linklike" type="button">← New report</button>
      ${error ? `<p class="csi-error">${esc(error)}</p>` : ""}
      <h2>${esc(report.title)}</h2>
      <p class="sub">${esc(report.zone ?? "Unknown zone")}${report.owner ? ` · logged by ${esc(report.owner)}` : ""}</p>
      <div class="csi-stats">
        ${stat("Fights", report.fights.length)}
        ${stat("Kills", kills.length)}
        ${stat("Wipes", wipes.length)}
        ${stat("Avg wipe", mmss(avg))}
      </div>
      ${common ? `<p class="sub">Most common wipe cause: <b>${esc(common)}</b></p>` : ""}
      <table class="csi-table">
        <thead><tr><th>#</th><th>Boss</th><th>Result</th><th>Duration</th><th>Main issue</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`;
}

function stat(label, value) {
  return `<div class="csi-stat"><div class="csi-stat-label">${label}</div><div class="csi-stat-val mono">${value}</div></div>`;
}

function fightView(fightId) {
  const idx = actorIndex(report);
  const fight = report.fights.find((f) => f.id === fightId);
  if (!fight) { overview("Fight not found."); return; }
  const summary = summarizeFight(fight, idx);
  currentFight = fight;
  currentSummary = summary;

  const pc = summary.primaryCause;
  const contrib = summary.contributingFactors.length
    ? `<h3>Contributing factors</h3><ul>${summary.contributingFactors.map((f) => `<li>${esc(f.text)}</li>`).join("")}</ul>`
    : "";
  const checklist = summary.nextPullChecklist.length
    ? `<h3>Fix next pull</h3><ol>${summary.nextPullChecklist.map((c) => `<li>${esc(c)}</li>`).join("")}</ol>`
    : "";

  const mechanics = (summary.mechanics ?? []).slice(0, 8);
  const mechanicsBlock = mechanics.length
    ? `<div class="csi-card">
         <div class="csi-card-head"><h3>Avoidable mechanics</h3><span class="dim">${mechanics.length} detected</span></div>
         <ul class="csi-kv">${mechanics.map((m) => `
           <li>
             <span>${sevBadge(m.severity)} ${esc(m.ability)} <span class="dim">(${esc(m.encounter)})</span>${m.deaths > 0 ? ` <span class="bad">${m.deaths} death${m.deaths > 1 ? "s" : ""}</span>` : ""}</span>
             <span class="dim mono">${m.playersHit} hit · ${num(m.totalDamage)}</span>
           </li>`).join("")}</ul>
       </div>`
    : "";

  const prepBlock = prepCard(fight.prep);

  const deaths = summary.deaths.length
    ? summary.deaths.map(deathCard).join("")
    : `<p class="dim">No deaths recorded in this fight.</p>`;

  root.innerHTML = `
    <div class="csi-report">
      <button id="csi-back" class="linklike" type="button">← Back to report</button>
      <div class="csi-fight-head">
        <div>
          <h2>${esc(fight.bossName)}</h2>
          <p class="sub">${fight.kill ? '<span class="ok">Kill</span>' : '<span class="bad">Wipe</span>'} · ${mmss(fight.durationMs)}${!fight.kill && fight.bossPercentRemaining !== undefined ? ` · boss ${fight.bossPercentRemaining}% left` : ""}</p>
        </div>
        <button id="csi-copy" type="button">Copy raid summary</button>
      </div>

      <div class="csi-card">
        <div class="csi-card-head"><h3>Wipe summary</h3><span class="dim">confidence: ${summary.confidence}</span></div>
        <p class="csi-primary">${sevBadge(pc.severity)} <b>${esc(pc.text)}</b></p>
        ${contrib}
        ${checklist}
      </div>

      ${prepBlock}
      ${mechanicsBlock}

      <h3>Deaths <span class="dim">(${summary.deaths.length})</span></h3>
      ${deaths}
    </div>`;
}

// Per-pull raid prep: coverage chips with progress fill, role sections, and an
// expandable row per player (their exact consumables + every item's enchant).
function prepCard(prep) {
  if (!prep || !prep.players?.length) return "";
  const c = prep.coverage;
  const n = prep.raidSize;

  const cov = (emoji, label, have, total, title) => {
    // No players with data at all -> unknown, not a red 0/0 ("unknown is
    // never blamed" — same rule as the per-player pills).
    if (!total) {
      return `<span class="csi-cov csi-dim" title="No data available">${emoji} ${label} <b>no data</b></span>`;
    }
    const pct = Math.round((have / total) * 100);
    const cls = have >= total ? "csi-ok" : pct >= 70 ? "csi-mid" : "csi-bad";
    return `<span class="csi-cov ${cls}" style="--p:${pct}%"${title ? ` title="${esc(title)}"` : ""}>${emoji} ${label} <b>${have}/${total}</b></span>`;
  };
  const cc = c.consumablesCovered ?? n;
  const coverage = `<div class="csi-cov-row">
    ${cov("🧪", "Flask-ready", c.flaskReady, cc, "A flask, or a battle + guardian elixir pair (equivalent)")}
    ${cov("🍖", "Well Fed", c.food, cc)}
    ${c.drums ? cov("🥁", "Drums", c.drums, cc, "Drums of Battle coverage") : ""}
    ${cov("✨", "Enchanted", c.enchanted, c.gearCovered, "Fully enchanted, of players with gear data")}
  </div>`;

  const ROLE_SECTIONS = [["tank", "Tanks"], ["healer", "Healers"], ["dps", "DPS"]];
  const sections = ROLE_SECTIONS.map(([role, label]) => {
    const list = prep.players.filter((p) => p.role === role);
    if (!list.length) return "";
    const ready = list.filter((p) => p.issues === 0).length;
    return `<div class="csi-prep-role">
      <h4>${ROLE_ICONS[role] ?? ""} ${label} <span class="csi-role-count ${ready === list.length ? "ok" : "dim"}">${ready}/${list.length} ready</span></h4>
      ${list.map(prepRow).join("")}
    </div>`;
  }).join("");

  return `
    <div class="csi-card">
      <div class="csi-card-head"><h3>Raid prep</h3><span class="dim">${c.fullyReady}/${n} fully ready · click a name for details</span></div>
      ${coverage}
      <div class="csi-prep-list">${sections}</div>
    </div>`;
}

const pill = (cls, text, title) =>
  `<span class="csi-pill csi-${cls}"${title ? ` title="${esc(title)}"` : ""}>${text}</span>`;

function prepRow(p) {
  const cons = p.consumables;
  const nameColor = CLASS_COLORS[p.class] ?? "var(--text)";

  // Flask pill: flask and a battle+guardian pair are equally green. Unknown
  // (failed buff query) is dim "no data" — never blamed as unprepped.
  let flaskPill;
  let foodPill;
  if (cons.unknown) {
    flaskPill = pill("dim", "🧪 no data", "Consumable data couldn't be fetched for this player");
    foodPill = pill("dim", "🍖 no data");
  } else {
    if (cons.flask) {
      flaskPill = pill("ok", "🧪 Flask", cons.flask);
    } else if (cons.flaskReady) {
      flaskPill = pill("ok", "🧴 Elixir pair", cons.elixirs.join(" + "));
    } else if (cons.elixirs.length >= 1) {
      const missingHalf = cons.battle ? "guardian" : cons.guardian ? "battle" : "second";
      flaskPill = pill("mid", `🧴 no ${missingHalf}`, `${cons.elixirs.join(" + ")} — add a ${missingHalf} elixir (or flask)`);
    } else {
      flaskPill = pill("bad", "🧪 none", "No flask or elixirs");
    }
    foodPill = cons.food ? pill("ok", "🍖 Fed") : pill("bad", "🍖 no food");
  }

  const missingSlots = p.gear.filter((g) => g.enchantable && !g.enchant).map((g) => g.slotLabel);
  const enchPill = !p.hasGear
    ? pill("dim", "✨ no data", "No gear data for this pull")
    : p.missingCount === 0
      ? pill("ok", "✨ enchanted")
      : pill("bad", `✨ ${p.missingCount} missing`, missingSlots.join(", "));

  const status = p.issues === 0 ? "ready" : p.issues === 1 ? "warn" : "poor";

  // Expanded detail: exact consumables first, then the itemized gear list.
  const consLines = [];
  if (cons.unknown) {
    consLines.push(`<span class="dim">Consumable data unavailable for this pull.</span>`);
  } else {
    if (cons.flask) consLines.push(`<span class="ok">🧪 ${esc(cons.flask)}</span>`);
    else if (cons.elixirs.length) {
      for (const e of cons.elixirs) consLines.push(`<span class="${cons.flaskReady ? "ok" : "warn"}">🧴 ${esc(e)}</span>`);
      if (!cons.flaskReady) consLines.push(`<span class="bad">✗ missing ${cons.battle ? "guardian" : cons.guardian ? "battle" : "second"} elixir</span>`);
    } else consLines.push(`<span class="bad">✗ no flask or elixirs</span>`);
    consLines.push(cons.food ? `<span class="ok">🍖 Well Fed</span>` : `<span class="bad">✗ no food buff</span>`);
    if (cons.drums) consLines.push(`<span class="ok">🥁 Drums of Battle</span>`);
  }

  // Spec label on the summary row, from the talent tree totals.
  const specLabel = p.talents?.spec
    ? `<span class="csi-spec dim">${esc(p.talents.spec)} ${p.talents.distribution}</span>`
    : "";

  const gear = p.gear.length
    ? `<div class="csi-gear">${p.gear.map(gearRow).join("")}</div>`
    : `<p class="dim csi-gear">No gear data for this pull.</p>`;

  return `
    <details class="csi-prep-player csi-st-${status}">
      <summary>
        <span class="csi-pname" style="color:${nameColor}">${esc(p.name)}</span>${specLabel}
        <span class="csi-pchips">${flaskPill}${foodPill}${enchPill}</span>
      </summary>
      ${talentBlock(p.talents)}
      <div class="csi-cons-detail">${consLines.join("")}</div>
      ${gear}
    </details>`;
}

// Talent tree distribution — three point-bars (WCL gives per-tree totals only,
// not individual talents).
function talentBlock(t) {
  if (!t) return "";
  const max = Math.max(1, ...t.trees.map((x) => x.points));
  const rows = t.trees.map((x) => {
    const w = Math.round((x.points / max) * 100);
    const cls = x.name === t.spec ? "csi-tal-primary" : "";
    return `<div class="csi-tal-row ${cls}">
      <span class="csi-tal-name">${esc(x.name)}</span>
      <span class="csi-tal-bar"><span style="width:${w}%"></span></span>
      <span class="csi-tal-pts mono">${x.points}</span>
    </div>`;
  }).join("");
  return `<div class="csi-talents"><h5>Talents — ${esc(t.spec ?? "?")} (${t.distribution})</h5>${rows}</div>`;
}

function gearRow(g) {
  const color = QUALITY_COLORS[g.quality] ?? "#fff";
  const item = g.id
    ? `<a class="csi-gname csi-wh" style="color:${color}" href="${WOWHEAD_ITEM}${Number(g.id)}" target="_blank" rel="noopener">${esc(g.name)}</a>`
    : `<span class="csi-gname" style="color:${color}">${esc(g.name)}</span>`;
  const enchSpell = g.enchantId ? ENCHANT_SPELLS[g.enchantId] : null;
  const ench = g.enchant
    ? (enchSpell
        ? `<a class="ok csi-wh" href="${WOWHEAD_SPELL}${Number(enchSpell)}" target="_blank" rel="noopener">${esc(g.enchant)}</a>`
        : `<span class="ok">${esc(g.enchant)}</span>`)
    : g.enchantable
      ? `<span class="bad">✗ no enchant</span>`
      : `<span class="dim">—</span>`;
  return `<div class="csi-gear-row">
    <span class="dim">${esc(g.slotLabel)}</span>
    ${item}
    <span>${ench}</span>
  </div>`;
}

function deathCard(d) {
  const dmgList = d.damageTaken.length
    ? d.damageTaken.map((s) => `<li><span class="${s.avoidable ? "warn" : ""}">${esc(s.abilityName)}${s.avoidable ? " ⚠" : ""}</span><span class="dim mono">${num(s.total)}</span></li>`).join("")
    : `<li class="dim">No damage recorded in window.</li>`;
  const notes = d.notes.length
    ? d.notes.map((n) => `<li>${esc(n)}</li>`).join("")
    : `<li class="dim">Nothing notable.</li>`;
  const blow = d.killingBlow
    ? `<span class="dim">killed by <b>${esc(d.killingBlow.abilityName)}</b> (${num(d.killingBlow.amount)})</span>`
    : "";

  const timeline = d.timeline ?? [];
  const timelineRows = timeline.map(timelineRow).join("");
  const timelineBlock = timeline.length
    ? `<details class="csi-timeline">
         <summary>Last ${d.windowMs / 1000}s timeline (${timeline.length} events)</summary>
         <ul class="csi-tl">
           ${timelineRows}
           <li><span class="mono dim">0.0s</span><span class="bad">☠ Died</span><span></span><span class="mono bad">0%</span></li>
         </ul>
       </details>`
    : "";

  return `
    <div class="csi-card">
      <div class="csi-death-head">
        ${sevBadge(d.severity)}
        <span class="mono dim">${mmss(d.timestamp)}</span>
        <b>${esc(d.victim.name)}</b>
        <span class="dim">${esc([d.victim.spec, d.victim.class].filter(Boolean).join(" "))}</span>
        <span class="csi-spacer"></span>${blow}
      </div>
      <div class="csi-death-cols">
        <div>
          <h4>Damage taken (last ${d.windowMs / 1000}s)</h4>
          <ul class="csi-kv">${dmgList}</ul>
        </div>
        <div>
          <h4>Observations</h4>
          <ul>${notes}</ul>
        </div>
      </div>
      ${timelineBlock}
    </div>`;
}

function timelineRow(ev) {
  const t = `-${(ev.ms / 1000).toFixed(1)}s`;
  const from = ev.source ? ` <span class="dim">from ${esc(ev.source)}</span>` : "";
  const hp = ev.hpPct != null ? `<span class="mono dim" title="HP after">${ev.hpPct}%</span>` : `<span></span>`;
  if (ev.kind === "heal") {
    return `<li><span class="mono dim">${t}</span><span class="ok">＋ ${esc(ev.ability)}${from}</span><span class="mono ok">+${num(ev.amount)}</span>${hp}</li>`;
  }
  if (ev.kind === "cooldown") {
    const from = ev.source ? ` <span class="dim">from ${esc(ev.source)}</span>` : "";
    return `<li><span class="mono dim">${t}</span><span class="link">🛡 ${esc(ev.ability)}${from}</span><span class="dim mono">used</span><span></span></li>`;
  }
  const mark = ev.avoidable ? "⚠" : "✶";
  const cls = ev.avoidable ? "warn" : "";
  return `<li><span class="mono dim">${t}</span><span class="${cls}">${mark} ${esc(ev.ability)}${from}</span><span class="mono bad">−${num(ev.amount)}</span>${hp}</li>`;
}

function sevBadge(sev) {
  return `<span class="csi-sev csi-sev-${sev}">${sev}</span>`;
}

// --- actions ---------------------------------------------------------------

async function analyze(input) {
  const parsed = parseReportUrl(input);
  if (!parsed) {
    home("That doesn't look like a Warcraft Logs report URL or code.", input);
    return;
  }
  loading("Investigating the logs…");
  try {
    const ov = await fetchReport(parsed.reportCode);
    report = ov;
    reportCode = parsed.reportCode;
    if (parsed.fightId !== undefined && ov.fights.length) {
      const fid = parsed.fightId === "last"
        ? ov.fights[ov.fights.length - 1].id
        : String(parsed.fightId);
      await navigateFight(fid);
      return;
    }
    overview();
  } catch (e) {
    home(msg(e), input);
  }
}

async function navigateFight(fightId) {
  const fight = report.fights.find((f) => f.id === fightId);
  if (reportCode && fight && fight.events.length === 0) {
    loading("Pulling the events for this pull…");
    try {
      const full = await fetchReport(reportCode, Number(fightId));
      report = {
        ...report,
        actors: full.actors,
        fights: report.fights.map((f) => (f.id === fightId ? full.fights[0] : f)),
      };
    } catch (e) {
      overview(msg(e));
      return;
    }
  }
  fightView(fightId);
}

async function copySummary(btn) {
  if (!currentFight || !currentSummary) return;
  try {
    await navigator.clipboard.writeText(toDiscordMarkdown(currentFight, currentSummary));
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = "Copy raid summary"), 2000);
  } catch {
    btn.textContent = "Copy failed";
  }
}

// --- event delegation (root is re-rendered constantly) ---------------------

root.addEventListener("click", (e) => {
  if (e.target.closest("#csi-analyze")) {
    analyze(document.getElementById("csi-url")?.value ?? "");
  } else if (e.target.closest("#csi-demo")) {
    report = gruulDemo;
    reportCode = null;
    overview();
  } else if (e.target.closest("#csi-home-link")) {
    home();
  } else if (e.target.closest("#csi-back")) {
    overview();
  } else if (e.target.closest("#csi-copy")) {
    copySummary(e.target.closest("#csi-copy"));
  } else {
    const row = e.target.closest(".csi-fight-row");
    if (row) navigateFight(row.dataset.fight);
  }
});

root.addEventListener("keydown", (e) => {
  if (e.target.id === "csi-url" && e.key === "Enter") {
    e.preventDefault();
    analyze(e.target.value);
    return;
  }
  // Enter/Space activates a keyboard-focused fight row.
  if (e.key === "Enter" || e.key === " ") {
    const row = e.target.closest?.(".csi-fight-row");
    if (row) {
      e.preventDefault();
      navigateFight(row.dataset.fight);
    }
  }
});

home();
