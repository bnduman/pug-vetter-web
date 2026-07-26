// All user-tweakable settings live here.
//
// NOTE: this is a fully client-side app, so the Warcraft Logs client secret is
// public by design (an informed choice for this free-tier key — worst case
// someone burns the shared rate limit and the key gets recreated). If you fork
// this, create your own client at https://www.warcraftlogs.com/api/clients/
// (leave "Public Client" UNCHECKED) and put your own id/secret here.

export const CONFIG = {
  WCL_CLIENT_ID: "a1fbfd44-d145-4121-a079-2d0b61968abb",
  WCL_CLIENT_SECRET: "ibK89mLZTMTLoBWM5MBvnzgIdwVr2eTCe85k5dLf",

  TOKEN_URL: "https://www.warcraftlogs.com/oauth/token",
  // The classic site serves Classic/Era/Anniversary data; retail lives on www.
  API_URL: "https://classic.warcraftlogs.com/api/v2/client",

  // The realm this instance is locked to (the form only asks for a name).
  REALM: "Thunderstrike",
  REGION: "EU",

  // Which WCL expansion the Anniversary realms are currently in:
  // 1000 Classic · 1001 TBC · 1002 Wrath · 1003 Cata · 1004 MoP.
  // Bump this when the realms advance; the live raids are auto-detected.
  CURRENT_EXPANSION_ID: 1001,
  // Hard override: if non-empty, these exact zone IDs are used verbatim.
  RAID_ZONE_IDS: [],
  // Aggregate / non-raid zones to skip when auto-detecting.
  EXCLUDE_ZONE_PATTERNS: ["Complete Raid", "Heroic Dungeon", "Challenge Mode"],

  // classic-armory.org "flavor" segment for the per-character Armory links
  // (https://classic-armory.org/character/<region>/<flavor>/<realm>/<name>).
  // Tracks the realms' current content — bump alongside CURRENT_EXPANSION_ID
  // when the Anniversary realms advance (e.g. to "wotlk-anniversary").
  ARMORY_FLAVOR: "tbc-anniversary",

  // Your guild — the source of raid logs for the "raided with me" check
  // (uses WCL guild attendance). Leave GUILD_NAME empty ("") to hide it.
  GUILD_NAME: "SEND IT",
  GUILD_REALM: "Thunderstrike",
  GUILD_REGION: "EU",
  // Your main character. "Raided with me" counts shared raids with THIS
  // character (must appear in the guild's logs). Empty -> falls back to
  // plain guild attendance.
  ME_NAME: "Sahmeran",
  // Characters that belong to the same person: MAIN -> [alts...]. Attendance,
  // "raided with me", and the officer roster count them as one player. WCL
  // has no public character->account link, so this is maintained by hand.
  ALTS: {
    Sahmeran: ["Hayvann"],
    Shynead: ["Shynad"],
  },
  // How many of the newest guild reports the officer attendance roster
  // grades against ("attended 12 of the last 20"). 0 = all scanned reports.
  OFFICER_ROSTER_REPORTS: 20,
  // How many attendance pages to scan (25 raids per page). This is the single
  // most expensive thing the site does — see the budget below before raising it.
  ATTENDANCE_MAX_PAGES: 4,
  ATTENDANCE_TTL_SECONDS: 21600, // refresh guild history every 6h

  // How long to cache lookups/zones in the browser, to spare the shared
  // WCL rate limit (3,600 points/hour across ALL visitors of this page).
  //
  // MEASURED COST PER ACTION (2026-07-25, live, points not queries — WCL bills
  // query complexity, so counting requests understates the heavy ones):
  //
  //   guild attendance, 4 pages   75 pts   ~48/hour site-wide   AUTOMATIC
  //   autopsy: open one pull      31 pts  ~116/hour             10k events
  //   deep scan "Analyse night"   20 pts  ~180/hour             opt-in, 21 queries
  //   vet a character             17 pts  ~210/hour
  //   officer report card          5 pts  ~718/hour
  //   autopsy: open a report       1 pt  ~3529/hour
  //
  // The ranking is worth internalising: attendance costs 15x a report card and
  // is the ONE thing that runs without being asked for (on opening the officer
  // tab). It's cached for 6h per browser, so the exposure is new visitors, not
  // repeat use — comfortable for a guild-sized audience, and the first thing to
  // look at if the key ever starts hitting 429s.
  //
  // Not "optimised" deliberately: those 4 pages are shared with the vetter's
  // "raided with me", which wants deep history. Fetching fewer pages for the
  // officer tab would just make a user who visits both tabs pay twice.
  LOOKUP_TTL_SECONDS: 600,
  ZONES_TTL_SECONDS: 86400,
};
