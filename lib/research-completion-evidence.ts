import type { ResearchContext, ResearchRecord, ResearchVisit } from "./research.ts";
import { researchChecks as c } from "./research-checks.ts";

/** Match classification, date and read to the SAME registered Source visit. */
function readEvidence(record: ResearchRecord, indexes: number[], context: ResearchContext | undefined, accepts: (v: ResearchVisit)=>boolean) {
  return (record.audit?.evidence ?? []).filter((e)=>{
    const source=context?.sources.find((s)=>s.id===e.sourceId);
    return source && e.status==="verified" && indexes.some((i)=>{
      const search=record.searches[i];
      return search?.checkedAt===e.checkedAt && search.sources.some((v)=>v.access==="read" && accepts(v) && c.url(v.url,"completion")===c.url(source.url,"completion"));
    });
  });
}

export function studentEmployerWaiver(record: ResearchRecord, indexes: number[], context?: ResearchContext): boolean {
  const a=record.audit?.affiliation;
  if (a?.stage!=="student" || !a.organization || a.enrollment?.asOf!==record.scope.asOf ||
      (a.enrollment.employerStartsOn!==null && a.enrollment.employerStartsOn<=record.scope.asOf)) return false;
  const evidence=readEvidence(record,indexes,context,(v)=>
    ["university","employer","federation","competition"].includes(v.category ?? "") && ["profile","announcement"].includes(v.documentType ?? ""));
  return evidence.some((e)=>a.evidenceIds.includes(e.id) && e.supports.includes("affiliation") && e.supports.includes("identity"));
}

/** Results may be HTML, PDF or a timing platform. Publisher/claims matter, not an extension. */
export function resultEvidence(record: ResearchRecord, indexes: number[], context?: ResearchContext, employerUpdate=false): boolean {
  const isResults=(v: ResearchVisit)=>v.documentType==="results" && ["university","employer","competition","federation"].includes(v.category ?? "");
  // A genuine not-found has no mark/date to corroborate: assess documented result searches
  // through the cutoff, never require invented value/date evidence just to exit research.
  if (employerUpdate || (record.status==="not-found" && !record.candidates.length))
    return record.audit?.pbUpdate?.checks.some((check)=>indexes.includes(check.searchIndex) && check.through===record.scope.asOf && check.outcome!=="blocked" &&
      readEvidence(record,[check.searchIndex],context,isResults).some((e)=>check.evidenceIds.includes(e.id) && e.supports.includes("pb-update"))) ?? false;
  const evidence=readEvidence(record,indexes,context,isResults);
  return evidence.some((e)=>e.role==="primary" && e.supports.includes("value")) &&
    ["value","achievedOn","meet","distance"].every((claim)=>evidence.some((e)=>e.supports.some((s)=>s===claim)));
}
