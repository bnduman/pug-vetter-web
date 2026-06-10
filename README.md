# PuG Vetter (web)

Static, **fully client-side** PuG vetting tool for WoW **Classic Anniversary**
raid leaders. Type a character name and get, at a glance:

- **Raid clears** (boss kill counts per current raid)
- **Best performance average** per raid, colour-coded like Warcraft Logs
- **Enchant check** with **TBC-correct enchant names**, gem counts, avg ilvl

No server, no build step — plain HTML + ES modules. The browser talks straight
to the [Warcraft Logs](https://classic.warcraftlogs.com) v2 API (it sends CORS
headers, so this works from any static host, e.g. **GitHub Pages**).

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

Live smoke test of the lookup logic (Node 18+):

```bash
node test/smoke.mjs [name]
```

## Fork it for your own realm

1. Create a Warcraft Logs API client at <https://www.warcraftlogs.com/api/clients/>
   — leave **"Public Client" unchecked** (you need a client secret).
2. Edit [js/config.js](js/config.js): your client id/secret, realm, region.
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
  [js/config.js](js/config.js) (1001 → 1002). New raid tiers within an
  expansion appear automatically.
