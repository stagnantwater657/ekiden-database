export interface Sourced {
  id: string;
  sourceId: string;
}
export interface Source {
  id: string;
  title: string;
  url: string;
  collectedAt: string;
  locator: string;
  coverage: string;
}
export interface Race extends Sourced {
  name: string;
}
export interface Edition extends Sourced {
  raceId: string;
  year: number;
  number: number;
  date: string;
}
export interface Section extends Sourced {
  editionId: string;
  number: number;
  distanceKm: number | null;
}
export interface University extends Sourced {
  name: string;
}
export interface Athlete extends Sourced {
  name: string;
  birthDate: string | null;
}
// University affiliation belongs to the entry, never to the athlete's identity.
export interface Entry extends Sourced {
  editionId: string;
  universityId: string;
}
export interface SectionResult extends Sourced {
  entryId: string;
  sectionId: string;
  athleteId: string;
  timeSeconds: number | null;
  rank: number | null;
}
export interface Database {
  schemaVersion: number;
  sources: Source[];
  races: Race[];
  editions: Edition[];
  sections: Section[];
  universities: University[];
  athletes: Athlete[];
  entries: Entry[];
  results: SectionResult[];
}
export interface ResultRow extends SectionResult {
  race: Race;
  edition: Edition;
  section: Section;
  university: University;
  athlete: Athlete;
  source: Source;
}
