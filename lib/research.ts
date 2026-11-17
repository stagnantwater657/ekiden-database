import { researchChecks } from "./research-checks.ts";
import { validateResearchAudit, type ResearchAudit, type ResearchMeet } from "./research-audit.ts";
import type { Athlete, Edition, Source } from "./model.ts";

export const researchSourceCategories = ["athlete", "university", "employer", "competition", "federation", "database", "media"] as const;

export const researchStatuses = ["verified", "verified-absent", "candidate", "not-found", "conflict"] as const;
export const researchFields = ["birthDate", "highSchool", "affiliation", "5000m", "10000m", "half-marathon", "race-result", "section-record", "award", "statistic"] as const;
export type ResearchStatus = typeof researchStatuses[number];
export type ResearchField = typeof researchFields[number];
export interface ResearchVisit {
  url: string;
  section: string;
  access: "read" | "search-snippet" | "unavailable";
  finding: string;
  /** Optional v2 classification; legacy official coverage remains unchanged. */
  category?: typeof researchSourceCategories[number];
}
export interface ResearchSearch {
  stage: "discovery" | "reverse" | "verification";
  query: string;
  checkedAt: string;
  outcome: "found" | "not-found" | "inaccessible" | "conflict";
  sources: ResearchVisit[];
  result: string;
}
export interface ResearchScope {
  /** Intended cutoff, independent of whether the update search has been completed. */
  asOf: string;
  editionId: string | null;
  courseVersion: string | null;
  sectionNumber: number | null;
}
export interface ResearchRecord {
  /** Required for schemaVersion 2, forbidden on legacy v1 records. */
  audit?: ResearchAudit;
  athleteId: string;
  athleteName: string;
  field: ResearchField;
  scope: ResearchScope;
  pbScope: "current" | "historical" | null;
  status: ResearchStatus;
  candidates: { value: string; sourceUrl: string; locator: string }[];
  searches: ResearchSearch[];
  final: { value: string; sourceIds: string[]; locator: string; revision: string } | null;
  identityEvidence: string;
  updateCheck: { checked: boolean; asOf: string | null; summary: string };
  unresolved: string[];
  reviewedAt: string;
}
export interface ResearchBatch {
  schemaVersion: 1 | 2;
  batchId: string;
  researcher: string;
  reviewedAt: string;
  records: ResearchRecord[];
}
export interface ResearchContext {
  athletes: readonly Athlete[];
  editions: readonly Pick<Edition, "id">[];
  sources: readonly Source[];
  uncertainAthleteIds: readonly string[];
  meets: readonly ResearchMeet[];
}

// No network, repository mutation, or assertion that a researcher really read a page.
export function validateResearchBatch(input: unknown, context: ResearchContext): ResearchBatch {
  const { fail, obj, str, arr, date, oneOf, url } = researchChecks;
  const batch = obj(input, ["schemaVersion", "batchId", "researcher", "reviewedAt", "records"], "batch");
  if (batch.schemaVersion !== 1 && batch.schemaVersion !== 2) fail("schemaVersion", "unsupported version");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(str(batch.batchId, "batchId"))) fail("batchId", "invalid ID");
  str(batch.researcher, "researcher");
  if (batch.schemaVersion === 2 && !Array.isArray(context.meets)) fail("context.meets", "v2 requires explicit meet context; use createResearchContext()");
  const batchDate = date(batch.reviewedAt, "reviewedAt");
  const records = arr(batch.records, "records");
  if (!records.length) fail("records", "empty batch; do not fabricate completed research");
  const athletes = new Map(context.athletes.map((a) => [a.id, a]));
  const sources = new Map(context.sources.map((s) => [s.id, s]));
  const editionIds = new Set(context.editions.map((e) => e.id));
  const seen = new Set<string>();
  for (const [i, raw] of records.entries()) {
    const p = `records[${i}]`;
    const r = obj(raw, ["athleteId", "athleteName", "field", "scope", "pbScope", "status", "candidates", "searches", "final", "identityEvidence", "updateCheck", "unresolved", "reviewedAt", ...(batch.schemaVersion === 2 ? ["audit"] : [])], p);
    const athleteId = str(r.athleteId, `${p}.athleteId`);
    const athlete = athletes.get(athleteId);
    if (!athlete) fail(p, "unknown athleteId");
    const name = str(r.athleteName, `${p}.athleteName`);
    // Explicit aliases are permitted; normalization alone is not an identity decision.
    if (![athlete!.name, ...(athlete!.aliases ?? [])].includes(name)) fail(p, "athlete name does not match registry or registered alias");
    oneOf(r.field, researchFields, `${p}.field`);
    oneOf(r.status, researchStatuses, `${p}.status`);
    const reviewedAt = date(r.reviewedAt, `${p}.reviewedAt`);
    if (reviewedAt > batchDate) fail(p, "record review exceeds batch date");
    str(r.identityEvidence, `${p}.identityEvidence`);
    const isPB = ["5000m", "10000m", "half-marathon"].includes(String(r.field));
    oneOf(r.pbScope, isPB ? ["current", "historical"] : [null], `${p}.pbScope`);
    const scope = obj(r.scope, ["asOf", "editionId", "courseVersion", "sectionNumber"], `${p}.scope`);
    const asOf = date(scope.asOf, `${p}.scope.asOf`);
    if (asOf > reviewedAt) fail(p, "scope cutoff after review");
    const eventField = ["race-result", "section-record", "award", "statistic"].includes(String(r.field));
    if (!eventField && [scope.editionId, scope.courseVersion, scope.sectionNumber].some((v) => v !== null))
      fail(p, "PB and biography scope must not contain event qualifiers");
    if (eventField && !editionIds.has(str(scope.editionId, `${p}.scope.editionId`))) fail(p, "unknown scope editionId");
    if (scope.courseVersion !== null && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(str(scope.courseVersion, `${p}.scope.courseVersion`)))
      fail(p, "courseVersion must be a canonical lowercase ID");
    if (scope.sectionNumber !== null && (typeof scope.sectionNumber !== "number" || !Number.isSafeInteger(scope.sectionNumber) || scope.sectionNumber < 1))
      fail(p, "sectionNumber must be a positive integer or null");
    if (r.field === "section-record" && (scope.courseVersion === null || scope.sectionNumber === null))
      fail(p, "section-record requires courseVersion and sectionNumber");
    // Explicit tuple, not object serialization order or descriptive text. current/historical
    // label changes cannot create two conclusions about the same PB at the same cutoff.
    const key = JSON.stringify([athleteId, r.field, asOf, scope.editionId, scope.courseVersion, scope.sectionNumber]);
    if (seen.has(key)) fail(p, "duplicate subject in batch; consolidate conflicting conclusions into one conflict record");
    seen.add(key);
    const searches = arr(r.searches, `${p}.searches`);
    if (!searches.length) fail(p, "at least one actual search is required");
    const visited = new Set<string>();
    const read = new Set<string>();
    const stages = new Set<unknown>();
    for (const [j, search] of searches.entries()) {
      const q = `${p}.searches[${j}]`;
      const s = obj(search, ["stage", "query", "checkedAt", "outcome", "sources", "result"], q);
      oneOf(s.stage, ["discovery", "reverse", "verification"], `${q}.stage`);
      stages.add(s.stage);
      str(s.query, `${q}.query`);
      if (date(s.checkedAt, `${q}.checkedAt`) > reviewedAt) fail(q, "search after review");
      oneOf(s.outcome, ["found", "not-found", "inaccessible", "conflict"], `${q}.outcome`);
      str(s.result, `${q}.result`);
      const visits = arr(s.sources, `${q}.sources`);
      if (s.outcome !== "not-found" && !visits.length) fail(q, "source references required for this outcome");
      for (const [k, visit] of visits.entries()) {
        const vpath = `${q}.sources[${k}]`;
        const classified = batch.schemaVersion === 2 && !!visit && typeof visit === "object" && "category" in visit;
        const v = obj(visit, ["url", "section", "access", "finding", ...(classified ? ["category"] : [])], vpath);
        if (classified) oneOf(v.category, researchSourceCategories, `${vpath}.category`);
        const sourceUrl = url(v.url, `${vpath}.url`);
        visited.add(sourceUrl);
        str(v.section, `${vpath}.section`);
        str(v.finding, `${vpath}.finding`);
        oneOf(v.access, ["read", "search-snippet", "unavailable"], `${vpath}.access`);
        if (v.access === "read") read.add(sourceUrl);
      }
    }
    const candidates = arr(r.candidates, `${p}.candidates`);
    const values = new Set<string>();
    for (const [j, candidate] of candidates.entries()) {
      const cpath = `${p}.candidates[${j}]`;
      const c = obj(candidate, ["value", "sourceUrl", "locator"], cpath);
      values.add(str(c.value, `${cpath}.value`));
      str(c.locator, `${cpath}.locator`);
      if (!visited.has(url(c.sourceUrl, `${cpath}.sourceUrl`))) fail(cpath, "candidate source absent from search log");
    }
    const update = obj(r.updateCheck, ["checked", "asOf", "summary"], `${p}.updateCheck`);
    if (typeof update.checked !== "boolean") fail(p, "update checked must be boolean");
    str(update.summary, `${p}.updateCheck.summary`);
    if (update.checked) {
      if (date(update.asOf, `${p}.updateCheck.asOf`) > reviewedAt) fail(p, "update cutoff after review");
      if (update.asOf !== asOf) fail(p, "update cutoff must match scope cutoff");
    } else if (update.asOf !== null) fail(p, "unchecked update must have null cutoff");
    const issues = arr(r.unresolved, `${p}.unresolved`);
    issues.forEach((issue, j) => str(issue, `${p}.unresolved[${j}]`));
    const verified = r.status === "verified" || r.status === "verified-absent";
    if (verified) {
      if (context.uncertainAthleteIds.includes(athleteId)) fail(p, "unresolved identity cannot be verified");
      if (stages.size !== 3) fail(p, "verified conclusion requires all three research stages");
      if (isPB && !update.checked) fail(p, "verified PB requires an explicit update check and cutoff");
      if (r.status === "verified-absent" && (!isPB || candidates.length)) fail(p, "absence is only for PB without unresolved candidates");
      if (issues.length) fail(p, "verified conclusion still has unresolved issues");
      const f = obj(r.final, ["value", "sourceIds", "locator", "revision"], `${p}.final`);
      const value = str(f.value, `${p}.final.value`);
      if (r.status === "verified" && !values.has(value)) fail(p, "final value must match a recorded candidate");
      str(f.locator, `${p}.final.locator`);
      str(f.revision, `${p}.final.revision`);
      const ids = arr(f.sourceIds, `${p}.final.sourceIds`);
      if (!ids.length || new Set(ids).size !== ids.length) fail(p, "distinct adopted Source IDs required");
      for (const id of ids) {
        const source = sources.get(str(id, `${p}.final.sourceIds`));
        if (!source) fail(p, "unknown adopted Source ID");
        if (!read.has(url(source!.url, `${p}.adoptedSource.url`))) fail(p, "adopted Source must have a read document in the log");
      }
    } else {
      if (r.final !== null) fail(p, "unverified conclusion cannot adopt a final fact");
      if (!issues.length) fail(p, "unverified status requires unresolved reasons");
      if ((r.status === "candidate" || r.status === "conflict") && !candidates.length) fail(p, "candidate/conflict needs candidate evidence");
      if (r.status === "not-found" && candidates.length) fail(p, "not-found cannot hide known candidates");
    }
    if (batch.schemaVersion === 2) validateResearchAudit(r.audit, r as unknown as ResearchRecord, context, `${p}.audit`);
  }
  return input as ResearchBatch;
}
