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
  revision?: string | null;
  usage?: {
    policyUrl: string;
    reviewedAt: string;
    basis: string;
    permissionReference: string | null;
  };
}
export interface Race extends Sourced {
  name: string;
}
export interface Edition extends Sourced {
  raceId: string;
  year: number;
  seasonYear: number;
  number: number;
  date: string;
  officialName: string;
  distanceKm: number;
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
  aliases?: string[];
}
export type TeamKind =
  "university" | "association-selection" | "overseas-selection";
export interface Team extends Sourced {
  name: string;
  kind: TeamKind;
  universityId: string | null;
}
export type ResultStatus =
  | "finished"
  | "reference"
  | "unranked"
  | "disqualified"
  | "did-not-finish"
  | "did-not-start"
  | "unknown";
// Team membership belongs to this edition, never to the athlete's identity.
export interface Entry extends Sourced {
  finalRank: number | null;
  finalRankSourceId: string | null;
  editionId: string;
  teamId: string;
  universityId: string | null;
  totalTimeSeconds: number | null;
  totalTimeSourceId: string | null;
  status: ResultStatus;
}
// Legacy section rows remain unchanged; optional per-start metadata is unknown when absent.
export interface SectionResult extends Sourced {
  entryId: string;
  sectionId: string;
  athleteId: string;
  timeSeconds: number | null;
  rank: number | null;
  status?: ResultStatus;
  grade?: string | null;
  participationSourceId?: string | null;
  representingUniversityId?: string | null;
  locator?: string;
}
export interface IdentityDecision {
  recordId: string;
  athleteId: string;
  observedName: string;
  status: "legacy" | "confirmed" | "new" | "needs-review";
  candidateIds: string[];
  evidenceSourceIds: string[];
  reason: string;
}
export interface Database {
  schemaVersion: number;
  sources: Source[];
  races: Race[];
  editions: Edition[];
  sections: Section[];
  universities: University[];
  athletes: Athlete[];
  teams: Team[];
  entries: Entry[];
  results: SectionResult[];
  identities: IdentityDecision[];
}
export interface ResultRow extends SectionResult {
  entry: Entry;
  race: Race;
  edition: Edition;
  section: Section;
  university: University | null;
  team: Team;
  athlete: Athlete;
  source: Source;
}
export type Registry = Pick<
  Database,
  "sources" | "races" | "universities" | "athletes" | "teams"
>;
export interface EditionBundle {
  schemaVersion: 2;
  edition: Edition;
  sources: Source[];
  sections: Section[];
  entries: Entry[];
  results: SectionResult[];
  identities: IdentityDecision[];
}
