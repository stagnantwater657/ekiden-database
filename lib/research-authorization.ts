import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ResearchField, ResearchScope } from "./research.ts";
import { researchFields } from "./research.ts";
import { researchChecks as c } from "./research-checks.ts";

export interface AuthorizedSubject { athleteId: string; field: ResearchField; scope: ResearchScope }
/** Supplied by the task owner/reviewer, independently of research results and the completion plan. */
export interface ResearchAuthorization {
  schemaVersion: 1;
  batchId: string;
  authorizedBy: string;
  reference: string;
  authorizedAt: string;
  assignments: { athleteIds: string[]; fields: ResearchField[]; scope: ResearchScope }[];
}
export const researchSubjectKey = (r: AuthorizedSubject) => JSON.stringify([r.athleteId,r.field,r.scope.asOf,r.scope.editionId,r.scope.courseVersion,r.scope.sectionNumber]);

/** Expand each expressly authorized athlete × field group, never infer five required fields. */
export function authorizedSubjects(input: unknown, batchId: string): AuthorizedSubject[] {
  const p="authorization";
  const a=c.obj(input,["schemaVersion","batchId","authorizedBy","reference","authorizedAt","assignments"],p);
  if (a.schemaVersion!==1 || a.batchId!==batchId) c.fail(p,"version or batchId mismatch");
  c.str(a.authorizedBy,p); c.url(a.reference,p); c.date(a.authorizedAt,p);
  const groups=c.arr(a.assignments,p), seen=new Set<string>(), subjects:AuthorizedSubject[]=[];
  if (!groups.length) c.fail(p,"empty authorized scope");
  for (const raw of groups) {
    const group=c.obj(raw,["athleteIds","fields","scope"],p);
    const athletes=c.arr(group.athleteIds,p).map((v)=>c.str(v,p));
    const fields=c.arr(group.fields,p);
    if (!athletes.length || !fields.length) c.fail(p,"nonempty athlete and field sets required");
    fields.forEach((f)=>c.oneOf(f,researchFields,p));
    const scope=c.obj(group.scope,["asOf","editionId","courseVersion","sectionNumber"],p);
    c.date(scope.asOf,p);
    if (scope.editionId!==null) c.str(scope.editionId,p);
    if (scope.courseVersion!==null && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.str(scope.courseVersion,p))) c.fail(p,"invalid courseVersion");
    if (scope.sectionNumber!==null && (!Number.isSafeInteger(scope.sectionNumber) || (scope.sectionNumber as number)<1)) c.fail(p,"invalid sectionNumber");
    for (const athleteId of athletes) for (const field of fields as ResearchField[]) {
      const event=["race-result","section-record","award","statistic"].includes(field);
      if (!event && [scope.editionId,scope.courseVersion,scope.sectionNumber].some((v)=>v!==null)) c.fail(p,"PB/biography scope cannot contain event qualifiers");
      if (event && scope.editionId===null) c.fail(p,"event scope requires editionId");
      if (field==="section-record" && (scope.courseVersion===null || scope.sectionNumber===null)) c.fail(p,"record scope requires course/section");
      const subject={athleteId,field,scope:scope as unknown as ResearchScope};
      const id=researchSubjectKey(subject);
      if (seen.has(id)) c.fail(p,"duplicate authorized subject");
      seen.add(id);subjects.push(subject);
    }
  }
  return subjects;
}

/** The expected digest must come from the task owner, NOT from the executor's plan or generated output.
 * This pins bytes, not a person's identity or the truth of an approval URL. Review remains necessary.
 */
export function readResearchAuthorization(path: string, expectedSha256: string): ResearchAuthorization {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) c.fail("authorization","expected task-owner SHA-256 required");
  const bytes=readFileSync(path);
  if (createHash("sha256").update(bytes).digest("hex")!==expectedSha256) c.fail("authorization","SHA-256 mismatch; scope cannot be silently replaced");
  const raw=JSON.parse(bytes.toString("utf8"));
  authorizedSubjects(raw, c.str(raw?.batchId,"authorization.batchId"));
  return raw as ResearchAuthorization;
}
