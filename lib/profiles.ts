import type {
  Athlete,
  Database,
  Edition,
  Entry,
  Race,
  ResultRow,
  Source,
  University,
} from "./model.ts";

import { getResultHonors } from "./scoreboard.ts";

const raceOrder = ["hakone", "all-japan", "izumo"];

function historyRows(db: Database): ResultRow[] {
  const entries = new Map(db.entries.map((item) => [item.id, item]));
  const editions = new Map(db.editions.map((item) => [item.id, item]));
  const sections = new Map(db.sections.map((item) => [item.id, item]));
  const races = new Map(db.races.map((item) => [item.id, item]));
  const teams = new Map(db.teams.map((item) => [item.id, item]));
  const universities = new Map(db.universities.map((item) => [item.id, item]));
  const athletes = new Map(db.athletes.map((item) => [item.id, item]));
  const sources = new Map(db.sources.map((item) => [item.id, item]));
  return db.results
    .map((result) => {
      const entry = entries.get(result.entryId)!;
      const edition = editions.get(entry.editionId)!;
      return {
        ...result,
        entry,
        edition,
        section: sections.get(result.sectionId)!,
        race: races.get(edition.raceId)!,
        team: teams.get(entry.teamId)!,
        university: entry.universityId
          ? universities.get(entry.universityId)!
          : null,
        athlete: athletes.get(result.athleteId)!,
        source: sources.get(result.sourceId)!,
      };
    })
    .sort(
      (a, b) =>
        b.edition.date.localeCompare(a.edition.date) ||
        a.edition.id.localeCompare(b.edition.id) ||
        a.section.number - b.section.number ||
        a.id.localeCompare(b.id),
    );
}

function sourceReferences(
  db: Database,
  ids: (string | null | undefined)[],
): Source[] {
  const selected = new Set(ids);
  return db.sources.filter((source) => selected.has(source.id));
}

function rowSourceIds(rows: ResultRow[]): (string | null | undefined)[] {
  return rows.flatMap((row) => [
    row.sourceId,
    row.participationSourceId,
    getResultHonors(row.id)?.sourceId,
  ]);
}

/** A historical affiliation is an observed start, never a current roster claim. */
export function representedUniversityId(row: ResultRow): string | null {
  return row.representingUniversityId ?? row.entry.universityId;
}

export interface AthleteArchive {
  athlete: Athlete;
  groups: { race: Race; rows: ResultRow[] }[];
  universities: { university: University; years: number[]; starts: number }[];
  starts: number;
  seasons: number[];
  showTeams: boolean;
  needsReview: boolean;
  sources: Source[];
}

export function athleteArchive(
  db: Database,
  athleteId: string,
): AthleteArchive | null {
  const athlete = db.athletes.find((item) => item.id === athleteId);
  if (!athlete) return null;
  const rows = historyRows(db).filter((row) => row.athleteId === athleteId);
  const universities = db.universities
    .flatMap((university) => {
      const starts = rows.filter(
        (row) => representedUniversityId(row) === university.id,
      );
      return starts.length
        ? [
            {
              university,
              years: [...new Set(starts.map((row) => row.edition.year))].sort(
                (a, b) => a - b,
              ),
              starts: starts.length,
            },
          ]
        : [];
    })
    .sort(
      (a, b) =>
        a.years[0] - b.years[0] ||
        a.university.id.localeCompare(b.university.id),
    );
  const races = [...db.races].sort((a, b) => {
    const order = (id: string) =>
      raceOrder.includes(id) ? raceOrder.indexOf(id) : raceOrder.length;
    return order(a.id) - order(b.id) || a.id.localeCompare(b.id);
  });
  return {
    athlete,
    groups: races.map((race) => ({
      race,
      rows: rows.filter((row) => row.race.id === race.id),
    })),
    universities,
    starts: rows.length,
    seasons: [...new Set(rows.map((row) => row.edition.seasonYear))].sort(
      (a, b) => a - b,
    ),
    showTeams:
      new Set(rows.map((row) => row.team.id)).size > 1 ||
      rows.some((row) => row.team.kind !== "university"),
    needsReview: db.identities.some(
      (identity) =>
        identity.athleteId === athleteId && identity.status === "needs-review",
    ),
    sources: sourceReferences(db, [athlete.sourceId, ...rowSourceIds(rows)]),
  };
}

export interface UniversityArchive {
  university: University;
  performances: { entry: Entry; edition: Edition; race: Race }[];
  athletes: {
    athlete: Athlete;
    years: number[];
    starts: number;
    selectionStarts: number;
  }[];
  starts: number;
  selectionStarts: number;
  raceCount: number;
  sources: Source[];
}

export function universityArchive(
  db: Database,
  universityId: string,
): UniversityArchive | null {
  const university = db.universities.find((item) => item.id === universityId);
  if (!university) return null;
  const rows = historyRows(db).filter(
    (row) => representedUniversityId(row) === universityId,
  );
  // A selection runner's home university does not inherit the selection team's result.
  const performances = db.entries
    .filter((entry) => entry.universityId === universityId)
    .map((entry) => {
      const edition = db.editions.find((item) => item.id === entry.editionId)!;
      return {
        entry,
        edition,
        race: db.races.find((item) => item.id === edition.raceId)!,
      };
    })
    .sort(
      (a, b) =>
        b.edition.date.localeCompare(a.edition.date) ||
        a.entry.id.localeCompare(b.entry.id),
    );
  const athleteIds = new Set(rows.map((row) => row.athleteId));
  const athletes = db.athletes
    .filter((athlete) => athleteIds.has(athlete.id))
    .map((athlete) => {
      const starts = rows.filter((row) => row.athleteId === athlete.id);
      return {
        athlete,
        years: [...new Set(starts.map((row) => row.edition.year))].sort(
          (a, b) => a - b,
        ),
        starts: starts.length,
        selectionStarts: starts.filter((row) => row.team.kind !== "university")
          .length,
      };
    })
    .sort(
      (a, b) =>
        a.athlete.name.localeCompare(b.athlete.name, "ja") ||
        a.athlete.id.localeCompare(b.athlete.id),
    );
  return {
    university,
    performances,
    athletes,
    starts: rows.length,
    selectionStarts: rows.filter((row) => row.team.kind !== "university")
      .length,
    raceCount: new Set(rows.map((row) => row.race.id)).size,
    sources: sourceReferences(db, [
      university.sourceId,
      ...rowSourceIds(rows),
      ...performances.flatMap(({ entry }) => [
        entry.sourceId,
        entry.finalRankSourceId,
        entry.totalTimeSourceId,
      ]),
    ]),
  };
}

export function yearRange(years: number[]): string {
  if (!years.length) return "尚未收录";
  const ordered = [...years].sort((a, b) => a - b);
  return ordered[0] === ordered.at(-1)
    ? String(ordered[0])
    : `${ordered[0]}—${ordered.at(-1)}`;
}
