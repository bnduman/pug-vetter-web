"use strict";
// Top-level tab switching between the PuG Vetter view and the Wipe Autopsy view.
const tabs = document.querySelectorAll(".tab");
// One view per tab, found by convention: data-tab="x" <-> #view-x.
const views = {};
for (const t of tabs) views[t.dataset.tab] = document.getElementById(`view-${t.dataset.tab}`);

function activate(name) {
  for (const t of tabs) {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  }
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
}

for (const t of tabs) t.addEventListener("click", () => activate(t.dataset.tab));

// ARIA tablist pattern: Left/Right arrows move between (and activate) tabs.
document.getElementById("tabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const list = [...tabs];
  const i = list.indexOf(document.activeElement);
  if (i === -1) return;
  e.preventDefault();
  const next = list[(i + (e.key === "ArrowRight" ? 1 : list.length - 1)) % list.length];
  next.focus();
  // Activate via click() so per-tab click listeners (e.g. the Officer tab's
  // lazy data load) fire for keyboard users too.
  next.click();
});

activate("vetter");
