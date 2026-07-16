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

  // Your guild — the source of raid logs for the "raided with me" check
  // (uses WCL guild attendance). Leave GUILD_NAME empty ("") to hide it.
  GUILD_NAME: "SEND IT",
  GUILD_REALM: "Thunderstrike",
  GUILD_REGION: "EU",
  // Your main character. "Raided with me" counts shared raids with THIS
  // character (must appear in the guild's logs). Empty -> falls back to
  // plain guild attendance.
  ME_NAME: "Sahmeran",
  // How many attendance pages to scan (25 raids per page).
  ATTENDANCE_MAX_PAGES: 4,
  ATTENDANCE_TTL_SECONDS: 21600, // refresh guild history every 6h

  // How long to cache lookups/zones in the browser, to spare the shared
  // WCL rate limit (3,600 points/hour across ALL visitors of this page).
  LOOKUP_TTL_SECONDS: 600,
  ZONES_TTL_SECONDS: 86400,
};
