import presentation from "../data/presentation/races.json" with { type: "json" };
import type { Database, Source } from "./model.ts";

export interface RaceMetadata {
  raceId: string;
  nameZh: string;
  foundingYear: number | null;
  foundingSourceId: string | null;
  courseEditionId: string;
  start: string | null;
  finish: string | null;
  turnaround: string | null;
  courseSourceId: string | null;
}

// A course record needs an explicit route version and official evidence. It is
// never inferred from the fastest result in the site's incomplete archive.
export interface OfficialSectionRecord {
  raceId: string;
  courseEditionId: string;
  sectionNumber: number;
  timeSeconds: number;
  holderName: string;
  athleteId: string | null;
  year: number;
  editionId: string | null;
  sourceId: string;
  locator: string;
}

export const raceOrder = ["hakone", "all-japan", "izumo"];
export const raceMetadata = presentation.profiles as RaceMetadata[];
export const raceProfileSources = presentation.sources as Source[];
export const officialSectionRecords =
  presentation.sectionRecords as OfficialSectionRecord[];

/** Observed schedule only: adding a different date cannot preserve a stale claim. */
export function observedSchedule(dates: string[]): string {
  if (!dates.length) return "尚未收录";
  const unique = [...new Set(dates.map((date) => date.slice(5)))].sort();
  const months = [...new Set(unique.map((date) => Number(date.slice(0, 2))))];
  if (unique.length === 1) {
    const [month, day] = unique[0].split("-").map(Number);
    return `${month}月${day}日`;
  }
  if (months.length === 1) {
    const days = unique.map((date) => Number(date.slice(3)));
    return `${months[0]}月${Math.min(...days)}—${Math.max(...days)}日`;
  }
  return months.map((month) => `${month}月`).join(" / ");
}

export function getRaceProfile(
  db: Database,
  raceId: string,
  records: OfficialSectionRecord[] = officialSectionRecords,
) {
  const race = db.races.find((item) => item.id === raceId);
  if (!race) return null;
  const editions = db.editions
    .filter((edition) => edition.raceId === raceId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const latest = editions[0] ?? null;
  const metadata = raceMetadata.find((item) => item.raceId === raceId) ?? null;
  const courseMetadata =
    metadata?.courseEditionId === latest?.id ? metadata : null;
  const sections = db.sections
    .filter((section) => section.editionId === latest?.id)
    .sort((a, b) => a.number - b.number)
    .map((section) => ({
      ...section,
      record:
        records.find(
          (record) =>
            record.raceId === raceId &&
            record.courseEditionId === latest?.id &&
            record.sectionNumber === section.number,
        ) ?? null,
    }));
  const archive = editions.map((edition) => {
    const entries = db.entries.filter(
      (entry) => entry.editionId === edition.id,
    );
    const entryIds = new Set(entries.map((entry) => entry.id));
    const winners = entries
      .filter(
        (entry) =>
          entry.finalRank === 1 &&
          entry.status === "finished" &&
          entry.rankingEligibility !== "reference",
      )
      .map((entry) => ({
        entry,
        university:
          db.universities.find((item) => item.id === entry.universityId) ??
          null,
        team: db.teams.find((item) => item.id === entry.teamId)!,
      }));
    return {
      edition,
      teams: entries.length,
      results: db.results.filter((result) => entryIds.has(result.entryId))
        .length,
      winners,
    };
  });
  const sourceIds = new Set([
    ...(latest ? [latest.sourceId] : []),
    ...sections.map((section) => section.sourceId),
    ...sections.flatMap((section) =>
      section.record ? [section.record.sourceId] : [],
    ),
    ...archive.flatMap(({ winners }) =>
      winners.flatMap(({ entry }) =>
        [entry.finalRankSourceId, entry.totalTimeSourceId].filter(
          (id): id is string => !!id,
        ),
      ),
    ),
    ...(metadata?.foundingSourceId ? [metadata.foundingSourceId] : []),
    ...(courseMetadata?.courseSourceId ? [courseMetadata.courseSourceId] : []),
  ]);
  return {
    race,
    metadata,
    courseMetadata,
    editions,
    latest,
    sections,
    archive,
    schedule: observedSchedule(
      editions.flatMap((edition) =>
        edition.endDate ? [edition.date, edition.endDate] : [edition.date],
      ),
    ),
    sources: [...db.sources, ...raceProfileSources].filter((source) =>
      sourceIds.has(source.id),
    ),
  };
}
