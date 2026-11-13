import { database as dataset } from "../data/index.ts";
import { seasonYearFor } from "./seasons.ts";
import { validateIdentity, normalizeName } from "./identity.ts";
import type { Database, ResultRow } from "./model.ts";
import type { Filters } from "./query.ts";

export function validateDatabase(db: Database): void {
  if (db.schemaVersion !== 2) throw new Error("Unsupported data version");
  const groups = [
    db.sources,
    db.races,
    db.editions,
    db.sections,
    db.universities,
    db.athletes,
    db.teams,
    db.entries,
    db.results,
  ];
  const allIds = groups.flat().map((x) => x.id);
  if (new Set(allIds).size !== allIds.length)
    throw new Error("Duplicate global entity ID");
  const has = (group: { id: string }[], id: string) =>
    group.some((x) => x.id === id);
  for (const group of groups.slice(1))
    for (const item of group)
      if (!("sourceId" in item) || !has(db.sources, item.sourceId as string))
        throw new Error("Missing source");
  for (const source of db.sources)
    if (
      !/^https:\/\//.test(source.url) ||
      !Number.isFinite(Date.parse(source.collectedAt))
    )
      throw new Error("Invalid source metadata");
  for (const edition of db.editions)
    if (!has(db.races, edition.raceId)) throw new Error("Missing race");
  for (const section of db.sections)
    if (!has(db.editions, section.editionId))
      throw new Error("Missing edition");
  for (const entry of db.entries)
    if (
      !has(db.editions, entry.editionId) ||
      !has(db.teams, entry.teamId) ||
      (entry.universityId !== null && !has(db.universities, entry.universityId))
    )
      throw new Error("Invalid entry");
  for (const entry of db.entries) {
    if (
      entry.finalRank !== null &&
      (!Number.isSafeInteger(entry.finalRank) ||
        entry.finalRank <= 0 ||
        !entry.finalRankSourceId)
    )
      throw new Error("Invalid final rank");
    if (
      entry.finalRankSourceId !== null &&
      !has(db.sources, entry.finalRankSourceId)
    )
      throw new Error("Missing final rank source");
  }
  const statuses = new Set([
    "finished",
    "reference",
    "unranked",
    "disqualified",
    "did-not-finish",
    "did-not-start",
    "unknown",
  ]);
  for (const edition of db.editions) {
    if (
      !Number.isInteger(edition.seasonYear) ||
      !Number.isInteger(edition.number) ||
      edition.number < 1 ||
      !Number.isFinite(Date.parse(edition.date)) ||
      !Number.isFinite(edition.distanceKm) ||
      edition.distanceKm <= 0 ||
      edition.year !== Number(edition.date.slice(0, 4))
    )
      throw new Error("Invalid season/date");
    if (
      ["hakone", "all-japan", "izumo"].includes(edition.raceId) &&
      edition.seasonYear !== seasonYearFor(edition.raceId, edition.year)
    )
      throw new Error("Wrong season assignment");
    const sections = db.sections.filter((s) => s.editionId === edition.id);
    if (
      new Set(sections.map((s) => s.number)).size !== sections.length ||
      sections.some(
        (s) =>
          !Number.isInteger(s.number) ||
          s.number < 1 ||
          s.distanceKm === null ||
          !Number.isFinite(s.distanceKm) ||
          s.distanceKm <= 0,
      )
    )
      throw new Error("Invalid sections");
    if (
      Math.abs(
        sections.reduce((sum, s) => sum + s.distanceKm!, 0) -
          edition.distanceKm,
      ) > 0.001
    )
      throw new Error("Distance mismatch");
  }
  for (const team of db.teams) {
    if (
      !["university", "association-selection", "overseas-selection"].includes(
        team.kind,
      )
    )
      throw new Error("Unknown team kind");
    if (
      team.kind === "university"
        ? !team.universityId || !has(db.universities, team.universityId)
        : team.universityId !== null
    )
      throw new Error("Invalid team type");
  }
  const teamSlots = new Set<string>();
  for (const entry of db.entries) {
    if (!statuses.has(entry.status)) throw new Error("Unknown entry status");
    const team = db.teams.find((t) => t.id === entry.teamId)!;
    if (entry.universityId !== team.universityId)
      throw new Error("Entry/team affiliation mismatch");
    if (
      (team.kind !== "university" || entry.status !== "finished") &&
      entry.finalRank !== null
    )
      throw new Error("Non-official entry cannot have final rank");
    const slot = entry.editionId + "/" + entry.teamId;
    if (teamSlots.has(slot)) throw new Error("Duplicate team entry");
    teamSlots.add(slot);
    if (
      entry.totalTimeSeconds !== null &&
      (!Number.isSafeInteger(entry.totalTimeSeconds) ||
        entry.totalTimeSeconds <= 0 ||
        !entry.totalTimeSourceId ||
        !has(db.sources, entry.totalTimeSourceId))
    )
      throw new Error("Invalid official team time");
  }
  const decisions = new Map(db.identities.map((i) => [i.recordId, i]));
  if (decisions.size !== db.identities.length)
    throw new Error("Duplicate identity decision");
  for (const decision of db.identities) {
    validateIdentity(
      decision,
      db.athletes,
      new Set(db.sources.map((s) => s.id)),
    );
    if (!has(db.results, decision.recordId))
      throw new Error("Orphan identity decision");
  }
  const slots = new Set<string>();
  const runners = new Set<string>();
  for (const result of db.results) {
    const entry = db.entries.find((x) => x.id === result.entryId);
    const section = db.sections.find((x) => x.id === result.sectionId);
    if (
      !entry ||
      !section ||
      section.editionId !== entry.editionId ||
      !has(db.athletes, result.athleteId)
    )
      throw new Error("Invalid result relation");
    if (result.status && !statuses.has(result.status))
      throw new Error("Unknown section status");
    const decision = decisions.get(result.id);
    if (!decision || decision.athleteId !== result.athleteId)
      throw new Error("Missing result identity decision");
    if (
      result.grade !== undefined &&
      result.grade !== null &&
      !/^(?:[1-6]|M[1-3]|D[1-6])$/.test(result.grade)
    )
      throw new Error("Invalid participation grade");
    if (
      result.participationSourceId &&
      !has(db.sources, result.participationSourceId)
    )
      throw new Error("Unknown participation source");
    if (result.grade && !result.participationSourceId)
      throw new Error("Missing grade source");
    if (
      result.representingUniversityId &&
      !has(db.universities, result.representingUniversityId)
    )
      throw new Error("Unknown participation university");
    if (
      result.status &&
      ["disqualified", "did-not-finish", "did-not-start"].includes(
        result.status,
      ) &&
      result.rank !== null
    )
      throw new Error("Invalid section status/rank");
    const slot = `${entry.id}/${section.id}`;
    const runner = `${entry.editionId}/${result.athleteId}`;
    if (slots.has(slot) || runners.has(runner))
      throw new Error("Duplicate result");
    slots.add(slot);
    runners.add(runner);
    for (const value of [result.timeSeconds, result.rank])
      if (value !== null && (!Number.isSafeInteger(value) || value <= 0))
        throw new Error("Invalid result value");
  }
}
export function createFileRepository(db: Database) {
  validateDatabase(db);
  const rows: ResultRow[] = db.results.map((result) => {
    const entry = db.entries.find((x) => x.id === result.entryId)!;
    const edition = db.editions.find((x) => x.id === entry.editionId)!;
    return {
      ...result,
      entry,
      edition,
      race: db.races.find((x) => x.id === edition.raceId)!,
      section: db.sections.find((x) => x.id === result.sectionId)!,
      university:
        db.universities.find((x) => x.id === entry.universityId) ?? null,
      team: db.teams.find((x) => x.id === entry.teamId)!,
      athlete: db.athletes.find((x) => x.id === result.athleteId)!,
      source: db.sources.find((x) => x.id === result.sourceId)!,
    };
  });
  return {
    async catalog() {
      return db;
    },
    async search(filters: Filters) {
      const normalize = normalizeName;
      const matched = rows.filter(
        (row) =>
          (!filters.race || row.race.id === filters.race) &&
          (!filters.edition || row.edition.id === filters.edition) &&
          (!filters.year || String(row.edition.year) === filters.year) &&
          (!filters.season ||
            String(row.edition.seasonYear) === filters.season) &&
          (!filters.team || row.team.id === filters.team) &&
          (!filters.university || row.university?.id === filters.university) &&
          (!filters.section ||
            String(row.section.number) === filters.section) &&
          (!filters.athlete || row.athlete.id === filters.athlete) &&
          (!filters.q ||
            [row.athlete.name, ...(row.athlete.aliases ?? [])].some((name) =>
              normalize(name).includes(normalize(filters.q)),
            )),
      );
      matched.sort(compareResults(filters));
      // Summaries describe the entire filtered result, not only this page.
      const sourceIds = new Set(
        matched
          .flatMap((row) => [
            row.sourceId,
            row.entry.finalRankSourceId,
            row.entry.totalTimeSourceId,
            row.participationSourceId ?? null,
          ])
          .filter((id): id is string => id !== null),
      );
      const editions = [
        ...new Map(
          matched.map((row) => [
            row.edition.id,
            { ...row.edition, race: row.race },
          ]),
        ).values(),
      ];
      const pageCount = Math.max(
        1,
        Math.ceil(matched.length / filters.pageSize),
      );
      const page = Math.min(filters.page, pageCount);
      return {
        rows: matched.slice(
          (page - 1) * filters.pageSize,
          page * filters.pageSize,
        ),
        total: matched.length,
        editions,
        sources: db.sources.filter((source) => sourceIds.has(source.id)),
        page,
        pageCount,
      };
    },
  };
}
export type EkidenRepository = ReturnType<typeof createFileRepository>;
// Async contract lets a PostgreSQL adapter replace this implementation without page changes.
let repository: EkidenRepository | undefined;
export function getRepository(): EkidenRepository {
  return (repository ??= createFileRepository(dataset));
}

function compareNullable(
  a: number | null,
  b: number | null,
  direction = 1,
): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return (a - b) * direction;
}
// Always isolate editions, even for manual sorting. All ties end in a stable ID.
export function compareResults(
  filters: Filters,
): (a: ResultRow, b: ResultRow) => number {
  const editionOrder = (a: ResultRow, b: ResultRow) =>
    a.race.id.localeCompare(b.race.id) ||
    a.edition.year - b.edition.year ||
    a.edition.number - b.edition.number ||
    a.edition.id.localeCompare(b.edition.id);
  const sectionOrder = (a: ResultRow, b: ResultRow) =>
    a.section.number - b.section.number ||
    compareNullable(a.rank, b.rank) ||
    compareNullable(a.timeSeconds, b.timeSeconds) ||
    a.id.localeCompare(b.id);
  const universityOrder = (a: ResultRow, b: ResultRow) =>
    compareNullable(a.entry.finalRank, b.entry.finalRank) ||
    a.entry.id.localeCompare(b.entry.id) ||
    sectionOrder(a, b);
  const defaultOrder =
    filters.view === "university" ? universityOrder : sectionOrder;
  const value = (row: ResultRow) =>
    ({
      default: 0,
      race: row.race.name,
      year: row.edition.year,
      university: row.team.name,
      finalRank: row.entry.finalRank,
      section: row.section.number,
      athlete: row.athlete.name,
      time: row.timeSeconds,
      rank: row.rank,
    })[filters.sort];
  return (a, b) => {
    const edition = editionOrder(a, b);
    if (edition) return edition;
    if (filters.sort === "default") return defaultOrder(a, b);
    const av = value(a),
      bv = value(b),
      direction = filters.direction === "desc" ? -1 : 1;
    const manual =
      typeof av === "string" && typeof bv === "string"
        ? av.localeCompare(bv, "ja") * direction
        : compareNullable(av as number | null, bv as number | null, direction);
    return (
      manual ||
      (filters.sort === "finalRank"
        ? universityOrder(a, b)
        : defaultOrder(a, b))
    );
  };
}
