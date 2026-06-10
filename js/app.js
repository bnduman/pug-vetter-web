"use strict";
import { CONFIG } from "./config.js";
import { vet } from "./vet.js";
import { WCLError } from "./wcl.js";

const form = document.getElementById("vet-form");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const historyEl = document.getElementById("history");
const historyWrap = document.getElementById("history-wrap");
const btn = form.querySelector("button");

const history = []; // {name, found}

// Realm/region are fixed in js/config.js, so the form only asks for a name.
document.getElementById("realm-label").textContent =
  CONFIG.REALM ? `${CONFIG.REALM} (${CONFIG.REGION})` : "no realm configured — edit js/config.js";

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("name").value.trim();
  if (name) lookup(name);
});

async function lookup(name) {
  setStatus(`Looking up ${name}…`);
  resultEl.innerHTML = "";
  btn.disabled = true;
  try {
    const data = await vet(name);
    setStatus("");
    render(data);
    addHistory(data);
  } catch (err) {
    setStatus(err instanceof WCLError ? err.message : `Request failed: ${err}`, true);
  } finally {
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

function render(data) {
  if (!data.found) {
    resultEl.innerHTML = `<div class="no-data">
      <b>No logs found</b> for <b>${esc(data.name)}</b> on ${esc(data.realm)} (${esc(data.region)}).<br>
      They may simply have never been logged on Warcraft Logs &mdash; this is not proof they haven't raided.
      Check the spelling of the name.
    </div>`;
    return;
  }

  const raids = data.raids || [];
  const totalCleared = raids.reduce((n, r) => n + (r.cleared > 0 ? 1 : 0), 0);
  const lastLog = data.last_log
    ? new Date(data.last_log).toLocaleDateString()
    : "—";

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

  resultEl.innerHTML = `<div class="card">
    <h2>${esc(data.name)} <span class="meta" style="font-size:14px">${esc(data.realm)} · ${esc(data.region)}</span></h2>
    <div class="meta">Last logged raid: ${lastLog} &nbsp;·&nbsp; raids with a kill: ${totalCleared}/${raids.length}</div>

    <div class="section-title">Raid clears &amp; best perf. average</div>
    ${raidRows || '<div class="meta">No raid ranking data.</div>'}

    <div class="section-title">Enchants &amp; gems (from last logged gear)</div>
    ${renderEnchants(data.enchants)}
  </div>`;
}

function renderEnchants(en) {
  if (!en) {
    return `<div class="meta">No gear data available from logs.</div>`;
  }
  const missing = en.missing_required || 0;
  const ilvl = en.avg_item_level == null ? "—" : en.avg_item_level;
  const gems = en.gems_total || 0;
  const gemTxt = `<span class="gem-total">💎 ${gems} gem${gems === 1 ? "" : "s"} socketed</span>`;
  const enchTxt = missing === 0
    ? `<b class="ok">✔ Fully enchanted</b>`
    : `<b class="warn">⚠ ${missing} missing enchant${missing > 1 ? "s" : ""}</b>`;
  const head = `<div class="summary-line">${enchTxt} &nbsp;·&nbsp; ${gemTxt} &nbsp;·&nbsp; avg ilvl ${ilvl}</div>`;

  const chips = (en.slots || []).map((s) => {
    let cls = "chip", icon = "", text = s.slot;
    if (s.status === "enchanted") { cls += " ok"; icon = "✔"; text = `${s.slot}: ${esc(s.enchant)}`; }
    else if (s.status === "missing") { cls += s.required ? " missing" : " missing optional"; icon = "✗"; text = `${s.slot}: none`; }
    else { cls += " empty"; icon = "·"; text = `${s.slot}: empty`; }
    if (!s.required) cls += " optional";
    const gemBadge = s.gems > 0 ? `<span class="gem">💎${s.gems}</span>` : "";
    return `<span class="${cls}">${icon} ${text}${s.required ? "" : " (opt)"}${gemBadge}</span>`;
  }).join("");

  return head + `<div class="enchants">${chips}</div>`;
}

function addHistory(data) {
  const label = data.name;
  const entry = { name: data.name, label, found: data.found };
  const i = history.findIndex((h) => h.label.toLowerCase() === label.toLowerCase());
  if (i >= 0) history.splice(i, 1);
  history.unshift(entry);
  if (history.length > 10) history.pop();

  historyWrap.hidden = history.length === 0;
  historyEl.innerHTML = history.map((h, idx) =>
    `<li data-i="${idx}">${esc(h.name)}<span class="h-meta">${h.found ? "" : "no data"}</span></li>`
  ).join("");
}

historyEl.addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  const h = history[Number(li.dataset.i)];
  if (!h) return;
  document.getElementById("name").value = h.name;
  lookup(h.name);
});
