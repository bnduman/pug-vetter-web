"use strict";
// Screen-reader announcements for state the sighted user reads off a spinner.
//
// Both tab views rebuild their whole markup on every render, so a live region
// inside them is DESTROYED AND RECREATED rather than updated. Assistive tech
// watches a live region for text changes; a brand-new node that already
// contains its message is announced inconsistently (and not at all in several
// screen readers). The reliable pattern — the one #status in the vetter tab
// has always used — is one region that persists and has its text set.
//
// So: #a11y-live sits in index.html outside the tab panels (a hidden tab is
// display:none, and nothing inside a hidden subtree is announced), and every
// view routes its status text through announce().

const region = typeof document !== "undefined" ? document.getElementById("a11y-live") : null;
let last = null;

/**
 * Announce `text` politely, replacing whatever was there.
 * Repeats of the identical message are dropped: renders fire far more often
 * than the state actually changes (a progress step re-renders the whole card),
 * and re-announcing the same sentence is noise.
 */
export function announce(text) {
  if (!region) return;
  const msg = String(text ?? "").trim();
  if (!msg || msg === last) return;
  last = msg;
  region.textContent = msg;
}

/** Clear the region so the next announcement is heard even if identical. */
export function clearAnnouncement() {
  last = null;
  if (region) region.textContent = "";
}
