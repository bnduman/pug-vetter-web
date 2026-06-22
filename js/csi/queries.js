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
        fightPercentage
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

// Roles + specs for a fight (combatant info omitted — only tank/healer/dps).
export const PLAYER_DETAILS_QUERY = `
query($code: String!, $fightIDs: [Int]!) {
  reportData {
    report(code: $code) {
      playerDetails(fightIDs: $fightIDs, includeCombatantInfo: false)
    }
  }
}
`;
