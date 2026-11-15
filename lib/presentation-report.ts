import { editionPresentations, allSources } from "./presentation.ts";
import { buildEditionScoreboard } from "./scoreboard.ts";
import { officialSectionRecords } from "./race-profile.ts";
import type { Database } from "./model.ts";
export function presentationReport(db: Database) {
  const editions = db.editions.map((edition) => {
    const supplement = editionPresentations.find((data) => data.editionId === edition.id);
    const rows = db.sections.filter((section) => section.editionId === edition.id)
      .flatMap((section) => buildEditionScoreboard(db, edition.id, section.number)!.rows);
    const counts = { official: 0, calculated: 0, missing: 0, officialTimeWithoutRank: 0 };
    for (const row of rows) {
      const {mode, rank} = row.cumulative;
      counts[mode === "unavailable" ? "missing" : mode]++;
      if (mode === "official" && rank === null) counts.officialTimeWithoutRank++;
    }
    const sourceIds = new Set([...(supplement?.cumulative.map((p) => p.sourceId) ?? []), ...(supplement?.honors.map((h) => h.sourceId) ?? [])]);
    return {
      editionId: edition.id, editionNumber: edition.number, results: rows.length,
      cumulative: counts,
      sectionAwards: supplement?.honors.filter((h) => h.type === "section-award").length ?? 0,
      sectionRecords: supplement?.honors.filter((h) => h.type === "section-record").length ?? 0,
      sectionRecordTies: supplement?.honors.filter((h) => h.type === "section-record-tie").length ?? 0,
      gaps: supplement?.notes ?? ["No reviewed supplement"],
      sources: allSources(db).filter((s) => sourceIds.has(s.id)).map(({id,url,revision,locator}) => ({id,url,revision,locator})),
    };
  });
  return {
    schemaVersion: 1,
    rankingBasis: "Official cumulative elapsed ranking, never road passage order; null ranks remain unknown/ineligible",
    editions,
    currentRecords: db.races.map((race) => {
      const records = officialSectionRecords.filter((r) => r.raceId === race.id);
      return { raceId: race.id, courseVersion: records[0]?.courseVersion ?? null, sections: new Set(records.map((r) => r.sectionNumber)).size, holders: records.length, linkedHolders: records.filter((r) => r.athleteId !== null).length, sources: [...new Set(records.map((r) => r.sourceId))] };
    }),
    totals: {
      editions: editions.length, results: db.results.length,
      officialCumulative: editions.reduce((n,e) => n + e.cumulative.official,0),
      calculatedCumulative: editions.reduce((n,e) => n + e.cumulative.calculated,0),
      missingCumulative: editions.reduce((n,e) => n + e.cumulative.missing,0),
      sectionAwards: editions.reduce((n,e) => n + e.sectionAwards,0),
      sectionRecords: editions.reduce((n,e) => n + e.sectionRecords,0),
      sectionRecordTies: editions.reduce((n,e) => n + e.sectionRecordTies,0),
    },
  };
}
