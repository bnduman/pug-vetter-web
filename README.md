# PuG Vetter (web)

Static, **fully client-side** raid-leader console for WoW **Classic
Anniversary** (TBC). Three tabs, no server, no build step — plain HTML + ES
modules talking straight to the [Warcraft Logs](https://classic.warcraftlogs.com)
v2 API (it sends CORS headers, so this works from any static host, e.g.
**GitHub Pages**).

## ⚔️ PuG Vetter

Type a character name and get, at a glance:

- **Raid clears** (boss kill counts per current raid) and **best performance
  average** per raid, colour-coded like Warcraft Logs
- **GearScore** (same calculation as classic-armory.org), with **both gear
  sets** for dual-role players (tank + dps)
- **Enchant check** with **TBC-correct enchant names**, gem counts, avg ilvl,
  Wowhead links for every item/gem/enchant
- **Warcraft Logs + Armory links** on every card, straight to the player's
  profile pages
- **"Raided with me"** — how many of *your* logged raids each player attended
  (relative to `ME_NAME`), plus a **My regulars** list of repeat co-raiders.
  Same-person characters are bundled via `ALTS` in config.
- **Roster builder** — add vetted players, drag them into groups of 5

## 🔍 Wipe Autopsy

Paste a WCL report URL and get a per-wipe diagnosis: a 20-second death-recap
timeline (healer sources, HP% per event, killing blow, defensive cooldowns),
boss-mechanic blame via a spell-ID catalogue harvested from live logs, a
primary-cause verdict, per-pull raid-prep (flask/elixir-pair/food + enchants),
and a copy-for-Discord summary.

## 🛡️ Officer

Guild tools (uses `GUILD_NAME` from config): pick any of the guild's recent
logs for a **raid-prep report card** — per raider spec, per-pull flask/food,
enchant gaps, Discord shame-list export — plus an **attendance roster** with
percentages, streaks, and "fading regular" warnings.

---

This is the static sibling of [pug-vetter](https://github.com/bnduman/pug-vetter)
(the Python/Flask version, which also holds the enchant-name refresh pipeline).

## Use it

Open the GitHub Pages URL, type a name, hit **Vet**. The realm/region are fixed
in [js/config.js](js/config.js) (currently Thunderstrike-EU).

## Run locally

On Windows just double-click **`start-local.bat`**. Otherwise: ES modules
don't load from `file://`, so serve the folder with any static server:

```bash
python -m http.server 8090      # then open http://localhost:8090
```

## Tests (Node 18+)

```bash
npm test                  # offline unit tests (autopsy engine + officer math)
node test/smoke.mjs [name]  # live smoke test of the lookup logic
```

## Fork it for your own realm

1. Create a Warcraft Logs API client at <https://www.warcraftlogs.com/api/clients/>
   — leave **"Public Client" unchecked** (you need a client secret).
2. Edit [js/config.js](js/config.js): your client id/secret, realm, region,
   guild, `ME_NAME` (your main, for "raided with me"), and `ALTS`.
3. Enable GitHub Pages: repo **Settings → Pages → Deploy from a branch →
   `main` / `/ (root)`**.

## Things to know

- **The client secret in `js/config.js` is public by design.** This is an
  informed trade-off: the key is free-tier, grants nothing but API reads, and
  can be deleted/recreated in seconds if abused. Don't reuse a secret you care
  about.
- **All visitors share one rate limit** (3,600 points/hour on a free WCL
  client). Lookups are cached in each browser (localStorage, 10 min) to soften
  this, but there's no shared cache between visitors.
- **Only logged characters appear.** "No data" means "never logged on Warcraft
  Logs", not "never raided".
- **Enchant names are TBC-correct.** WCL's own labels are retail-mangled (wrong
  magnitudes, renamed stats); [js/enchant-names.js](js/enchant-names.js) maps
  enchant IDs to the real in-game names from the Anniversary client database.
- **When the realms advance to Wrath**, bump `CURRENT_EXPANSION_ID` in
  [js/config.js](js/config.js) (1001 → 1002) and `ARMORY_FLAVOR`
  (`tbc-anniversary` → the WotLK flavor). New raid tiers within an expansion
  appear automatically. The boss-mechanic catalogue regenerates with
  `npm run gen:rule-ids`.
