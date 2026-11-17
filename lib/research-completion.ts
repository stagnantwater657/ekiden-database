import type { ResearchBatch, ResearchScope, ResearchField, ResearchSearch } from "./research.ts";
import { researchFields } from "./research.ts";
import { authorizedSubjects, researchSubjectKey as key } from "./research-authorization.ts";
import { researchChecks as c } from "./research-checks.ts";

export const researchSteps = ["exact-value", "alternate-value", "event-year", "university-ranking", "university-results", "employer-profile", "employer-results", "organizer-results", "personal-profile", "federation-results", "database", "media"] as const;
type StepKind = typeof researchSteps[number];
export interface CompletionStep {
  kind: StepKind;
  status: "searched" | "blocked" | "not-applicable" | "not-started";
  searchIndexes: number[];
  alternativeSearchIndexes: number[];
  reason: string;
}
export interface CompletionSubject {
  athleteId: string;
  field: ResearchField;
  scope: ResearchScope;
  steps: CompletionStep[];
  nextActions: string[];
}
/** A separate, opt-in work scope: never rewrite earlier logs or invent earlier searches. */
export interface CompletionPlan {
  batchId: string;
  readyForReview: boolean;
  scopeNote: string;
  subjects: CompletionSubject[];
}
export interface CompletionFinding { subject: string; code: string; detail: string }
export interface CompletionReport {
  stepsComplete: boolean;
  readyForReview: boolean;
  authorizationComplete: boolean;
  exitAllowed: boolean;
  findings: CompletionFinding[];
  authorizationFindings: CompletionFinding[];
  manualChecks: CompletionFinding[];
}
const compact = (s: string) => s.normalize("NFKC").replace(/\s/g, "").toLowerCase();
const routeCategory: Partial<Record<StepKind, string>> = {
  "university-ranking":"university", "university-results":"university",
  "employer-profile":"employer", "employer-results":"employer", "organizer-results":"competition",
  "personal-profile":"athlete", "federation-results":"federation", database:"database", media:"media",
};
function markForms(value: string): string[] {
  const mark = value.split(";",1)[0].trim();
  const m = /^(\d+):([0-5]\d)(?::([0-5]\d))?(?:\.(\d{2}))?$/.exec(mark);
  if (!m) return [mark]; // Do not infer times from prose; a reviewer must normalize the candidate.
  const [,a,b,h,f] = m;
  const fraction = f === undefined ? "" : f;
  return [mark, h === undefined ? `${a}分${b}秒${fraction}` : `${a}時間${b}分${h}秒${fraction}`,
    h === undefined ? `${a}'${b}\"${fraction}` : `${a}:${b}'${h}\"${fraction}`];
}

/** Validate syntax/references and assess executed steps, not whether external facts are true. */
export function auditResearchCompletion(input: unknown, batch: ResearchBatch, authorization?: unknown): CompletionReport {
  const p = "completion";
  const plan = c.obj(input,["batchId","readyForReview","scopeNote","subjects"],p);
  if (plan.batchId !== batch.batchId) c.fail(p,"batchId mismatch");
  if (typeof plan.readyForReview !== "boolean") c.fail(p,"readyForReview must be boolean");
  c.str(plan.scopeNote,p);
  const rows = c.arr(plan.subjects,p);
  if (!rows.length) c.fail(p,"nonempty declared research scope required");
  const records = new Map(batch.records.map((r)=>[key(r),r]));
  const seen = new Set<string>();
  const findings: CompletionFinding[] = [];
  const manualChecks: CompletionFinding[] = [];
  for (const raw of rows) {
    const row = c.obj(raw,["athleteId","field","scope","steps","nextActions"],p);
    c.str(row.athleteId,p); c.oneOf(row.field,researchFields,p);
    const scope = c.obj(row.scope,["asOf","editionId","courseVersion","sectionNumber"],p);
    if (c.date(scope.asOf,p)>batch.reviewedAt) c.fail(p,"scope after batch review");
    for (const k of ["editionId","courseVersion"]) if (scope[k]!==null) c.str(scope[k],p);
    if (scope.sectionNumber!==null && (!Number.isSafeInteger(scope.sectionNumber) || (scope.sectionNumber as number)<1)) c.fail(p,"invalid sectionNumber");
    const subject = key(row as unknown as CompletionSubject);
    if (seen.has(subject)) c.fail(p,"duplicate subject");
    seen.add(subject);
    const add = (code:string,detail:string) => findings.push({subject,code,detail});
    const record = records.get(subject);
    const actions = c.arr(row.nextActions,p).map((v)=>c.str(v,p));
    const steps = new Map<StepKind,CompletionStep>();
    for (const rawStep of c.arr(row.steps,p)) {
      const step = c.obj(rawStep,["kind","status","searchIndexes","alternativeSearchIndexes","reason"],p);
      c.oneOf(step.kind,researchSteps,p); c.oneOf(step.status,["searched","blocked","not-applicable","not-started"],p); c.str(step.reason,p);
      const kind=step.kind as StepKind;
      if (steps.has(kind)) c.fail(p,"duplicate step");
      const indexes = (raw:unknown): number[] => {
        const ns=c.arr(raw,p);
        if (new Set(ns).size!==ns.length) c.fail(p,"duplicate search index");
        for (const n of ns) if (!Number.isSafeInteger(n) || (n as number)<0 || (record && !record.searches[n as number])) c.fail(p,"invalid search index");
        return ns as number[];
      };
      const refs=indexes(step.searchIndexes), alternatives=indexes(step.alternativeSearchIndexes);
      if (refs.some((i)=>alternatives.includes(i))) c.fail(p,"alternative cannot repeat failed search");
      if (step.status==="not-started" && (refs.length || alternatives.length)) c.fail(p,"not-started cannot claim searches");
      if (step.status!=="blocked" && alternatives.length) c.fail(p,"alternatives belong to blocked steps");
      steps.set(kind,step as unknown as CompletionStep);
      if (!record) continue;
      const searches=refs.map((i)=>record.searches[i]);
      const successfulAttempt=(s:ResearchSearch) => s.outcome!=="inaccessible" && (s.outcome==="not-found" || s.sources.some((v)=>v.access!=="unavailable"));
      if (step.status==="searched") {
        if (!searches.length || !searches.every(successfulAttempt)) add("unexecuted-step",`${kind}: needs actual searches, not failed access`);
        const category=routeCategory[kind];
        if (category && searches.some((s)=>s.outcome!=="not-found" && !s.sources.some((v)=>v.category===category && v.access==="read")))
          add("unread-route",`${kind}: label the actual publisher category and read the specific page`);
      }
      if (step.status==="blocked") {
        const category=routeCategory[kind];
        if (!searches.some((s)=>s.sources.some((v)=>v.access==="unavailable"))) add("missing-failure",`${kind}: actual inaccessible target and cause required`);
        else if (category && !searches.some((s)=>s.sources.some((v)=>v.access==="unavailable" && v.category===category)))
          add("unrelated-failure",`${kind}: failed target must belong to this route's publisher category`);
        if (!alternatives.length || !alternatives.map((i)=>record.searches[i]).some(successfulAttempt)) add("missing-alternative",`${kind}: execute an alternative search`);
        manualChecks.push({subject,code:"review-blocked-relevance",detail:`${kind}: independently check failure reason and relevance of alternative search indexes [${alternatives.join(", ")}]; categories do not verify content`});
      }
      if (step.status==="not-applicable") {
        const category=routeCategory[kind];
        if (!searches.length || !searches.some(successfulAttempt)) add("unsupported-waiver",`${kind}: actual discovery evidence is required`);
        // A biography can be explicitly covered by another publisher; a PB route cannot use
        // an unrelated publisher's read as proof that this route lacks a ranking/results page.
        if (["5000m","10000m","half-marathon"].includes(record.field) && category &&
            !searches.some((s)=>s.sources.some((v)=>v.category===category && v.access==="read")))
          add("unrelated-waiver",`${kind}: PB route waiver requires read discovery evidence in its own category`);
        manualChecks.push({subject,code:"review-waiver-relevance",detail:`${kind}: independently review applicability and query indexes [${refs.join(", ")}]; a reason or publisher label does not establish relevance`});
      }
      if (step.status==="not-started") add("unstarted-step",`${kind}: ${step.reason}`);
    }
    if (!record) {add("missing-record","Declared field has no structured log; unresolved fields must also be recorded");continue;}
    if (!record.audit) add("legacy-audit","v1 is readable but cannot claim v2 completion");
    if (!["verified","verified-absent"].includes(record.status) && !actions.length) add("missing-next-action","Unresolved conclusion needs a concrete next action");
    const pb=["5000m","10000m","half-marathon"].includes(record.field);
    const required: StepKind[]=pb ? ["university-ranking","university-results","organizer-results"] : ["personal-profile","university-results","employer-profile"];
    if (pb && record.audit?.affiliation?.stage!=="student") required.push("employer-profile","employer-results");
    if (pb) required.push("event-year");
    if (pb && record.candidates.length) required.push("exact-value","alternate-value");
    for (const kind of required) {
      const step=steps.get(kind);
      if (!step) {add("missing-step",`${kind}: assess applicability or execute`);continue;}
      if (step.status==="not-applicable") {
        // Known PB marks cannot be waived; other unavailable/unneeded paths need actual discovery evidence.
        if (["exact-value","alternate-value"].includes(kind) || !step.searchIndexes.length)
          add("unsupported-waiver",`${kind}: known values require reverse search; other waivers need discovery evidence`);
      }
    }
    if (pb) {
      for (const kind of ["exact-value","alternate-value"] as const) {
        const step=steps.get(kind);
        if (!step || step.status!=="searched") continue;
        const queries=step.searchIndexes.map((i)=>record.searches[i]).filter((s)=>s.stage==="reverse").map((s)=>compact(s.query));
        for (const candidate of record.candidates) {
          const forms=markForms(candidate.value).slice(kind==="exact-value" ? 0 : 1,kind==="exact-value" ? 1 : undefined);
          if (!queries.some((q)=>q.includes(compact(record.athleteName)) && forms.some((f)=>q.includes(compact(f)))))
            add("missing-value-query",`${kind}: name + ${candidate.value.split(";",1)[0]} absent from executed reverse queries`);
        }
      }
      const yearStep=steps.get("event-year");
      const terms=record.field==="half-marathon" ? ["half-marathon","ハーフ","半马"] : [record.field,record.field.replace("m","メートル")];
      if (yearStep?.status==="searched" && !yearStep.searchIndexes.some((i)=>{
        const q=compact(record.searches[i].query);
        return q.includes(compact(record.athleteName)) && terms.some((v)=>q.includes(v)) && /(?:19|20)\d{2}/.test(q);
      })) add("missing-event-year-query","Execute name + discipline + relevant year search");
    }
    if (record.status==="not-found" && ![...steps.values()].some((s)=>s.status==="searched" || s.status==="blocked")) add("unsearched-not-found","not-found needs an actually searched applicable scope");
  }
  for (const r of batch.records) if (!seen.has(key(r))) findings.push({subject:key(r),code:"unplanned-record",detail:"Every log record must be accounted for in declared scope"});
  const authorizationFindings: CompletionFinding[]=[];
  if (authorization===undefined) authorizationFindings.push({subject:batch.batchId,code:"authorization-missing",detail:"No independently supplied authorization; legacy progress is readable, scope is NOT ASSESSED"});
  else {
    const expected=new Set(authorizedSubjects(authorization,batch.batchId).map(key));
    for (const id of expected) {
      if (!seen.has(id)) authorizationFindings.push({subject:id,code:"authorized-plan-missing",detail:"Authorized field missing from completion plan"});
      if (!records.has(id)) authorizationFindings.push({subject:id,code:"authorized-record-missing",detail:"Authorized field missing from research records"});
    }
    for (const id of new Set([...seen,...records.keys()])) if (!expected.has(id))
      authorizationFindings.push({subject:id,code:"outside-authorization",detail:"Plan/record is outside the independently authorized scope"});
  }
  const stepsComplete=findings.length===0, readyForReview=plan.readyForReview as boolean;
  const authorizationComplete=authorizationFindings.length===0;
  return {stepsComplete,readyForReview,authorizationComplete,exitAllowed:stepsComplete && readyForReview && authorizationComplete,findings,authorizationFindings,manualChecks};
}

export function validateCompletionClaim(plan: unknown, batch: ResearchBatch, authorization?: unknown): CompletionReport {
  const report=auditResearchCompletion(plan,batch,authorization);
  if (report.readyForReview && (!report.stepsComplete || (authorization!==undefined && !report.authorizationComplete)))
    c.fail("completion",`premature completion: ${[...report.findings,...report.authorizationFindings].map((v)=>v.code+": "+v.detail).join("; ")}`);
  return report;
}
