"use strict";
// GraphQL queries for fetching + normalizing a WCL report (Wipe Autopsy tab).

// Report metadata: title/owner/zone, actor + ability dictionaries, and the
// boss-encounter fights (kills + wipes, no trash). Events ride a separate query.
export const REPORT_META_QUERY = `
query($code: String!) {
  reportData {
    report(code: $code) {
      title
      startTime
      endTime
      owner { name }
      zone { name }
      masterData(translate: true) {
        actors { id name type subType }
        abilities { gameID name }
      }
      fights(killType: Encounters) {
        id
        name
        encounterID
        kill
        difficulty
        startTime
        endTime
        bossPercentage
      }
    }
  }
}
`;

// One page of one event stream for one fight. `data` is a JSON array of raw
// events; `nextPageTimestamp` drives pagination (loop until it's null).
export const REPORT_EVENTS_QUERY = `
query($code: String!, $fightID: Int!, $start: Float!, $end: Float!, $dataType: EventDataType!) {
  reportData {
    report(code: $code) {
      events(
        fightIDs: [$fightID]
        startTime: $start
        endTime: $end
        dataType: $dataType
        hostilityType: Friendlies
        includeResources: true
        limit: 10000
      ) {
        data
        nextPageTimestamp
      }
    }
  }
}
`;

// Roles + specs + per-player gear (for the enchant check) for a fight.
export const PLAYER_DETAILS_QUERY = `
query($code: String!, $fightIDs: [Int]!) {
  reportData {
    report(code: $code) {
      playerDetails(fightIDs: $fightIDs, includeCombatantInfo: true)
    }
  }
}
`;

// Raw combatantinfo events for a fight — one per player, carrying the talent
// tree point totals (WCL's playerDetails.combatantInfo.talents is broken for
// TBC; this raw event has the real per-tree sums + specID).
export const COMBATANT_INFO_QUERY = `
query($code: String!, $fightID: Int!, $start: Float!, $end: Float!) {
  reportData {
    report(code: $code) {
      events(fightIDs: [$fightID], startTime: $start, endTime: $end, dataType: CombatantInfo, limit: 100) {
        data
      }
    }
  }
}
`;

// One player's buffs for a fight (sourceID-filtered) — used to read their
// specific flask/elixir/food. Pre-pull consumables don't emit per-player
// events, so the per-source buffs table is the only reliable source; we fetch
// it once per player (concurrency-limited) when a pull is opened.
export const PLAYER_BUFFS_QUERY = `
query($code: String!, $fightID: Int!, $start: Float!, $end: Float!, $sourceID: Int!) {
  reportData {
    report(code: $code) {
      table(fightIDs: [$fightID], startTime: $start, endTime: $end, dataType: Buffs, hostilityType: Friendlies, sourceID: $sourceID)
    }
  }
}
`;
