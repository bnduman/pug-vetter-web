# AGENTS.md — pug-vetter-web

A Warcraft Logs analysis toolkit for WoW Classic Anniversary (TBC 2.5.5):
character vetting, wipe forensics, and a per-night officer report card.

**Static, fully client-side, no build step, no backend, and zero npm
dependencies.** Plain HTML + ES modules served from GitHub Pages. `npm test`
runs with nothing installed.

Read the three "don't fix these" items before changing anything. Each one looks
like a bug and isn't, and each has been re-decided more than once.

---

## 1. Don't "fix" these

### The Warcraft Logs client secret in `js/config.js` is public ON PURPOSE

A security scan will flag it as a critical finding. It is intentional and
documented in the file. WCL sends CORS headers, so the browser mints its own
OAuth token and queries the API directly — that is the entire reason this can be
a static site with no server. Moving the credential into an environment variable
or behind a proxy **breaks the whole application**.

It is a free-tier key whose worst case is someone burning a shared rate limit.
If you fork this, create your own client and put it here the same way.

### No backend, no build step, no framework

Repeatedly chosen, not an oversight. Anything that needs a server (individual
TBC talents, for example) is parked rather than planned. Do not introduce
bundling, TypeScript, a framework, or a dependency without being asked.

### Ids, never names — the single most repeated bug class here

Warcraft Logs ability *names* are not stable identifiers. Every row below is a
real bug that shipped or was caught late:

| What you would expect | What the log actually says |
|---|---|
| Flask of Distilled Wisdom | `Distilled Wisdom` — the item wording is dropped |
| Elixir of Major Defense | `Major Armor` |
| Super Mana Potion | `Restore Mana` — potions log their EFFECT |
| Dispel Magic Rank 1 (527) | `Purify` — WCL returns the RETAIL name |
| Improved Scorch (22959) | `Critical Mass` — same retail mangling |
| Tears of the Goddess | `Elune's Embrace` (32028) — item name is not spell name |

And one name is often two different things:

- **Netherweave Net** is id `31367` (the item being used) *and* `31460` (the
  tailoring recipe that creates nets). Counting the recipe reads a tailor
  restocking as crowd control.
- **Mark of Kaz'rogal** is `31463` (the explosion, sourced from the player who
  detonated) and `31447` (a harmless mana-drain debuff that deals no damage and
  carries no `sources` array at all).
- A bomb's **cast** id is not its **damage** id (Fel Iron Bomb casts `30216`,
  deals `30310`). The damage id counts targets hit, not bombs thrown.
- Most threat drops appear twice, as the cast and as the aura it applies
  (Invisibility `66` casts / `32612` lands; Misdirection `34477` casts / `35079`
  is the transfer buff, which fires on *every redirected hit* — one cast would
  become dozens of events).

So: **look up by spell id first and fall back to name only as a guard**, and
guard that fallback by ability *source* (see `abilityHostility` in
`js/officer-stats.js`) so a warlock's own Hellfire is never scored as a boss
mechanic. Boss mechanics that collide with player ability names include
Hellfire, Blizzard, Cleave, Whirlwind, Rain of Fire and Consecration.

---

## 2. Working on it

```bash
npm test                      # offline unit tests (node --test), no install needed
npm run smoke                 # live: hits the real API, use sparingly
node --check js/officer.js    # app.js/autopsy.js/officer.js touch `document`
```

`app.js`, `autopsy.js` and `officer.js` reference `document` at module scope, so
they can be syntax-checked but not imported under Node. For live checks, write a
throwaway `test/_probe.mjs`, run it with `node`, and delete it afterwards.

**Deploy = push to `main`.** Pages serves the branch root and goes live in about
a minute. Confirm by polling the *deployed file*, not by a green push.

**The browser will lie to you about your own changes.** Preview browsers cache ES
modules aggressively — reloading, restarting the preview, and switching
`localhost` for `127.0.0.1` all frequently still serve the OLD module. The
symptom is a fix that "doesn't work" in the browser while the served file plainly
contains it. Before trusting any browser result, confirm which code is running:

```js
const url = 'js/officer.js?cb=' + Date.now();
const src = await (await fetch(url, { cache: 'reload' })).text();
src.includes('yourNewFunction');   // is the file you edited the one executing?
```

---

## 3. Rate limit — shared with every visitor of the live site

Warcraft Logs bills **3,600 points per hour**, shared across everyone using the
public site, and charges by query *complexity*, so counting requests understates
the heavy calls. Measured costs:

| action | pts | runs/hour site-wide | |
|---|---|---|---|
| guild attendance (4 pages) | **75** | ~48 | **automatic on officer-tab open** |
| autopsy: open one pull | 31 | ~116 | 10k events |
| deep scan "Analyse night" | 35 | ~103 | opt-in, 34 queries |
| vet a character | 17 | ~210 | |
| officer report card | 5 | ~718 | |
| autopsy: open a report | 1 | ~3529 | |

**Do not loop live queries.** Re-running the deep scan or attendance in a tight
loop can rate-limit the key for every real user. `npm test` is fully offline —
use it. Attendance is the only thing that runs unasked, so it is the first place
to look at an HTTP 429.

---

## 4. Warcraft Logs API contracts (measured, not assumed)

- **A player-keyed table returns only each player's TOP 5 abilities.** Silently,
  no error, regardless of time window. Summing per-fight does not fix it.
- **...but `p.total` is still the TRUE total.** Measured: sum of `total` came to
  11,617,920, matching the ability-keyed view exactly, while the visible rows
  summed to 7,474,345. Percentages must divide by `total`; "simplifying" that to
  sum the visible rows inflates every player's score. Pinned by test and smoke.
- **The fix for truncation is `filterExpression`** — ask for specific ability ids
  in batches of 4 or fewer rather than browsing.
- **`viewBy: Ability` is not truncated**, and is the only view carrying `sources`
  (who dealt an ability). Those `sources` rows carry **no actor id**, only a
  name, and are themselves **capped at the top 5 per ability** — fine for "worst
  offenders", wrong as a complete tally.
- **Ability-keyed tables escape the top-5 cap**: the enemy Debuffs table, and the
  spell-keyed Interrupts and Dispels tables. One query covers a whole night.
- **`actors[0]` means opposite things in the two spell-keyed tables.** In
  Interrupts it is the mob who was casting; in Dispels it is the unit the aura
  came *off*. Printing them identically inverts the meaning of a friendly dispel.
- **Talents:** `playerDetails.combatantInfo.talents` is garbage for TBC. The real
  data is the raw `combatantinfo` event's `talents`, and only as three per-tree
  sums. Individual talents are not in the API for TBC at all.
- **Pre-pull consumables emit no buff events.** Read them from each fight's
  `combatantinfo` `auras` seed; the per-player Buffs *table* intermittently drops
  pre-pull bands.
- **`recentReports { fights }` hangs** once it spans more than two reports (20s
  timeout). Use `playerDetails(startTime/endTime, killType: Encounters)` instead.
- **Guild attendance intermittently hangs for minutes.** Mitigated with one
  retry, a 45s whole-scan deadline, and partial results kept, flagged, and never
  cached.
- Fall damage is ability id `3`, attributed to `Environment` rather than a unit.
- Wowhead has no `/enchantment=` pages; enchants link via `/tbc/spell=`.

Everything goes through `postGraphQL` in `js/wcl.js` (token cache, 401 re-auth,
429 backoff, 20s timeout). Large blobs cache in an in-memory Map; small ones in
localStorage under **versioned keys** — bump the key when a shape changes. Never
cache a failed or partial result: doing so pins the missing data for the whole
session and no retry can recover it.

---

## 5. Authoring the boss-mechanic catalogue

`js/csi/rules.js` classifies boss mechanics as avoidable / chain / frontal, or as
one of the never-blamed categories (soak / tank / raidwide). `js/csi/rule-ids.js`
is generated by `npm run gen:rule-ids`, which harvests real spell ids from live
logs and must not be hand-edited.

**When a mechanic is ambiguous, choose a never-blamed category.** A missing entry
and a `raidwide` entry both cost nothing, while a wrong `avoidable` accuses a
player of a mistake they did not make. Three real near-misses:

- *Aura of Desire* is credited to the player who **took** each tick, so it looks
  player-sourced exactly like a spacing failure. It is unlimited-range and
  ignores line of sight, so nobody can position out of it.
- *Bloodboil* targets the players **furthest** from the boss within a 99-yard
  radius. Being hit by it is the intended rotation.
- *Unquenchable Flames* looks raid-wide, hitting most of the raid, but only burns
  players already standing in Rain of Fire — so it is genuinely avoidable.

The generator refuses an id for any player-sourced ability unless its rule is
`chain`, which is what stops a warlock's own Rain of Fire or a paladin's
Consecration ever blaming a raider. Preserve that behaviour.

**A new raid tier makes this file blind.** Zones auto-detect from
`CURRENT_EXPANSION_ID`, so a tier advance needs no config change — but the
catalogue does, and until it is written the avoidable-damage column and the wipe
autopsy see nothing at all on the new content.

---

## 6. Layout

```
js/          config, wcl, vet, zones, analyze, gearscore, wcl-classes,
             attendance, app, tabs, a11y,
             officer, officer-data, officer-stats,
             consumable-ids (flask/elixir BUFFS), consumable-casts (potions USED),
             utility-casts (nets / innervates / bombs / threat drops CAST;
                            dispels come from the Dispels TABLE, not here),
             raid-debuffs, enchant-{rules,names,spells}, item-sockets, item-2h
js/csi/      parse-url, queries, fetch-report, normalize, deaths, mechanics,
             rules, rule-ids (generated), summary, prep, discord, format, demo
scripts/     gen-rule-ids.mjs   (npm run gen:rule-ids — live spell-id harvest)
test/        csi.test.mjs, officer.test.mjs (offline), smoke.mjs (live)
```

Settings live in `js/config.js`: realm and region, `CURRENT_EXPANSION_ID` and
`ARMORY_FLAVOR` (bump both when the realms advance an expansion),
`ATTENDANCE_MAX_PAGES` (the expensive one), and the cache TTLs.

---

## 7. House style

- Comments explain **why**, especially where the code looks wrong but isn't. Most
  comments here record a measurement or a decision — don't clear them as noise.
- Tests pin **API contracts**, not only logic. A test asserting a number from
  live data is guarding a contract that has silently broken before.
- Degraded data must say so. A failed query renders as "no data", never as a
  confident zero. This matters most in the report card, where an under-reported
  list of offenders reads as an innocent raid.
- Commit messages via `git commit -F <file>`; inline here-strings have silently
  produced broken commits on Windows shells.
