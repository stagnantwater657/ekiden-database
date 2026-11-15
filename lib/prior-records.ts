import { allSources } from "./presentation.ts";
import data from "../data/presentation/prior-records.json" with { type: "json" };
import { courseVersions } from "./race-profile.ts";
import type { Database } from "./model.ts";

/**
 * A record in force when an edition started. It is deliberately separate from
 * `OfficialSectionRecord` (the current record of a route version): an edition
 * page must never show a time set after that edition began.
 */
export type PriorRecordStatus = "verified" | "unverified" | "not-applicable";

export interface PriorRecordHolder {
  holderName: string;
  universityName: string;
  universityId: string | null;
  athleteId: string | null;
  year: number;
  editionNumber: number;
  editionId: string | null;
  resultId: string | null;
}

export interface PriorSectionRecord {
  id: string;
  raceId: string;
  editionId: string;
  sectionNumber: number;
  courseEditionId: string;
  courseVersion: string;
  status: PriorRecordStatus;
  timeSeconds: number | null;
  holders: PriorRecordHolder[];
  sourceId: string | null;
  locator: string | null;
  revision: string | null;
  reviewedAt: string | null;
  note: string | null;
}

export const raceNotes = (data as { raceNotes: Record<string, string> }).raceNotes;
export const priorSectionRecords = (data as { records: PriorSectionRecord[] })
  .records;

export function priorRecordFor(
  editionId: string,
  sectionNumber: number,
  records: PriorSectionRecord[] = priorSectionRecords,
): PriorSectionRecord | null {
  return (
    records.find(
      (record) =>
        record.editionId === editionId &&
        record.sectionNumber === sectionNumber,
    ) ?? null
  );
}

function fail(message: string): never {
  throw new Error(`Prior record: ${message}`);
}

/**
 * Facts must predate the edition they are shown on, belong to the same physical
 * route, and carry provenance. Co-holders share one time; a linked result must
 * be that holder's own run at that time, never a name match.
 */
export function validatePriorRecords(
  db: Database,
  records: PriorSectionRecord[] = priorSectionRecords,
  extraSources: { id: string }[] = [],
): void {
  const sources = new Set(
    [...allSources(db), ...extraSources].map((source) => source.id),
  );
  const seen = new Set<string>();
  for (const record of records) {
    const edition = db.editions.find((item) => item.id === record.editionId);
    if (!edition || edition.raceId !== record.raceId) fail("unknown edition/race");
    const key = `${record.editionId}/${record.sectionNumber}`;
    if (seen.has(key)) fail("duplicate edition/section");
    seen.add(key);
    const section = db.sections.find(
      (item) =>
        item.editionId === record.editionId &&
        item.number === record.sectionNumber,
    );
    if (!section) fail("unknown section");
    const route = courseVersions.find((item) => item.id === record.courseVersion);
    if (!route || route.raceId !== record.raceId) fail("invalid route version");
    if (record.courseEditionId !== record.editionId) fail("route must be the edition's own route");
    const routeSection = db.sections.find(
      (item) =>
        item.editionId === route.courseEditionId &&
        item.number === record.sectionNumber,
    );
    if (!routeSection || routeSection.distanceKm !== section.distanceKm)
      fail("route distance mismatch");
    if (record.status === "verified") {
      if (!Number.isSafeInteger(record.timeSeconds) || record.timeSeconds! <= 0)
        fail("invalid record time");
      if (!record.holders.length) fail("missing holder");
      if (
        !record.sourceId ||
        !sources.has(record.sourceId) ||
        !record.locator ||
        !record.revision ||
        !record.reviewedAt
      )
        fail("missing provenance");
      for (const holder of record.holders) {
        if (!holder.holderName || !holder.universityName) fail("missing holder identity");
        if (
          holder.universityId &&
          !db.universities.some((item) => item.id === holder.universityId)
        )
          fail("unknown university");
        if (
          !Number.isSafeInteger(holder.editionNumber) ||
          holder.editionNumber < 1 ||
          holder.editionNumber >= edition.number
        )
          fail("holder edition is not before the viewed edition");
        if (!Number.isSafeInteger(holder.year) || holder.year >= edition.year)
          fail("holder year is not before the viewed edition");
        if (holder.athleteId) {
          const result = holder.resultId
            ? db.results.find((item) => item.id === holder.resultId)
            : null;
          const entry = result && db.entries.find((item) => item.id === result.entryId);
          const leg = result && db.sections.find((item) => item.id === result.sectionId);
          if (
            !result ||
            !entry ||
            !leg ||
            result.athleteId !== holder.athleteId ||
            result.timeSeconds !== record.timeSeconds ||
            entry.editionId !== holder.editionId ||
            leg.number !== record.sectionNumber ||
            entry.universityId !== holder.universityId
          )
            fail("invalid holder result link");
        } else if (holder.resultId) fail("result link requires an athlete link");
      }
    } else {
      if (record.timeSeconds !== null || record.holders.length || record.sourceId)
        fail("unverified record must not carry facts");
      if (!record.note) fail("unverified record needs a reason");
    }
  }
}
