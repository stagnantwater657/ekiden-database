import type { ResearchContext, ResearchRecord } from "./research.ts";
import { researchChecks as c } from "./research-checks.ts";

export const sourceCategories = ["university", "employer", "official", "database", "media"] as const;
export const evidenceClaims = ["value", "achievedOn", "meet", "edition", "distance", "group", "affiliation", "identity", "pb-update"] as const;
type Claim = typeof evidenceClaims[number];
const pbDistances: Record<string, number> = {"5000m":5000,"10000m":10000,"half-marathon":21097.5};
export interface ResearchEvidence {
  id: string;
  sourceId: string;
  role: "primary" | "event" | "cross-check" | "identity";
  supports: Claim[];
  locator: string;
  revision: string;
  status: "verified" | "unverified";
  checkedAt: string | null;
  originKey: string | null;
  independenceNote: string;
}
export interface SourceCoverage {
  category: typeof sourceCategories[number];
  status: "checked" | "not-checked" | "not-applicable" | "blocked";
  searchIndexes: number[];
  reason: string;
}
export interface ResearchMeet {
  id: string;
  name: string;
  edition: number;
  startsOn: string;
  endsOn: string;
  discipline: "5000m" | "10000m" | "half-marathon";
  sourceUrl: string;
  locator: string;
  revision: string;
  reviewedAt: string;
}
export interface PerformanceCandidate {
  id: string;
  /** Exact candidate string: normalized time, optionally followed by semicolon-delimited context. */
  value: string;
  timeMilliseconds: number;
  precision: "second" | "centisecond";
  achievedOn: string;
  evidenceIds: string[];
  eligibility: "eligible" | "excluded" | "unconfirmed";
  reason: string;
  event: {
    metadataId: string | null;
    name: string;
    edition: number | null;
    startsOn: string;
    endsOn: string;
    competedOn: string;
    discipline: "5000m" | "10000m" | "half-marathon";
    distanceMetres: number;
    editionStatus: "verified" | "pending";
    evidenceIds: string[];
  };
}
export interface ResearchAudit {
  evidence: ResearchEvidence[];
  adoptedEvidenceIds: string[];
  coverage: SourceCoverage[];
  /** Missing original documents and single-source limitations are not affirmative absence. */
  limitations: string[];
  affiliation: {
    stage: "student" | "graduated" | "unknown";
    organization: string | null;
    evidenceIds: string[];
    reason: string;
    /** Optional dated enrollment assessment, supported by affiliation evidence; never inferred from a PB year. */
    enrollment?: { asOf: string; employerStartsOn: string | null };
  } | null;
  performances: PerformanceCandidate[];
  pbUpdate: {
    initialId: string | null;
    selectedId: string | null;
    checks: { searchIndex: number; from: string; through: string; evidenceIds: string[];
      outcome: "no-faster-found" | "faster-found" | "blocked"; note: string }[];
    foundFaster: boolean | null;
    decision: string;
  } | null;
}

/** Only the explicit leading mark is parsed; dates/meet text after a semicolon are untouched. */
function validatePerformanceMark(value: string, milliseconds: number, precision: unknown, path: string): void {
  const mark = value.split(";", 1)[0].trim();
  const parts = /^(\d+):([0-5]\d)(?::([0-5]\d))?(?:\.(\d{2}))?$/.exec(mark);
  if (!parts) c.fail(path, "performance value must start with a normalized M:SS or H:MM:SS mark, optionally .cc and semicolon context");
  const [, first, second, third, hundredths] = parts!;
  if ((hundredths === undefined ? "second" : "centisecond") !== precision)
    c.fail(path, "performance value precision mismatch");
  const seconds = third === undefined
    ? Number(first) * 60 + Number(second)
    : Number(first) * 3600 + Number(second) * 60 + Number(third);
  const parsed = seconds * 1000 + (hundredths === undefined ? 0 : Number(hundredths) * 10);
  if (!Number.isSafeInteger(parsed) || parsed !== milliseconds)
    c.fail(path, "performance value and timeMilliseconds mismatch");
}

/** Validate known metadata independently of a candidate. No year-to-edition arithmetic. */
export function validateResearchMeets(input: unknown): ResearchMeet[] {
  const seen = new Set<string>();
  return c.arr(input, "meets").map((raw, i) => {
    const p = `meets[${i}]`;
    const m = c.obj(raw, ["id", "name", "edition", "startsOn", "endsOn", "discipline", "sourceUrl", "locator", "revision", "reviewedAt"], p);
    const id = c.str(m.id, p);
    if (seen.has(id)) c.fail(p, "duplicate meet ID");
    seen.add(id);
    c.str(m.name, p); c.str(m.locator, p); c.str(m.revision, p); c.url(m.sourceUrl, p);
    if (!Number.isSafeInteger(m.edition) || (m.edition as number) < 1) c.fail(p, "invalid edition");
    const reviewed = c.date(m.reviewedAt, p);
    if (c.date(m.startsOn, p) > c.date(m.endsOn, p) || (m.endsOn as string) > reviewed) c.fail(p, "invalid meet dates");
    c.oneOf(m.discipline, ["5000m", "10000m", "half-marathon"], p);
    return m as unknown as ResearchMeet;
  });
}

export function validateResearchAudit(input: unknown, record: ResearchRecord, context: ResearchContext, path: string): void {
  const a = c.obj(input, ["evidence", "adoptedEvidenceIds", "coverage", "limitations", "affiliation", "performances", "pbUpdate"], path);
  const fail = (reason: string): never => c.fail(path, reason);
  const sources = new Map(context.sources.map((s) => [s.id, s]));
  const confirmed = record.status === "verified" || record.status === "verified-absent";
  const pb = ["5000m", "10000m", "half-marathon"].includes(record.field);
  const limitations = c.arr(a.limitations, path).map((v) => c.str(v, path));
  const evidence = new Map<string, ResearchEvidence>();
  const origins = new Map<string, string | null>();
  for (const raw of c.arr(a.evidence, path)) {
    const e = c.obj(raw, ["id", "sourceId", "role", "supports", "locator", "revision", "status", "checkedAt", "originKey", "independenceNote"], path);
    const id = c.str(e.id, path);
    if (evidence.has(id)) fail("duplicate evidence ID");
    const source = sources.get(c.str(e.sourceId, path));
    if (!source) fail("unknown evidence Source ID");
    const sourceUrl = c.url(source!.url, path);
    c.oneOf(e.role, ["primary", "event", "cross-check", "identity"], path);
    c.oneOf(e.status, ["verified", "unverified"], path);
    c.str(e.locator, path); c.str(e.revision, path); c.str(e.independenceNote, path);
    const claims = c.arr(e.supports, path);
    if (!claims.length || new Set(claims).size !== claims.length) fail("nonempty unique evidence claims required");
    claims.forEach((v) => c.oneOf(v, evidenceClaims, path));
    if (e.originKey !== null) c.str(e.originKey, path);
    if (origins.has(sourceUrl) && origins.get(sourceUrl) !== e.originKey) fail("same document cannot claim independent origins");
    origins.set(sourceUrl, e.originKey as string | null);
    if (e.checkedAt !== null && c.date(e.checkedAt, path) > record.reviewedAt) fail("evidence checked after review");
    if (e.status === "verified") {
      if (e.checkedAt === null || !record.searches.some((s) => s.checkedAt === e.checkedAt && s.sources.some((v) => v.access === "read" && c.url(v.url, path) === sourceUrl)))
        fail("verified evidence requires a dated read of its own Source");
    }
    evidence.set(id, e as unknown as ResearchEvidence);
  }
  const refs = (raw: unknown, requireVerified = false): ResearchEvidence[] => {
    const ids = c.arr(raw, path).map((v) => c.str(v, path));
    if (new Set(ids).size !== ids.length) fail("duplicate evidence reference");
    return ids.map((id) => {
      const e = evidence.get(id);
      if (!e) return fail("unknown evidence reference");
      if (requireVerified && e.status !== "verified") fail("unverified evidence cannot support adopted fact");
      return e;
    });
  };
  const supports = (es: ResearchEvidence[], claim: Claim) => es.some((e) => e.status === "verified" && e.supports.includes(claim));
  const searchAt = (index: unknown) => {
    if (!Number.isSafeInteger(index) || (index as number) < 0 || !record.searches[index as number]) fail("invalid search index");
    return record.searches[index as number];
  };
  const coverage = new Map<string, SourceCoverage>();
  for (const raw of c.arr(a.coverage, path)) {
    const row = c.obj(raw, ["category", "status", "searchIndexes", "reason"], path);
    c.oneOf(row.category, sourceCategories, path);
    const category = row.category as string;
    if (coverage.has(category)) fail("duplicate coverage category");
    c.oneOf(row.status, ["checked", "not-checked", "not-applicable", "blocked"], path);
    c.str(row.reason, path);
    const indexes = c.arr(row.searchIndexes, path);
    if (new Set(indexes).size !== indexes.length) fail("duplicate search index");
    const searches = indexes.map(searchAt);
    if (row.status === "checked" && (!searches.length || searches.some((s) => !s.sources.some((v) => v.access === "read")))) fail("checked coverage needs read searches");
    if (row.status === "blocked" && (!searches.length || !searches.some((s) => s.sources.some((v) => v.access === "unavailable")))) fail("blocked coverage needs failed access record");
    if (["not-checked", "not-applicable"].includes(row.status as string) && indexes.length) fail("unchecked coverage cannot claim searches");
    coverage.set(category, row as unknown as SourceCoverage);
  }
  if (coverage.size !== sourceCategories.length) fail("all five source categories must be explicit");
  const adopted = refs(a.adoptedEvidenceIds, confirmed);
  if (confirmed) {
    if (!adopted.length || !supports(adopted, "value")) fail("adopted value needs mapped evidence");
    const ids = new Set(adopted.map((e) => e.sourceId));
    if (record.final!.sourceIds.length !== ids.size || record.final!.sourceIds.some((id) => !ids.has(id))) fail("final Sources must match adopted evidence");
  } else if (adopted.length) fail("pending record cannot adopt evidence");
  if (!pb) {
    if (a.pbUpdate !== null || a.affiliation !== null || c.arr(a.performances, path).length) fail("biography does not require PB-specific checks");
    return;
  }
  const hasEnrollment=!!a.affiliation && typeof a.affiliation==="object" && "enrollment" in a.affiliation;
  const affiliation = c.obj(a.affiliation, ["stage", "organization", "evidenceIds", "reason", ...(hasEnrollment ? ["enrollment"] : [])], path);
  if (hasEnrollment) {
    const enrollment=c.obj(affiliation.enrollment,["asOf","employerStartsOn"],path);
    if (affiliation.stage!=="student" || c.date(enrollment.asOf,path)!==record.scope.asOf) fail("enrollment assessment must describe student status at scope.asOf");
    if (enrollment.employerStartsOn!==null) c.date(enrollment.employerStartsOn,path);
  }
  c.oneOf(affiliation.stage, ["student", "graduated", "unknown"], path);
  c.str(affiliation.reason, path);
  const affiliationEvidence = refs(affiliation.evidenceIds, confirmed);
  if (affiliation.organization !== null) c.str(affiliation.organization, path);
  if (confirmed) {
    if (affiliation.stage === "unknown" || affiliation.organization === null || !supports(affiliationEvidence, "affiliation")) fail("PB requires known affiliation with evidence");
    const requiredCategories = affiliation.stage === "graduated" ? ["university", "employer"] : ["university"];
    for (const category of requiredCategories) {
      const status = coverage.get(category)!.status;
      if (status !== "checked" && status !== "blocked") fail(`${category === "employer" ? "graduate PB requires employer" : "PB requires university"} coverage`);
      if (status === "blocked" && !limitations.length) fail("blocked required category needs limitation and alternative update evidence");
    }
    if (affiliation.stage === "student" && coverage.get("employer")!.status !== "not-applicable") fail("student employer coverage must explain not-applicable");
  }
  const performances = new Map<string, PerformanceCandidate>();
  const meets = validateResearchMeets(context.meets);
  for (const raw of c.arr(a.performances, path)) {
    const perf = c.obj(raw, ["id", "value", "timeMilliseconds", "precision", "achievedOn", "evidenceIds", "eligibility", "reason", "event"], path);
    const id = c.str(perf.id, path);
    if (performances.has(id)) fail("duplicate performance ID");
    const value = c.str(perf.value, path);
    if (!record.candidates.some((v) => v.value === value)) fail("performance must correspond to recorded candidate");
    c.str(perf.reason, path);
    c.oneOf(perf.eligibility, ["eligible", "excluded", "unconfirmed"], path);
    c.oneOf(perf.precision, ["second", "centisecond"], path);
    if (!Number.isSafeInteger(perf.timeMilliseconds) || (perf.timeMilliseconds as number) <= 0 || (perf.timeMilliseconds as number) % (perf.precision === "second" ? 1000 : 10)) fail("invalid performance time/precision");
    validatePerformanceMark(value, perf.timeMilliseconds as number, perf.precision, path);
    const achieved = c.date(perf.achievedOn, path);
    if (achieved > record.scope.asOf) fail("performance after research cutoff");
    const pe = refs(perf.evidenceIds, perf.eligibility === "eligible");
    if (perf.eligibility === "eligible" && (!supports(pe, "value") || !pe.some((e) => e.role === "primary"))) fail("eligible performance needs primary mark evidence");
    const event = c.obj(perf.event, ["metadataId", "name", "edition", "startsOn", "endsOn", "competedOn", "discipline", "distanceMetres", "editionStatus", "evidenceIds"], path);
    c.str(event.name, path);
    c.oneOf(event.discipline, ["5000m", "10000m", "half-marathon"], path);
    if (event.discipline !== record.field) fail("event discipline mismatch");
    if (event.distanceMetres !== pbDistances[event.discipline as string]) fail("event distance mismatch");
    const start = c.date(event.startsOn, path), end = c.date(event.endsOn, path), competed = c.date(event.competedOn, path);
    if (start > end || competed < start || competed > end || competed !== achieved) fail("competition date outside event or mismatched achievedOn");
    c.oneOf(event.editionStatus, ["verified", "pending"], path);
    if (event.edition !== null && (!Number.isSafeInteger(event.edition) || (event.edition as number) < 1)) fail("invalid event edition");
    if ((event.editionStatus === "pending") !== (event.edition === null)) fail("pending edition must stay null");
    const ee = refs(event.evidenceIds, perf.eligibility === "eligible");
    if (perf.eligibility === "eligible" && ["achievedOn", "meet", "distance"].some((claim) => !supports(ee, claim as Claim))) fail("eligible performance needs date/meet/distance evidence");
    if (event.editionStatus === "verified" && !supports(ee, "edition")) fail("verified edition needs edition evidence");
    if (event.editionStatus === "pending" && !limitations.length) fail("pending edition requires limitation");
    const linked = event.metadataId === null ? undefined : meets.find((m) => m.id === c.str(event.metadataId, path));
    if (event.metadataId !== null && !linked) fail("unknown meet metadata ID");
    // Explicit IDs or the exact metadata source URL, never name similarity or inferred year.
    const matched = meets.filter((m) => ee.some((e) => c.url(sources.get(e.sourceId)!.url, path) === c.url(m.sourceUrl, path)));
    for (const known of new Set([...(linked ? [linked] : []), ...matched])) {
      if (event.editionStatus !== "verified" || event.name !== known.name || event.edition !== known.edition || start !== known.startsOn || end !== known.endsOn || event.discipline !== known.discipline)
        fail("event conflicts with known meet metadata");
    }
    performances.set(id, perf as unknown as PerformanceCandidate);
  }
  const update = c.obj(a.pbUpdate, ["initialId", "selectedId", "checks", "foundFaster", "decision"], path);
  c.str(update.decision, path);
  c.oneOf(update.foundFaster, [true, false, null], path);
  const getPerformance = (id: unknown) => {
    if (id === null) return null;
    return performances.get(c.str(id, path)) ?? fail("unknown performance reference");
  };
  const initial = getPerformance(update.initialId), selected = getPerformance(update.selectedId);
  const checks = c.arr(update.checks, path);
  const completedSearches = new Set<number>();
  let reachesCutoff = false;
  for (const raw of checks) {
    const check = c.obj(raw, ["searchIndex", "from", "through", "evidenceIds", "outcome", "note"], path);
    const search = searchAt(check.searchIndex);
    const from = c.date(check.from, path), through = c.date(check.through, path);
    if (from > through || through > record.scope.asOf || through > search.checkedAt || (initial && from < initial.achievedOn)) fail("invalid subsequent search range");
    c.oneOf(check.outcome, ["no-faster-found", "faster-found", "blocked"], path);
    c.str(check.note, path);
    const es = refs(check.evidenceIds, check.outcome !== "blocked");
    if (check.outcome !== "blocked") {
      if (!supports(es, "pb-update") || es.some((e) => !search.sources.some((v) => v.access === "read" && c.url(v.url, path) === c.url(sources.get(e.sourceId)!.url, path)))) fail("update check needs its own read PB-update evidence");
      completedSearches.add(check.searchIndex as number);
      if (through === record.scope.asOf) reachesCutoff = true;
    } else if (!limitations.length || !search.sources.some((v) => v.access === "unavailable")) fail("blocked update requires access failure and limitation");
  }
  if (record.status === "verified") {
    if (!initial || !selected || selected.eligibility !== "eligible" || selected.value !== record.final!.value || !checks.length || !reachesCutoff) fail("verified PB requires initial/selected candidates and completed update range");
    const represented = new Set([...performances.values()].map((v) => v.value));
    if (record.candidates.some((v) => !represented.has(v.value))) fail("verified PB must account for every recorded candidate");
    const eligible = [...performances.values()].filter((v) => v.eligibility === "eligible");
    if (eligible.some((v) => v.timeMilliseconds < selected!.timeMilliseconds)) fail("selected PB is slower than known eligible performance");
    if ([...performances.values()].some((v) => v.eligibility === "unconfirmed" && v.timeMilliseconds < selected!.timeMilliseconds)) fail("faster unresolved candidate prevents verified PB");
    const foundFaster = eligible.some((v) => v.timeMilliseconds < initial!.timeMilliseconds);
    if (update.foundFaster !== foundFaster) fail("foundFaster conflicts with recorded candidates");
    const needed = [...selected!.evidenceIds, ...selected!.event.evidenceIds];
    if (needed.some((id) => !(a.adoptedEvidenceIds as string[]).includes(id))) fail("selected performance evidence must be adopted");
  } else if (update.selectedId !== null) fail("non-verified PB cannot select a performance");
  if (confirmed) {
    if (!reachesCutoff) fail("confirmed PB conclusion requires update evidence, not only checked=true");
    const categories = affiliation.stage === "graduated" ? ["university", "employer"] : ["university"];
    if (categories.some((cat) => coverage.get(cat)!.status === "checked" && !coverage.get(cat)!.searchIndexes.some((i) => completedSearches.has(i)))) fail("required affiliation category missing subsequent update check");
  }
}

/** Report declared lineage; multiple URLs do not establish independent evidence. */
export function researchAuditSummary(record: ResearchRecord): string {
  if (!record.audit) return "legacy v1: structured update/lineage audit unavailable";
  const adopted = record.audit.evidence.filter((e) => record.audit!.adoptedEvidenceIds.includes(e.id));
  const groups = new Set(adopted.flatMap((e) => e.originKey === null ? [] : [e.originKey]));
  const unknown = adopted.some((e) => e.originKey === null);
  const coverage = record.audit.coverage.map((v) => `${v.category}=${v.status}`).join(", ");
  const publishers=[...new Set(record.searches.flatMap((s)=>s.sources.map((v)=>v.category ?? "unclassified")))].sort().join(", ");
  return `publishers: ${publishers}; ${new Set(adopted.map((e) => e.sourceId)).size} adopted sources; ${groups.size} declared origin groups${groups.size === 1 ? " (single-origin evidence)" : ""}${unknown ? "; independence unknown" : ""}; ${record.audit.limitations.length} limitations (${record.audit.limitations.join("; ")}); coverage: ${coverage}; independent review required`;
}
