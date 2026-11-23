import { formatPersonalBest, type AthleteProfileSupplement, type PersonalBest, type PersonalBestEvent } from "./athlete-facts.ts";
import type { Database, Source } from "./model.ts";
import { identityCandidates, normalizeName } from "./identity.ts";
import { parsePerformanceTime } from "./performance-time.ts";
import { researchChecks as checks } from "./research-checks.ts";
import { parsePbCsv, type PbCsvInput } from "./pb-csv.ts";

export type PbComparison = "new-candidate" | "faster-candidate" | "same-time" | "slower";
export type PbReviewStatus = PbComparison | "identity-conflict" | "invalid" | "needs-evidence" | "duplicate" | "multiple-results";
export interface PbPreviewContext { database: Database; profiles: AthleteProfileSupplement[]; sources: Source[] }
export interface PbReviewRow {
  row: number;
  line: number;
  input: PbCsvInput;
  matchedAthleteId: string | null;
  identity: { status: "matched" | "needs-review" | "conflict"; candidateIds: string[]; reasons: string[]; universityIds: string[] };
  existingPb: PersonalBest | null;
  performance: { event: PersonalBestEvent | null; timeMilliseconds: number | null; precision: "second" | "centisecond" | null; time: string; achievedOn: string | null; meet: string };
  comparison: PbComparison | null;
  sameMeet: boolean | null;
  statuses: PbReviewStatus[];
  source: { inputUrl: string; canonicalUrl: string | null; registeredSourceIds: string[] };
  errors: string[];
  evidenceGaps: string[];
  duplicateOf: { inputRows: number[]; existingPb: boolean };
  relatedRows: number[];
  needsManualReview: true;
}
export interface PbPreviewReport {
  schemaVersion: 1;
  mode: "dry-run";
  asOf: string;
  limitations: string[];
  summary: { inputRecords: number; matched: number; faster: number; newCandidates: number; sameTime: number; slower: number; duplicates: number; identityConflicts: number; invalid: number; needsEvidence: number; multipleResults: number };
  rows: PbReviewRow[];
}
const events = ["5000m", "10000m", "half-marathon"] as const;
// Unlike candidate normalization, this does NOT fold unregistered kanji variants.
const exactName = (name: string) => name.normalize("NFKC").replace(/\s/gu, "");
const universityKey = (name: string) => normalizeName(name).replace(/大学$/, "大");
const meetKey = (meet: string) => exactName(meet).toLocaleLowerCase("ja");

function matchIdentity(input: PbCsvInput, db: Database, cutoff: string): PbReviewRow["identity"] & { athleteId: string | null } {
  const candidateIds = input.name.trim() ? identityCandidates(input.name, db.athletes) : [];
  const athlete = db.athletes.find((a) => a.id === input.athleteId.trim());
  const reasons: string[] = [];
  let conflict = false;
  if (!athlete) {
    return { status: input.athleteId.trim() ? "conflict" : "needs-review", athleteId: null, candidateIds,
      universityIds: [], reasons: [input.athleteId.trim() ? "unknown-athlete-id" : "athlete-id-required; names only suggest candidates"] };
  }
  if (!input.name.trim()) reasons.push("name-required");
  else if (![athlete.name, ...(athlete.aliases ?? [])].some((v) => exactName(v) === exactName(input.name))) {
    if (candidateIds.includes(athlete.id)) reasons.push("unregistered-name-variant");
    else { conflict = true; reasons.push("athlete-id-name-conflict"); }
  }
  if (db.identities.some((i) => i.athleteId === athlete.id && i.status === "needs-review")) reasons.push("registry-identity-needs-review");
  const associations = db.results.filter((r) => r.athleteId === athlete.id).flatMap((r) => {
    const entry = db.entries.find((e) => e.id === r.entryId);
    const edition = db.editions.find((e) => e.id === entry?.editionId);
    const universityId = r.representingUniversityId ?? entry?.universityId;
    return universityId && edition ? [{ universityId, date: edition.date }] : [];
  });
  const universityIds = [...new Set(associations.map((a) => a.universityId))].sort();
  if (!input.university.trim()) reasons.push("university-required");
  else {
    const submitted = db.universities.filter((u) => [u.id, u.name, ...db.teams.filter((t) => t.universityId === u.id).map((t) => t.name)]
      .some((v) => universityKey(v) === universityKey(input.university)));
    if (submitted.length !== 1) reasons.push("university-unrecognized-or-ambiguous; employer/transfer needs evidence");
    else if (!universityIds.includes(submitted[0].id)) {
      if (universityIds.length) { conflict = true; reasons.push("athlete-id-university-conflict; check transfer or affiliation at meet"); }
      else reasons.push("no-recorded-university-association");
    } else if (!associations.some((a) => a.universityId === submitted[0].id && a.date <= cutoff)) reasons.push("university-association-only-after-performance-cutoff");
    if (universityIds.length > 1) reasons.push("multiple-historical-universities; verify affiliation at meet");
  }
  const status = conflict ? "conflict" : reasons.length ? "needs-review" : "matched";
  return { status, athleteId: status === "matched" ? athlete.id : null, candidateIds, reasons, universityIds };
}

/** Pure comparison of local known facts. No fetching, new IDs, research decisions or writes. */
export function previewPbCsv(csv: string, context: PbPreviewContext, asOf: string): PbPreviewReport {
  checks.date(asOf, "asOf");
  const rows: PbReviewRow[] = parsePbCsv(csv).map(({ input, row, line }) => {
    const errors: string[] = [], evidenceGaps: string[] = [];
    const event = events.includes(input.event.trim() as PersonalBestEvent) ? input.event.trim() as PersonalBestEvent : null;
    if (!event) errors.push("unsupported-event");
    let time: ReturnType<typeof parsePerformanceTime> | null = null;
    try { time = parsePerformanceTime(input.time); } catch { errors.push("invalid-time"); }
    let achievedOn: string | null = null;
    if (!input.date.trim()) evidenceGaps.push("missing-date");
    else {
      try { achievedOn = checks.date(input.date.trim(), "date"); } catch { errors.push("invalid-date"); }
      if (achievedOn && achievedOn > asOf) errors.push("date-after-as-of");
    }
    const meet = input.meet.trim();
    if (!meet) evidenceGaps.push("missing-meet");
    let canonicalUrl: string | null = null;
    if (!input.sourceUrl.trim()) evidenceGaps.push("missing-source-url");
    else { try { canonicalUrl = checks.url(input.sourceUrl.trim(), "sourceUrl"); } catch { evidenceGaps.push("invalid-public-source-url"); } }
    const identity = matchIdentity(input, context.database, achievedOn && achievedOn <= asOf ? achievedOn : asOf);
    if (identity.status === "needs-review") evidenceGaps.push(...identity.reasons);
    const profile = context.profiles.find((p) => p.athleteId === identity.athleteId);
    const existingPb = profile?.personalBests.find((pb) => pb.event === event) ?? null;
    let comparison: PbComparison | null = null, sameMeet: boolean | null = null;
    if (profile?.absentEvents?.some((v) => v.event === event)) evidenceGaps.push("conflicts-with-verified-absence; independent recheck required");
    if (existingPb?.indoor) evidenceGaps.push("existing-pb-is-indoor; CSV does not establish comparable conditions");
    if (existingPb && existingPb.achievedOn > asOf) evidenceGaps.push("existing-pb-after-as-of; cannot reconstruct historical baseline");
    else if (!errors.length && identity.athleteId && event && time) {
      comparison = !existingPb ? "new-candidate" : time.timeMilliseconds < existingPb.timeMilliseconds ? "faster-candidate" :
        time.timeMilliseconds === existingPb.timeMilliseconds ? "same-time" : "slower";
      if (existingPb && achievedOn && meet) sameMeet = achievedOn === existingPb.achievedOn && meetKey(meet) === meetKey(existingPb.meet);
    }
    const statuses: PbReviewStatus[] = [];
    if (comparison) statuses.push(comparison);
    if (identity.status === "conflict") statuses.push("identity-conflict");
    if (errors.length) statuses.push("invalid");
    if (evidenceGaps.length) statuses.push("needs-evidence");
    const duplicate = comparison === "same-time" && sameMeet === true && time?.precision === existingPb?.precision;
    if (duplicate) statuses.push("duplicate");
    if (sameMeet === true && existingPb && time && (time.timeMilliseconds !== existingPb.timeMilliseconds || time.precision !== existingPb.precision)) {
      statuses.push("multiple-results");
      evidenceGaps.push("same-meet-different-published-mark; verify revision/round/precision");
      if (!statuses.includes("needs-evidence")) statuses.push("needs-evidence");
    }
    return { row, line, input, matchedAthleteId: identity.athleteId,
      identity: { status: identity.status, candidateIds: identity.candidateIds, reasons: identity.reasons, universityIds: identity.universityIds }, existingPb,
      performance: { event, timeMilliseconds: time?.timeMilliseconds ?? null, precision: time?.precision ?? null, time: time ? formatPersonalBest(time) : input.time.trim(), achievedOn, meet }, comparison, sameMeet, statuses,
      source: { inputUrl: input.sourceUrl, canonicalUrl, registeredSourceIds: canonicalUrl ? context.sources.filter((s) => {
        try { return checks.url(s.url, "source") === canonicalUrl; } catch { return false; }
      }).map((s) => s.id) : [] }, errors, evidenceGaps, duplicateOf: { inputRows: [], existingPb: duplicate }, relatedRows: [], needsManualReview: true };
  });
  // Never select a minimum from duplicate/conflicting heat/final/corrected rows. Keep all for review.
  // Exact input repetition can also be detected when identity/date/time are unresolved.
  const inputKeys = new Map<string, PbReviewRow[]>();
  for (const r of rows) {
    const key = JSON.stringify(r.input);
    const previous = inputKeys.get(key) ?? [];
    if (previous.length) {
      r.duplicateOf.inputRows = previous.map((v) => v.row);
      r.relatedRows = previous.map((v) => v.row);
      for (const v of previous) v.relatedRows.push(r.row);
      if (!r.statuses.includes("duplicate")) r.statuses.push("duplicate");
    }
    previous.push(r); inputKeys.set(key, previous);
  }
  const groups = new Map<string, PbReviewRow[]>();
  for (const r of rows) {
    if (!r.matchedAthleteId || r.errors.length || !r.performance.event || !r.performance.achievedOn || !r.performance.meet) continue;
    const key = JSON.stringify([r.matchedAthleteId, r.performance.event, r.performance.achievedOn, meetKey(r.performance.meet)]);
    const group = groups.get(key) ?? []; group.push(r); groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const r of group) {
      r.relatedRows = group.filter((v) => v !== r).map((v) => v.row);
      const duplicates = group.filter((v) => v.row < r.row && v.performance.timeMilliseconds === r.performance.timeMilliseconds && v.performance.precision === r.performance.precision);
      r.duplicateOf.inputRows = duplicates.map((v) => v.row);
      if (duplicates.length && !r.statuses.includes("duplicate")) r.statuses.push("duplicate");
      if (group.some((v) => v.performance.timeMilliseconds !== r.performance.timeMilliseconds || v.performance.precision !== r.performance.precision)) {
        if (!r.statuses.includes("multiple-results")) r.statuses.push("multiple-results");
        r.evidenceGaps.push("multiple-marks-in-same-meet; verify heat/final/revision/timing basis");
        if (!r.statuses.includes("needs-evidence")) r.statuses.push("needs-evidence");
      }
    }
  }
  const count = (status: PbReviewStatus) => rows.filter((r) => r.statuses.includes(status)).length;
  return { schemaVersion: 1, mode: "dry-run", asOf,
    limitations: ["Comparison only against the local published PB snapshot; never proof of current/latest PB or verified evidence.",
      "All rows require human review of identity, affiliation at meet, official distance, timing, indoor/outdoor, event identity and source/version.",
      "Name-only matches and unregistered kanji variants are suggestions, never automatic identity merges.",
      "Same meet means equal ISO date and whitespace-normalized meet label, not independently verified event identity.",
      "Sources are not fetched. Registered source IDs do not certify this row. No production data or research logs are written."],
    summary: { inputRecords: rows.length, matched: rows.filter((r) => r.identity.status === "matched").length,
      faster: count("faster-candidate"), newCandidates: count("new-candidate"), sameTime: count("same-time"), slower: count("slower"),
      duplicates: count("duplicate"), identityConflicts: count("identity-conflict"), invalid: count("invalid"), needsEvidence: count("needs-evidence"), multipleResults: count("multiple-results") }, rows };
}
