import dataset from "../data/all-japan-2024.json" with { type: "json" };
import type { Database, ResultRow } from "./model.ts";
import type { Filters } from "./query.ts";

export function validateDatabase(db: Database): void {
  if (db.schemaVersion !== 1) throw new Error("Unsupported data version");
  const groups = [
    db.sources,
    db.races,
    db.editions,
    db.sections,
    db.universities,
    db.athletes,
    db.entries,
    db.results,
  ];
  for (const group of groups)
    if (new Set(group.map((x) => x.id)).size !== group.length)
      throw new Error("Duplicate entity ID");
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
      !has(db.universities, entry.universityId)
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
      university: db.universities.find((x) => x.id === entry.universityId)!,
      athlete: db.athletes.find((x) => x.id === result.athleteId)!,
      source: db.sources.find((x) => x.id === result.sourceId)!,
    };
  });
  return {
    async catalog() {
      return db;
    },
    async search(filters: Filters) {
      const normalize = (s: string) =>
        s.normalize("NFKC").replace(/\s/g, "").toLocaleLowerCase("ja");
      const matched = rows.filter(
        (row) =>
          (!filters.race || row.race.id === filters.race) &&
          (!filters.edition || row.edition.id === filters.edition) &&
          (!filters.year || String(row.edition.year) === filters.year) &&
          (!filters.university || row.university.id === filters.university) &&
          (!filters.section ||
            String(row.section.number) === filters.section) &&
          (!filters.athlete || row.athlete.id === filters.athlete) &&
          (!filters.q ||
            normalize(row.athlete.name).includes(normalize(filters.q))),
      );
      matched.sort(compareResults(filters));
      // Summaries describe the entire filtered result, not only this page.
      const sourceIds = new Set(
        matched
          .flatMap((row) => [row.sourceId, row.entry.finalRankSourceId])
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
      university: row.university.name,
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
    return manual || defaultOrder(a, b);
  };
}
