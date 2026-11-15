import { allSources } from "./presentation.ts";
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
  id: string;
  courseVersion: string;
  distanceKm: number;
  universityName: string;
  universityId: string | null;
  editionNumber: number;
  resultId: string | null;
  revision: string;
  reviewedAt: string;
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
      records: records.filter(
        (record) => record.raceId === raceId && record.courseEditionId === latest?.id && record.sectionNumber === section.number,
      ),
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
      section.records.map((record) => record.sourceId),
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
    courseVersion: presentation.courseVersions.find((version) => version.raceId === raceId && version.courseEditionId === latest?.id) ?? null,
    editions,
    latest,
    sections,
    archive,
    schedule: observedSchedule(
      editions.flatMap((edition) =>
        edition.endDate ? [edition.date, edition.endDate] : [edition.date],
      ),
    ),
    sources: [...allSources(db), ...raceProfileSources].filter((source) =>
      sourceIds.has(source.id),
    ),
  };
}

/** Records are evidence about a specific course version, not sample minima. */
export function validateSectionRecords(db: Database, records: OfficialSectionRecord[] = officialSectionRecords): void {
  const fail = (message: string): never => { throw new Error(`Section record: ${message}`); };
  const ids = new Set<string>();
  const holders = new Set<string>();
  const times = new Map<string, number>();
  const sources = new Set([...allSources(db), ...raceProfileSources].map((s) => s.id));
  for (const record of records) {
    if (!record.id || ids.has(record.id)) fail("duplicate/missing ID");
    ids.add(record.id);
    const route = presentation.courseVersions.find((v) => v.id === record.courseVersion);
    if (!route || route.raceId !== record.raceId || route.courseEditionId !== record.courseEditionId || !sources.has(route.sourceId)) fail("invalid route version");
    const section = db.sections.find((s) => s.editionId === record.courseEditionId && s.number === record.sectionNumber);
    if (!section || section.distanceKm !== record.distanceKm) fail("route distance mismatch");
    const key = `${record.courseVersion}/${record.sectionNumber}`;
    if (times.has(key) && times.get(key) !== record.timeSeconds) fail("co-holder time conflict");
    times.set(key, record.timeSeconds);
    const holderKey = `${key}/${record.athleteId ?? record.holderName}/${record.universityName}/${record.year}`;
    if (holders.has(holderKey)) fail("duplicate holder");
    holders.add(holderKey);
    if (!Number.isSafeInteger(record.timeSeconds) || record.timeSeconds <= 0 || !Number.isSafeInteger(record.year) || !Number.isSafeInteger(record.editionNumber) || record.editionNumber < 1 || !record.holderName || !record.universityName || !record.locator || !record.revision || !record.reviewedAt || !sources.has(record.sourceId)) fail("missing/invalid fact or evidence");
    if (record.universityId && !db.universities.some((u) => u.id === record.universityId)) fail("unknown university");
    if (record.athleteId && !db.athletes.some((a) => a.id === record.athleteId)) fail("unknown athlete");
    if (record.editionId && !db.editions.some((e) => e.id === record.editionId && e.raceId === record.raceId && e.year === record.year && e.number === record.editionNumber)) fail("edition mismatch");
    if (record.resultId) {
      const result = db.results.find((r) => r.id === record.resultId);
      const entry = result && db.entries.find((e) => e.id === result.entryId);
      const leg = result && db.sections.find((s) => s.id === result.sectionId);
      if (!result || !entry || !leg || entry.editionId !== record.editionId || leg.number !== record.sectionNumber || result.athleteId !== record.athleteId || entry.universityId !== record.universityId || result.timeSeconds !== record.timeSeconds || entry.rankingEligibility === "reference" || entry.status !== "finished") fail("invalid result association/eligibility");
    } else if (record.athleteId) fail("athlete link requires an evidenced result, not name matching");
  }
}
