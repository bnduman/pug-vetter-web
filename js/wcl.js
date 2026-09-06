// Thin Warcraft Logs API v2 client: OAuth2 client-credentials token
// (fetched from the browser — the API sends CORS headers) + GraphQL POSTs.
import { CONFIG } from "./config.js";

export class WCLError extends Error {}

// localStorage when in a browser, in-memory map under Node (smoke tests).
const mem = new Map();
let warnedAboutStorage = false;
const store = {
  get(key) {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : mem.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  set(key, value) {
    const raw = JSON.stringify(value);
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(key, raw);
      else mem.set(key, raw);
    } catch (err) {
      // Storage full or blocked (private mode). The app still works — it just
      // re-queries everything, which quietly burns the rate limit every visitor
      // shares. Say so once so that's diagnosable instead of invisible.
      if (!warnedAboutStorage) {
        warnedAboutStorage = true;
        console.warn(`[pug-vetter] caching is disabled (${err?.name ?? "storage error"}) — `
          + "every lookup will re-query Warcraft Logs. Clearing site data usually fixes it.");
      }
    }
  },
};

export function cacheGet(key, ttlSeconds) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.t < ttlSeconds * 1000) return hit.v;
  return null;
}

export function cacheSet(key, value) {
  store.set(key, { t: Date.now(), v: value });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RATE_LIMIT_RETRIES = 2;
const BACKOFF_MS = [1000, 2000, 4000];
const MAX_RETRY_WAIT_MS = 30000;
const REQUEST_TIMEOUT_MS = 20000;

// fetch() with an abort-based timeout so a hung request can't stall the UI
// forever. Timeouts surface as a friendly WCLError.
const timedOut = () =>
  new WCLError(`Warcraft Logs request timed out after ${REQUEST_TIMEOUT_MS / 1000}s — try again.`);

// THE TIMEOUT HAS TO COVER THE BODY, NOT JUST THE HEADERS. `fetch` resolves as
// soon as response headers arrive, so clearing the timer at that point left the
// part that actually streams bytes — `resp.json()` / `resp.text()` — with no
// deadline at all. A server that sent headers and then stalled hung the lookup
// forever: no abort, no WCLError, and a spinner that never resolved.
//
// So the caller gets a `release` and must call it only AFTER consuming the
// body, in a finally. Until then the AbortController is still armed and a stall
// mid-body aborts exactly like a stall mid-header.
async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const release = () => clearTimeout(timer);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    return { resp, release };
  } catch (err) {
    release();
    if (err?.name === "AbortError") throw timedOut();
    throw err;
  }
}

async function jsonOf(resp) {
  try {
    return await resp.json();
  } catch (err) {
    // An abort here is the body-read deadline firing, not malformed JSON.
    if (err?.name === "AbortError") throw timedOut();
    throw new WCLError(
      `Warcraft Logs returned a non-JSON response (HTTP ${resp.status}). ` +
      "It may be down for maintenance — please try again shortly.");
  }
}

async function getToken(force = false) {
  if (!force) {
    const cached = store.get("wcl_token");
    if (cached && Date.now() < cached.expiry - 60000) return cached.value;
  }
  if (!CONFIG.WCL_CLIENT_ID || !CONFIG.WCL_CLIENT_SECRET) {
    throw new WCLError("Warcraft Logs credentials are not set — edit js/config.js.");
  }
  let resp, release;
  try {
    ({ resp, release } = await fetchWithTimeout(CONFIG.TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${CONFIG.WCL_CLIENT_ID}:${CONFIG.WCL_CLIENT_SECRET}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    }));
  } catch (err) {
    if (err instanceof WCLError) throw err;
    throw new WCLError(`Could not reach Warcraft Logs: ${err}`);
  }
  try {
    if (!resp.ok) {
      throw new WCLError(
        `Token request failed (${resp.status}). Check the client id/secret in js/config.js.`);
    }
    const data = await jsonOf(resp);
    if (!data.access_token) throw new WCLError("Token response did not contain an access_token.");
    store.set("wcl_token", {
      value: data.access_token,
      expiry: Date.now() + (data.expires_in ?? 3600) * 1000,
    });
    return data.access_token;
  } finally {
    release();   // only now is the body done streaming
  }
}

function retryAfterMs(resp, attempt) {
  const header = resp.headers.get("Retry-After");
  if (header) {
    const secs = parseFloat(header);
    if (!Number.isNaN(secs)) return Math.max(0, secs * 1000);
  }
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
}

export async function postGraphQL(query, variables = {}) {
  let tokenRetried = false;
  let rateAttempt = 0;
  for (;;) {
    const token = await getToken();
    let resp, release;
    try {
      ({ resp, release } = await fetchWithTimeout(CONFIG.API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
      }));
    } catch (err) {
      if (err instanceof WCLError) throw err;
      throw new WCLError(`Could not reach Warcraft Logs: ${err}`);
    }

    // Every path out of here — including the two `continue`s that retry — has to
    // release the timer, or a long-lived page leaks one per retry.
    try {
    if (resp.status === 401 && !tokenRetried) {
      await getToken(true); // token may have expired early; refresh and retry once
      tokenRetried = true;
      continue;
    }
    if (resp.status === 429) {
      const wait = retryAfterMs(resp, rateAttempt);
      if (rateAttempt < RATE_LIMIT_RETRIES && wait <= MAX_RETRY_WAIT_MS) {
        await sleep(wait);
        rateAttempt += 1;
        continue;
      }
      throw new WCLError("Rate limited by Warcraft Logs. Wait a bit and try again.");
    }
    if (!resp.ok) {
      const text = (await resp.text()).slice(0, 300);
      throw new WCLError(`Warcraft Logs returned HTTP ${resp.status}: ${text}`);
    }

    const payload = await jsonOf(resp);
    if (payload.errors?.length) {
      const msgs = payload.errors.map((e) => e.message ?? "?").join("; ");
      throw new WCLError(`Query error: ${msgs}`);
    }
    return payload.data ?? {};
    } finally {
      release();
    }
  }
}
