import supplementData from "../data/presentation/athlete-profiles.json" with { type: "json" };
import { presentationSources } from "../data/presentation/index.ts";
import type { Database, Source } from "./model.ts";

export type PersonalBestEvent = "5000m" | "10000m" | "half-marathon";
export type PersonalBestPrecision = "second" | "centisecond";

export interface SourcedProfileFact {
  value: string;
  sourceId: string;
  locator: string;
  revision: string;
}

export interface PersonalBest {
  event: PersonalBestEvent;
  /** Preserve published hundredths; do not round to the second. */
  timeMilliseconds: number;
  precision: PersonalBestPrecision;
  achievedOn: string;
  meet: string;
  /** Indoor track performance; rendered as an explicit badge, never inferred from meet text. */
  indoor?: boolean;
  sourceId: string;
  locator: string;
  revision: string;
}

/** A confirmed absence is a fact, not a gap (e.g. a runner with no official half). */
export interface VerifiedAbsentEvent {
  event: PersonalBestEvent;
  note: string;
}

export interface AthleteProfileSupplement {
  athleteId: string;
  reviewedAt: string;
  birthDate?: SourcedProfileFact;
  highSchool?: SourcedProfileFact;
  personalBests: PersonalBest[];
  absentEvents?: VerifiedAbsentEvent[];
}

export type PersonalBestStatus = "published" | "verified-absent" | "missing";

const rawData = supplementData as {
  schemaVersion: number;
  profiles: AthleteProfileSupplement[];
};
if (rawData.schemaVersion !== 1) {
  throw new Error("Athlete profiles: unsupported supplement schema version");
}

export const athleteProfileSupplements: AthleteProfileSupplement[] = rawData.profiles;
const byAthlete = new Map(athleteProfileSupplements.map((item) => [item.athleteId, item]));

export function athleteSupplementFor(athleteId: string): AthleteProfileSupplement | null {
  return byAthlete.get(athleteId) ?? null;
}

export function athleteSupplementSourceIds(item: AthleteProfileSupplement | null): string[] {
  if (!item) return [];
  return [
    item.birthDate?.sourceId,
    item.highSchool?.sourceId,
    ...item.personalBests.map((pb) => pb.sourceId),
  ].filter((id): id is string => !!id);
}

/** The database stores no results in this supplement, only independently sourced facts. */
export function validateAthleteProfiles(
  db: Database,
  profiles: AthleteProfileSupplement[] = athleteProfileSupplements,
  extraSources: Source[] = presentationSources,
): void {
  const fail = (message: string): never => { throw new Error(`Athlete profiles: ${message}`); };
  const sourceIds = new Set([...db.sources, ...extraSources].map((source) => source.id));
  const athletes = new Map(db.athletes.map((athlete) => [athlete.id, athlete]));
  const uncertain = new Set(db.identities.filter((row) => row.status === "needs-review").map((row) => row.athleteId));
  const seen = new Set<string>();
  const dateValid = (date: string): boolean =>
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  const checkProvenance = (fact: { sourceId: string; locator: string; revision: string }, context: string) => {
    if (!sourceIds.has(fact.sourceId) || !fact.locator?.trim() || !fact.revision?.trim())
      fail(`${context}: incomplete source provenance`);
  };
  for (const profile of profiles) {
    if (seen.has(profile.athleteId)) fail(`duplicate athlete ${profile.athleteId}`);
    seen.add(profile.athleteId);
    const athlete = athletes.get(profile.athleteId);
    if (!athlete) throw new Error(`Athlete profiles: unknown athlete ${profile.athleteId}`);
    if (uncertain.has(profile.athleteId)) fail(`${profile.athleteId}: unresolved identity`);
    if (!dateValid(profile.reviewedAt)) fail(`${profile.athleteId}: invalid review date`);
    if (!profile.birthDate && !profile.highSchool && !profile.personalBests?.length)
      fail(`${profile.athleteId}: empty profile supplement`);
    if (profile.birthDate) {
      checkProvenance(profile.birthDate, `${profile.athleteId} birthDate`);
      if (!dateValid(profile.birthDate.value) || profile.birthDate.value > profile.reviewedAt)
        fail(`${profile.athleteId}: invalid birth date`);
      if (athlete.birthDate && athlete.birthDate !== profile.birthDate.value)
        fail(`${profile.athleteId}: birth date conflicts with registry`);
    }
    if (profile.highSchool) {
      checkProvenance(profile.highSchool, `${profile.athleteId} highSchool`);
      if (!profile.highSchool.value?.trim()) fail(`${profile.athleteId}: empty high school`);
    }
    const events = new Set<PersonalBestEvent>();
    if (!Array.isArray(profile.personalBests)) fail(`${profile.athleteId}: missing personalBests array`);
    for (const pb of profile.personalBests) {
      if (!["5000m", "10000m", "half-marathon"].includes(pb.event))
        fail(`${profile.athleteId}: invalid PB event`);
      if (events.has(pb.event)) fail(`${profile.athleteId}: duplicate PB event ${pb.event}`);
      events.add(pb.event);
      if (!Number.isSafeInteger(pb.timeMilliseconds) || pb.timeMilliseconds <= 0)
        fail(`${profile.athleteId} ${pb.event}: invalid PB time`);
      if ((pb.precision !== "second" && pb.precision !== "centisecond") ||
          pb.timeMilliseconds % (pb.precision === "second" ? 1000 : 10) !== 0)
        fail(`${profile.athleteId} ${pb.event}: invalid time precision`);
      if (!dateValid(pb.achievedOn) || pb.achievedOn > profile.reviewedAt)
        fail(`${profile.athleteId} ${pb.event}: invalid performance date`);
      if (!pb.meet?.trim()) fail(`${profile.athleteId} ${pb.event}: missing meet`);
      if (pb.indoor !== undefined && typeof pb.indoor !== "boolean")
        fail(`${profile.athleteId} ${pb.event}: invalid indoor flag`);
      checkProvenance(pb, `${profile.athleteId} ${pb.event}`);
    }
    const absent = new Set<PersonalBestEvent>();
    for (const item of profile.absentEvents ?? []) {
      if (!["5000m", "10000m", "half-marathon"].includes(item.event))
        fail(`${profile.athleteId}: invalid absent event`);
      if (absent.has(item.event)) fail(`${profile.athleteId}: duplicate absent event ${item.event}`);
      if (events.has(item.event)) fail(`${profile.athleteId}: absent event also has a PB ${item.event}`);
      if (!item.note?.trim()) fail(`${profile.athleteId} ${item.event}: absent event needs a note`);
      absent.add(item.event);
    }
  }
}

/** published = sourced mark; verified-absent = confirmed none; missing = not found yet. */
export function personalBestStatus(
  profile: AthleteProfileSupplement | null,
  event: PersonalBestEvent,
): PersonalBestStatus {
  if (!profile) return "missing";
  if (profile.personalBests.some((pb) => pb.event === event)) return "published";
  if (profile.absentEvents?.some((item) => item.event === event)) return "verified-absent";
  return "missing";
}

export function formatPersonalBest(pb: PersonalBest): string {
  const totalSeconds = Math.floor(pb.timeMilliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const base = hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
  return pb.precision === "centisecond"
    ? `${base}.${String(Math.floor((pb.timeMilliseconds % 1000) / 10)).padStart(2, "0")}`
    : base;
}
