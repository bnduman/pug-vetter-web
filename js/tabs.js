"use strict";
// Top-level tab switching between the PuG Vetter view and the Wipe Autopsy view.
const tabs = document.querySelectorAll(".tab");
const views = {
  vetter: document.getElementById("view-vetter"),
  autopsy: document.getElementById("view-autopsy"),
};

function activate(name) {
  for (const t of tabs) {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  }
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
}

for (const t of tabs) t.addEventListener("click", () => activate(t.dataset.tab));
activate("vetter");
