import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, cpSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { authorizedSubjects, readResearchAuthorization, type ResearchAuthorization } from "../lib/research-authorization.ts";
import { execFileSync, spawnSync } from "node:child_process";
import { auditResearchCompletion, validateCompletionClaim, type CompletionPlan, type CompletionStep } from "../lib/research-completion.ts";
import { validateResearchBatch, researchSourceCategories, type ResearchBatch, type ResearchContext, type ResearchField } from "../lib/research.ts";
import { createResearchContext } from "../lib/research-context.ts";
import fixture from "./fixtures/research/v2.json" with { type:"json" };
import cases from "./fixtures/research/round3-cases.json" with { type:"json" };
import demo from "../data/research/batches/2026-11-17-completion-demo.json" with { type:"json" };
import demoPlan from "../data/research/completion/2026-11-17-completion-demo.json" with { type:"json" };

// These are constructed failure scenarios, not fabricated real searches or web fact verification.
function scenario(example=cases[0]) {
  const {batch,context}=structuredClone(fixture) as unknown as {batch:ResearchBatch;context:ResearchContext};
  const r=batch.records[0], a=r.audit!;
  r.athleteName=example.name;context.athletes=[{...context.athletes[0],name:example.name}];
  r.field=example.field as ResearchField;r.status="candidate";r.final=null;r.unresolved=["SYNTHETIC: requires independent verification"];
  const pb=["5000m","10000m","half-marathon"].includes(r.field);
  r.pbScope=pb ? "current" : null;
  r.candidates=[{...r.candidates[0],value:example.mark}];
  a.adoptedEvidenceIds=[];a.performances=[];
  a.pbUpdate=pb ? {initialId:null,selectedId:null,checks:[],foundFaster:null,decision:"SYNTHETIC unresolved"} : null;
  if (!pb) a.affiliation=null;
  const subject={athleteId:r.athleteId,field:r.field,scope:r.scope,steps:[] as CompletionStep[],nextActions:["Read original results; independently resolve identity and timing"]};
  const plan:CompletionPlan={batchId:batch.batchId,readyForReview:true,scopeNote:"SYNTHETIC scoped unit-test inputs, not external verification",subjects:[subject]};
  const add=(kind:CompletionStep["kind"],query:string,category?:typeof researchSourceCategories[number])=>{
    const index=r.searches.length;
    r.searches.push({stage:"reverse",query,checkedAt:r.reviewedAt,outcome:"found",sources:[{url:`https://synthetic-research-fixture.org/${kind}`,section:"SYNTHETIC",access:"read",finding:"SYNTHETIC, never visited",...(category ? {category}:{})}],result:"SYNTHETIC"});
    subject.steps.push({kind,status:"searched",searchIndexes:[index],alternativeSearchIndexes:[],reason:"SYNTHETIC executed operation"});
    if (kind.endsWith("results")) {
      r.searches[index].sources[0].documentType="results";
      const id=`fixture-${kind}`;
      context.sources=[...context.sources,{...context.sources[0],id,url:r.searches[index].sources[0].url}];
      a.evidence.push({id,sourceId:id,role:"primary",supports:["value","achievedOn","meet","distance","pb-update"],locator:"SYNTHETIC result row",revision:"synthetic",status:"verified",checkedAt:r.reviewedAt,originKey:id,independenceNote:"synthetic only"});
      a.pbUpdate?.checks.push({searchIndex:index,from:r.scope.asOf,through:r.scope.asOf,evidenceIds:[id],outcome:"no-faster-found",note:"SYNTHETIC result update range"});
    }
  };
  if (pb) {
    add("exact-value",`${r.athleteName} ${example.mark}`);
    const pieces=example.mark.split(/[:.]/);
    const alternate=example.field==="half-marathon" ? `${pieces[0]}時間${pieces[1]}分${pieces[2]}秒` : `${pieces[0]}分${pieces[1]}秒${pieces[2]}`;
    add("alternate-value",`${r.athleteName} ${alternate}`);
    add("event-year",`${r.athleteName} ${r.field} ${example.date!.slice(0,4)}`);
    add("university-ranking","SYNTHETIC historical ranking","university");
    add("employer-results","SYNTHETIC employer annual results","employer");
    add("organizer-results","SYNTHETIC original results","competition");
  }
  add("university-results","SYNTHETIC university annual archive","university");
  add("employer-profile","SYNTHETIC employer biography","employer");
  add("personal-profile","SYNTHETIC personal biography","athlete");
  if (example.id==="R22") add("federation-results","SYNTHETIC federation historical record","federation");
  return {batch,context,plan,r,step:(kind:string)=>subject.steps.find((s)=>s.kind===kind)!};
}
for (const example of cases) test(`${example.id}: ${example.step} omission detected; explicit research remains unresolved and reviewable`,()=>{
  const d=scenario(example);
  validateResearchBatch(d.batch,d.context);
  assert.equal(validateCompletionClaim(d.plan,d.batch,undefined,d.context).stepsComplete,true);
  const step=d.step(example.step);step.status="not-started";step.searchIndexes=[];
  assert.ok(auditResearchCompletion(d.plan,d.batch,undefined,d.context).findings.some((f)=>f.detail.includes(example.step)));
  assert.throws(()=>validateCompletionClaim(d.plan,d.batch,undefined,d.context),/premature completion/);
});

// Dated status and evidence are synthetic declarations for logic tests, not website verification.
function studentScenario() {
  const d=scenario(), a=d.r.audit!;
  a.affiliation={stage:"student",organization:"SYNTHETIC university",evidenceIds:["student-status"],reason:"SYNTHETIC current roster: enrolled, no current employer",
    enrollment:{asOf:d.r.scope.asOf,employerStartsOn:null}};
  const index=d.step("university-results").searchIndexes[0];
  const source=d.r.searches[index].sources[0];source.documentType="profile";
  // Keep the separate result visit usable as final results; the status read is a separate query.
  const statusIndex=d.r.searches.length;
  d.r.searches.push(structuredClone(d.r.searches[index]));
  source.documentType="results";
  const original=a.evidence.find((e)=>e.id==="fixture-university-results")!;
  a.evidence.push({...original,id:"student-status",role:"identity",supports:["identity","affiliation"],locator:"SYNTHETIC dated enrollment and employment status"});
  for (const kind of ["employer-profile","employer-results"]) {
    const step=d.step(kind);step.status="not-applicable";step.searchIndexes=[statusIndex];step.reason="SYNTHETIC student at cutoff, no applicable employer";
  }
  a.coverage.find((v)=>v.category==="employer")!.status="not-applicable";
  a.coverage.find((v)=>v.category==="employer")!.searchIndexes=[];
  return d;
}

test("dated enrolled student may waive both employer routes using identity evidence, with manual review",()=>{
  const d=studentScenario();validateResearchBatch(d.batch,d.context);
  const report=validateCompletionClaim(d.plan,d.batch,ownerScope(d.batch.batchId),d.context);
  assert.equal(report.exitAllowed,true);
  assert.equal(report.manualChecks.filter((f)=>f.code==="review-waiver-relevance").length,2);
});

test("graduate or already-employed student cannot waive employer profile or results",()=>{
  for (const stage of ["graduated","unknown"] as const) {
    const d=studentScenario();d.r.audit!.affiliation!.stage=stage;delete d.r.audit!.affiliation!.enrollment;
    assert.equal(auditResearchCompletion(d.plan,d.batch,undefined,d.context).findings.filter((f)=>f.code==="unconfirmed-student-waiver").length,2);
  }
  for (const startsOn of ["2026-11-16","2026-04-01"]) {
    const d=studentScenario();d.r.audit!.affiliation!.enrollment!.employerStartsOn=startsOn;
    assert.equal(auditResearchCompletion(d.plan,d.batch,undefined,d.context).stepsComplete,false);
  }
});

test("student label alone, historical rankings or missing identity/source proof cannot waive employer work",()=>{
  for (const missing of ["date","claim","verified","profile","source","affiliation-reference"] as const) {
    const d=studentScenario(),e=d.r.audit!.evidence.find((e)=>e.id==="student-status")!;
    if (missing==="date") delete d.r.audit!.affiliation!.enrollment;
    if (missing==="claim") e.supports=["affiliation"];
    if (missing==="verified") e.status="unverified";
    if (missing==="profile") d.r.searches[d.step("employer-profile").searchIndexes[0]].sources[0].documentType="ranking";
    if (missing==="source") d.context.sources=d.context.sources.filter((s)=>s.id!==e.sourceId);
    if (missing==="affiliation-reference") d.r.audit!.affiliation!.evidenceIds=[];
    assert.equal(auditResearchCompletion(d.plan,d.batch,undefined,d.context).stepsComplete,false,missing);
  }
  const d=studentScenario();
  assert.equal(auditResearchCompletion(d.plan,d.batch).stepsComplete,false,"no registered source context must not grant evidence waiver");
  delete d.r.audit!.affiliation!.enrollment;d.plan.readyForReview=false;
  validateResearchBatch(d.batch,d.context);
  assert.equal(validateCompletionClaim(d.plan,d.batch,undefined,d.context).stepsComplete,false,"honest unfinished v2 progress remains saveable");
});

test("future employer announcement is not current employment; mismatched enrollment cutoff is invalid",()=>{
  const d=studentScenario();d.r.audit!.affiliation!.enrollment!.employerStartsOn="2027-04-01";
  const visit=d.r.searches[d.step("employer-profile").searchIndexes[0]].sources[0];
  visit.documentType="announcement";visit.category="employer";
  validateResearchBatch(d.batch,d.context);
  assert.equal(auditResearchCompletion(d.plan,d.batch,undefined,d.context).stepsComplete,true);
  d.r.audit!.affiliation!.enrollment!.asOf="2026-10-01";
  assert.throws(()=>validateResearchBatch(d.batch,d.context),/enrollment assessment/);
});

test("no organizer search remains incomplete even with a complete university final result",()=>{
  const d=scenario();d.step("organizer-results").status="not-started";d.step("organizer-results").searchIndexes=[];
  assert.ok(auditResearchCompletion(d.plan,d.batch,undefined,d.context).findings.some((f)=>f.code==="unstarted-step"));
});

test("official HTML results and federation timing results need no PDF",()=>{
  for (const category of ["competition","federation"] as const) {
    const d=scenario();d.r.searches[d.step("organizer-results").searchIndexes[0]].sources[0].category=category;
    validateResearchBatch(d.batch,d.context);
    assert.equal(auditResearchCompletion(d.plan,d.batch,undefined,d.context).stepsComplete,true);
  }
});

function blockedScenario(kind="organizer-results") {
  const d=scenario(),step=d.step(kind),s=d.r.searches[step.searchIndexes[0]];
  step.status="blocked";step.reason="SYNTHETIC attempted exact result URL, HTTP 404; university result alternative";
  s.outcome="inaccessible";s.sources[0].access="unavailable";s.sources[0].finding="SYNTHETIC HTTP 404";
  step.alternativeSearchIndexes=d.step("university-results").searchIndexes;
  d.r.audit!.limitations=["SYNTHETIC original unavailable; alternative results and post-graduation coverage need independent review"];
  // Failed visits cannot continue claiming verified evidence or completed update checks.
  const failedId=`fixture-${kind}`;
  d.r.audit!.evidence=d.r.audit!.evidence.filter((e)=>e.id!==failedId);
  d.r.audit!.pbUpdate!.checks=d.r.audit!.pbUpdate!.checks.filter((c)=>c.searchIndex!==step.searchIndexes[0]);
  return d;
}

test("actual failed organizer search with linked alternative results is eligible only for human review",()=>{
  const d=blockedScenario();validateResearchBatch(d.batch,d.context);
  const report=validateCompletionClaim(d.plan,d.batch,ownerScope(d.batch.batchId),d.context);
  assert.equal(report.exitAllowed,true);assert.equal(d.r.status,"candidate");assert.equal(d.r.final,null);
  assert.ok(report.manualChecks.some((f)=>f.code==="review-blocked-relevance"));
});

test("searched official archive with no public original can exit as blocked without inventing HTTP failure",()=>{
  const d=blockedScenario(),s=d.r.searches[d.step("organizer-results").searchIndexes[0]];
  s.outcome="not-found";s.sources[0].access="read";s.sources[0].documentType="navigation";
  s.sources[0].finding="SYNTHETIC official archive read, no public result for this meet";
  validateResearchBatch(d.batch,d.context);
  assert.equal(auditResearchCompletion(d.plan,d.batch,undefined,d.context).stepsComplete,true);
  s.sources[0].category="media";
  assert.ok(auditResearchCompletion(d.plan,d.batch,undefined,d.context).findings.some((f)=>f.code==="missing-failure"));
});

test("blocked without actual query, result evidence or limitations remains incomplete",()=>{
  for (const missing of ["queries","failure","alternative","claims","limitation"] as const) {
    const d=blockedScenario(),step=d.step("organizer-results");
    if (missing==="queries") step.searchIndexes=[];
    if (missing==="failure") d.r.searches[step.searchIndexes[0]].sources[0].access="search-snippet";
    if (missing==="alternative") step.alternativeSearchIndexes=[];
    if (missing==="claims") d.r.audit!.evidence.find((e)=>e.id==="fixture-university-results")!.supports=["value"];
    if (missing==="limitation") d.r.audit!.limitations=[];
    assert.equal(auditResearchCompletion(d.plan,d.batch,undefined,d.context).stepsComplete,false,missing);
  }
  const d=blockedScenario();d.r.searches[d.step("organizer-results").searchIndexes[0]].query="";
  assert.throws(()=>validateResearchBatch(d.batch,d.context),/non-empty/);
});

test("not-found result research uses actual update coverage without inventing a mark or achievement date",()=>{
  const d=blockedScenario();d.r.status="not-found";d.r.candidates=[];
  const e=d.r.audit!.evidence.find((e)=>e.id==="fixture-university-results")!;e.supports=["pb-update"];
  validateResearchBatch(d.batch,d.context);
  assert.equal(auditResearchCompletion(d.plan,d.batch,undefined,d.context).stepsComplete,true);
  d.r.audit!.pbUpdate!.checks=[];
  assert.equal(auditResearchCompletion(d.plan,d.batch,undefined,d.context).stepsComplete,false);
});

test("student waiver cannot combine a different day's profile with a dated results read",()=>{
  const d=studentScenario();
  const profileIndex=d.step("employer-profile").searchIndexes[0];
  d.r.searches[profileIndex].checkedAt="2026-11-15";
  for (const kind of ["employer-profile","employer-results"]) d.step(kind).searchIndexes.push(...d.step("university-results").searchIndexes);
  assert.equal(auditResearchCompletion(d.plan,d.batch,undefined,d.context).stepsComplete,false);
});

test("graduate employer profile is not result coverage; actual result updates must reach cutoff",()=>{
  const d=scenario(),index=d.step("employer-results").searchIndexes[0];
  d.r.searches[index].sources[0].documentType="profile";
  assert.ok(auditResearchCompletion(d.plan,d.batch,undefined,d.context).findings.some((f)=>f.code==="missing-employer-update"));
  d.r.searches[index].sources[0].documentType="results";
  d.r.audit!.pbUpdate!.checks.find((c)=>c.searchIndex===index)!.through="2026-01-01";
  assert.equal(auditResearchCompletion(d.plan,d.batch,undefined,d.context).stepsComplete,false);
});

test("graduate blocked employer results need alternative result updates, not old university PB/profile alone",()=>{
  const d=blockedScenario("employer-results");validateResearchBatch(d.batch,d.context);
  assert.equal(auditResearchCompletion(d.plan,d.batch,undefined,d.context).stepsComplete,true);
  const alt=d.step("university-results").searchIndexes[0];
  d.r.audit!.pbUpdate!.checks=d.r.audit!.pbUpdate!.checks.filter((c)=>c.searchIndex!==alt);
  assert.ok(auditResearchCompletion(d.plan,d.batch,undefined,d.context).findings.some((f)=>f.code==="missing-alternative-evidence"));
});

test("candidate/conflict/not-found/verified all receive completion assessment and pending states need next actions",()=>{
  for (const status of ["candidate","conflict","not-found"] as const) {
    const d=scenario();d.r.status=status;
    if (status==="not-found") d.r.candidates=[];
    validateResearchBatch(d.batch,d.context);
    assert.equal(auditResearchCompletion(d.plan,d.batch,undefined,d.context).stepsComplete,true);
    d.plan.subjects[0].nextActions=[];
    assert.ok(auditResearchCompletion(d.plan,d.batch,undefined,d.context).findings.some((f)=>f.code==="missing-next-action"));
  }
  const d=structuredClone(fixture) as unknown as {batch:ResearchBatch;context:ResearchContext};
  validateResearchBatch(d.batch,d.context);
  const r=d.batch.records[0];
  const plan={batchId:d.batch.batchId,scopeNote:"synthetic",readyForReview:false,subjects:[{athleteId:r.athleteId,field:r.field,scope:r.scope,steps:[],nextActions:[]}]};
  assert.ok(auditResearchCompletion(plan,d.batch).findings.some((f)=>f.code==="missing-step"));
});

test("declared scope detects omitted unresolved fields, unplanned rows and duplicates",()=>{
  const d=scenario();
  d.plan.subjects.push({...structuredClone(d.plan.subjects[0]),field:"highSchool",steps:[]});
  assert.ok(auditResearchCompletion(d.plan,d.batch,undefined,d.context).findings.some((f)=>f.code==="missing-record"));
  d.plan.subjects.shift();
  assert.ok(auditResearchCompletion(d.plan,d.batch,undefined,d.context).findings.some((f)=>f.code==="unplanned-record"));
  d.plan.subjects.push(structuredClone(d.plan.subjects[0]));
  assert.throws(()=>auditResearchCompletion(d.plan,d.batch,undefined,d.context),/duplicate subject/);
});

test("PB reverse search must actually contain name and exact/alternate marks; generic WA query is insufficient",()=>{
  for (const kind of ["exact-value","alternate-value","event-year"]) {
    const d=scenario();d.r.searches[d.step(kind).searchIndexes[0]].query="WA personal best";
    assert.ok(auditResearchCompletion(d.plan,d.batch,undefined,d.context).findings.some((f)=>f.code.startsWith("missing-")));
  }
  const d=scenario();d.step("exact-value").status="not-applicable";
  assert.ok(auditResearchCompletion(d.plan,d.batch,undefined,d.context).findings.some((f)=>f.code==="unsupported-waiver"));
});

test("404/blocked needs actual target, reason and distinct executed alternative; legitimate unresolved is allowed",()=>{
  const d=scenario(),step=d.step("organizer-results");step.status="blocked";
  assert.ok(auditResearchCompletion(d.plan,d.batch,undefined,d.context).findings.some((f)=>f.code==="missing-failure"));
  const s=d.r.searches[step.searchIndexes[0]];s.outcome="inaccessible";s.sources[0].access="unavailable";s.sources[0].finding="SYNTHETIC HTTP 404";
  assert.ok(auditResearchCompletion(d.plan,d.batch,undefined,d.context).findings.some((f)=>f.code==="missing-alternative"));
  step.alternativeSearchIndexes=d.step("university-results").searchIndexes;
  assert.equal(validateCompletionClaim(d.plan,d.batch,undefined,d.context).stepsComplete,true);
  step.alternativeSearchIndexes=step.searchIndexes;
  assert.throws(()=>auditResearchCompletion(d.plan,d.batch,undefined,d.context),/alternative cannot repeat/);
});

test("university annual results can be read without a PB table; no fake blocked classification needed",()=>{
  const d=scenario(),step=d.step("university-ranking");
  step.status="not-applicable";step.reason="SYNTHETIC site navigation found annual results, no historical PB ranking";
  step.searchIndexes=d.step("university-results").searchIndexes;
  assert.equal(validateCompletionClaim(d.plan,d.batch,undefined,d.context).stepsComplete,true);
  step.searchIndexes=[];
  assert.ok(auditResearchCompletion(d.plan,d.batch,undefined,d.context).findings.some((f)=>f.code==="unsupported-waiver"));
});

test("all seven publisher categories accepted; a supporter site or snippet is not a read university route",()=>{
  const d=scenario();
  for (const category of researchSourceCategories) {
    d.r.searches[0].sources[0].category=category;
    validateResearchBatch(d.batch,d.context);
  }
  const s=d.r.searches[d.step("university-results").searchIndexes[0]].sources[0];
  s.category="media";
  assert.ok(auditResearchCompletion(d.plan,d.batch,undefined,d.context).findings.some((f)=>f.code==="unread-route"));
  s.category="university";s.access="search-snippet";
  assert.ok(auditResearchCompletion(d.plan,d.batch,undefined,d.context).findings.some((f)=>f.code==="unread-route"));
});

test("R23: known 2025 28:08.02 cannot be replaced by slower 2026 28:12.22",()=>{
  const d=structuredClone(fixture) as unknown as {batch:ResearchBatch;context:ResearchContext};
  const r=d.batch.records[0];r.field="10000m";
  d.context.meets=d.context.meets.map((m)=>({...m,discipline:"10000m"}));
  const marks=["28:08.02","28:12.22"], times=[1688020,1692220];
  r.audit!.performances.forEach((p,i)=>{
    const old=p.value;p.value=marks[i];p.timeMilliseconds=times[i];p.event.discipline="10000m";p.event.distanceMetres=10000;
    r.candidates.find((c)=>c.value===old)!.value=p.value;
    if (r.final!.value===old) r.final!.value=p.value;
  });
  const latest=r.audit!.performances[1];latest.event.metadataId=null;latest.event.name="SYNTHETIC later 2026 event";
  latest.achievedOn=latest.event.startsOn=latest.event.endsOn=latest.event.competedOn="2026-06-01";
  // Keep the later event separate from the synthetic catalog's exact source URL.
  d.context.meets=[];
  const earlier=r.audit!.performances[0];
  earlier.achievedOn=earlier.event.startsOn=earlier.event.endsOn=earlier.event.competedOn="2025-11-29";
  r.audit!.pbUpdate!.checks.forEach((check)=>{check.from="2025-11-29";});
  assert.throws(()=>validateResearchBatch(d.batch,d.context),/slower than known eligible/);
  r.audit!.performances[0].eligibility="unconfirmed";
  assert.throws(()=>validateResearchBatch(d.batch,d.context),/faster unresolved/);
});

test("CLI and tests share registered meets; missing context is configuration failure, never pending workaround",()=>{
  const context=createResearchContext();
  assert.ok(context.meets.some((m)=>m.id==="marugame-2025-77"));
  const d=structuredClone(fixture) as unknown as {batch:ResearchBatch;context:ResearchContext};
  const known=context.meets[0];
  d.context=createResearchContext({...d.context,meets:context.meets});
  const r=d.batch.records[0];r.status="candidate";r.final=null;r.unresolved=["synthetic context test"];r.field="half-marathon";
  r.audit!.adoptedEvidenceIds=[];r.audit!.pbUpdate={initialId:null,selectedId:null,foundFaster:null,decision:"pending synthetic",checks:[]};
  r.audit!.performances=[r.audit!.performances[0]];
  const perf=r.audit!.performances[0];
  perf.achievedOn=known.startsOn;perf.event={...perf.event,metadataId:known.id,name:known.name,edition:77,editionStatus:"verified",startsOn:known.startsOn,endsOn:known.endsOn,competedOn:known.startsOn,discipline:"half-marathon",distanceMetres:21097.5};
  validateResearchBatch(d.batch,d.context);
  perf.event.edition=null;perf.event.editionStatus="pending";r.audit!.limitations=["cannot bypass"];
  assert.throws(()=>validateResearchBatch(d.batch,d.context),/conflicts with known/);
  assert.throws(()=>validateResearchBatch(d.batch,{...d.context,meets:undefined} as unknown as ResearchContext),/explicit meet context/);
});

test("real two-field demonstration stays candidate; omitted work is surfaced, no production facts adopted",()=>{
  const batch=validateResearchBatch(demo,createResearchContext());
  const report=validateCompletionClaim(demoPlan,batch);
  assert.equal(report.stepsComplete,false);assert.equal(report.findings.length,2);
  assert.ok(report.findings.every((f)=>f.subject.includes("athlete-aj24-04-2")));
  assert.ok(batch.records.every((r)=>r.status==="candidate" && r.final===null));
  assert.ok(report.findings.some((f)=>f.detail.includes("employer-results")));
  const result=spawnSync(process.execPath,["--experimental-strip-types","scripts/research-validate.ts","--completion",batch.batchId],{encoding:"utf8"});
  assert.equal(result.status,1);assert.match(result.stdout,/steps INCOMPLETE/);
  const absent=spawnSync(process.execPath,["--experimental-strip-types","scripts/research-validate.ts","--completion","no-plan"],{encoding:"utf8"});
  assert.equal(absent.status,1);assert.match(absent.stderr,/unassessed/);
  assert.match(execFileSync(process.execPath,["--experimental-strip-types","scripts/research-validate.ts"],{encoding:"utf8"}),/NOT ASSESSED/);
});


// Authorization comes from an independently specified owner fixture, not a filtered plan.
function ownerScope(batchId: string, athleteIds=["fixture-athlete"], fields: ResearchField[]=["5000m"]): ResearchAuthorization {
  return {schemaVersion:1,batchId,authorizedBy:"SYNTHETIC task owner",reference:"https://synthetic-research-fixture.org/owner-task",authorizedAt:"2026-11-16",
    assignments:[{athleteIds,fields,scope:{asOf:"2026-11-16",editionId:null,courseVersion:null,sectionNumber:null}}]};
}

test("steps, executor submission and exit eligibility are independent; honest progress remains valid",()=>{
  const d=scenario(), auth=ownerScope(d.batch.batchId);
  d.plan.readyForReview=false;
  const saved=validateCompletionClaim(d.plan,d.batch,auth,d.context);
  assert.deepEqual([saved.stepsComplete,saved.readyForReview,saved.authorizationComplete,saved.exitAllowed],[true,false,true,false]);
  d.plan.readyForReview=true;
  assert.equal(validateCompletionClaim(d.plan,d.batch,auth,d.context).exitAllowed,true);
  const legacy=validateCompletionClaim(d.plan,d.batch,undefined,d.context);
  assert.equal(legacy.stepsComplete,true);assert.equal(legacy.authorizationComplete,false);assert.equal(legacy.exitAllowed,false);
  d.plan.readyForReview=false;d.step("university-ranking").status="not-started";d.step("university-ranking").searchIndexes=[];
  assert.equal(validateCompletionClaim(d.plan,d.batch,auth,d.context).stepsComplete,false);
});

test("independent 5 athletes × 5 fields rejects only 15 submitted to BOTH plan and records",()=>{
  const ids=Array.from({length:5},(_,i)=>`fixture-athlete-${i}`);
  const fields:ResearchField[]=["birthDate","highSchool","5000m","10000m","half-marathon"];
  const d=scenario();d.batch.records=[];d.plan.subjects=[];
  const scope=ownerScope(d.batch.batchId,ids,fields);
  d.context.athletes=ids.map((id)=>({...d.context.athletes[0],id}));
  // First build all 25 fully structured records and corresponding steps, then omit two fields per athlete.
  for (const id of ids) for (const field of fields) {
    const example=field==="highSchool" ? {...cases[3],field,mark:"SYNTHETIC school"} : cases.find((c)=>c.field===field)!;
    const item=scenario({...example,name:d.context.athletes[0].name});
    item.r.athleteId=id;item.plan.subjects[0].athleteId=id;
    d.context.sources=[...new Map([...d.context.sources,...item.context.sources].map(v=>[v.id,v])).values()];
    d.batch.records.push(item.r);d.plan.subjects.push(item.plan.subjects[0]);
  }
  validateResearchBatch(d.batch,d.context);
  assert.equal(authorizedSubjects(scope,d.batch.batchId).length,25);
  assert.equal(validateCompletionClaim(d.plan,d.batch,scope,d.context).exitAllowed,true);
  d.batch.records=d.batch.records.filter((r)=>!["birthDate","highSchool"].includes(r.field));
  d.plan.subjects=d.plan.subjects.filter((r)=>!["birthDate","highSchool"].includes(r.field));
  assert.equal(d.batch.records.length,15);assert.equal(d.plan.subjects.length,15);
  validateResearchBatch(d.batch,d.context);
  const report=auditResearchCompletion(d.plan,d.batch,scope,d.context);
  assert.equal(report.stepsComplete,true);assert.equal(report.authorizationComplete,false);assert.equal(report.exitAllowed,false);
  assert.equal(report.authorizationFindings.filter((f)=>f.code==="authorized-plan-missing").length,10);
  assert.equal(report.authorizationFindings.filter((f)=>f.code==="authorized-record-missing").length,10);
  assert.throws(()=>validateCompletionClaim(d.plan,d.batch,scope,d.context),/authorized-plan-missing/);
});

test("explicit partial-field authorizations pass; extra fields, changed cutoff and duplicate grants do not",()=>{
  const d=scenario(cases[3]);
  const auth=ownerScope(d.batch.batchId,["fixture-athlete"],["birthDate"]);
  assert.equal(validateCompletionClaim(d.plan,d.batch,auth,d.context).exitAllowed,true);
  const overrun=ownerScope(d.batch.batchId,["fixture-athlete"],["highSchool"]);
  assert.ok(auditResearchCompletion(d.plan,d.batch,overrun,d.context).authorizationFindings.some((f)=>f.code==="outside-authorization"));
  const changed=structuredClone(auth);changed.assignments[0].scope.asOf="2026-11-15";
  assert.equal(auditResearchCompletion(d.plan,d.batch,changed,d.context).exitAllowed,false);
  const partial=ownerScope(d.batch.batchId,["fixture-a"],["birthDate"]);
  partial.assignments.push({...structuredClone(partial.assignments[0]),athleteIds:["fixture-b"],fields:["5000m"]});
  assert.deepEqual(authorizedSubjects(partial,d.batch.batchId).map((v)=>[v.athleteId,v.field]),[["fixture-a","birthDate"],["fixture-b","5000m"]]);
  auth.assignments.push(structuredClone(auth.assignments[0]));
  assert.throws(()=>authorizedSubjects(auth,d.batch.batchId),/duplicate authorized subject/);
  assert.throws(()=>authorizedSubjects(ownerScope("other-batch"),d.batch.batchId),/batchId mismatch/);
  assert.throws(()=>authorizedSubjects(ownerScope(d.batch.batchId,[],[]),d.batch.batchId),/nonempty/);
});

test("owner-pinned authorization bytes cannot be silently reduced along with the results",()=>{
  const dir=mkdtempSync(join(tmpdir(),"research-owner-scope-")),path=join(dir,"scope.json");
  try {
    const auth=ownerScope("synthetic",["fixture-1","fixture-2"],["birthDate","5000m"]);
    const bytes=JSON.stringify(auth);const digest=createHash("sha256").update(bytes).digest("hex");
    writeFileSync(path,bytes);
    assert.deepEqual(readResearchAuthorization(path,digest),auth);
    auth.assignments[0].fields=["5000m"];writeFileSync(path,JSON.stringify(auth));
    assert.throws(()=>readResearchAuthorization(path,digest),/SHA-256 mismatch/);
    assert.throws(()=>readResearchAuthorization(path,""),/task-owner SHA-256/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("unrelated publisher cannot justify PB route N/A or a blocked target",()=>{
  const d=scenario(), waiver=d.step("university-ranking");
  waiver.status="not-applicable";waiver.searchIndexes=d.step("employer-profile").searchIndexes;
  assert.ok(auditResearchCompletion(d.plan,d.batch,undefined,d.context).findings.some((f)=>f.code==="unrelated-waiver"));
  const blocked=d.step("organizer-results");blocked.status="blocked";
  const failed=d.r.searches[d.step("personal-profile").searchIndexes[0]];
  failed.outcome="inaccessible";failed.sources[0].access="unavailable";
  blocked.searchIndexes=d.step("personal-profile").searchIndexes;
  blocked.alternativeSearchIndexes=d.step("university-results").searchIndexes;
  assert.ok(auditResearchCompletion(d.plan,d.batch,undefined,d.context).findings.some((f)=>f.code==="unrelated-failure"));
});

test("same-category but unrelated text and cross-category alternatives explicitly require human relevance review",()=>{
  const d=scenario(), waiver=d.step("university-ranking"), blocked=d.step("organizer-results");
  waiver.status="not-applicable";
  const search=d.r.searches[waiver.searchIndexes[0]];
  search.query="SYNTHETIC university cafeteria menu";search.result="SYNTHETIC unrelated subject";
  blocked.status="blocked";
  const failure=d.r.searches[blocked.searchIndexes[0]];failure.outcome="inaccessible";failure.sources[0].access="unavailable";
  blocked.alternativeSearchIndexes=d.step("university-results").searchIndexes;
  d.r.searches[blocked.alternativeSearchIndexes[0]].query="SYNTHETIC university cafeteria menu, unrelated to the event";
  const report=validateCompletionClaim(d.plan,d.batch,ownerScope(d.batch.batchId),d.context);
  // Offline structure can pass; the audit MUST NOT certify this intentionally irrelevant prose.
  assert.equal(report.exitAllowed,true);
  assert.ok(report.manualChecks.some((f)=>f.code==="review-waiver-relevance"));
  assert.ok(report.manualChecks.some((f)=>f.code==="review-blocked-relevance"));
  assert.match(report.manualChecks.map((f)=>f.detail).join(" "),/independently/);
});

test("CLI denies complete-but-not-submitted, missing authorization and changed digest; ordinary validation saves progress",()=>{
  const dir=mkdtempSync(join(tmpdir(),"research-cli-submission-"));
  try {
    // Isolated read-only CLI fixture uses real registry context, never changes repository logs/data.
    mkdirSync(join(dir,"scripts"));mkdirSync(join(dir,"data/research/batches"),{recursive:true});mkdirSync(join(dir,"data/research/completion"));
    copyFileSync("scripts/research-validate.ts",join(dir,"scripts/research-validate.ts"));
    cpSync(resolve("lib"),join(dir,"lib"),{recursive:true});
    cpSync(resolve("data"),join(dir,"data"),{recursive:true});
    // Copy dependencies without requiring Windows symlink privileges; isolate real log directories.
    rmSync(join(dir,"data/research/batches"),{recursive:true});mkdirSync(join(dir,"data/research/batches"));
    rmSync(join(dir,"data/research/completion"),{recursive:true});mkdirSync(join(dir,"data/research/completion"));
    writeFileSync(join(dir,"data/research/legacy-v1.json"),"{}");
    const batch=structuredClone(demo);batch.batchId="synthetic-cli-review";batch.researcher="SYNTHETIC CLI TEST, not new research";batch.records=[batch.records[1]];
    const plan=structuredClone(demoPlan);plan.batchId=batch.batchId;plan.subjects=[plan.subjects[1]];plan.readyForReview=false;
    const planPath=join(dir,`data/research/completion/${batch.batchId}.json`);
    writeFileSync(join(dir,`data/research/batches/${batch.batchId}.json`),JSON.stringify(batch));
    writeFileSync(planPath,JSON.stringify(plan));
    const auth=ownerScope(batch.batchId,[batch.records[0].athleteId],["birthDate"]);auth.assignments[0].scope.asOf="2026-11-17";
    const text=JSON.stringify(auth),digest=createHash("sha256").update(text).digest("hex"),ownerPath=join(dir,"owner-scope.json");writeFileSync(ownerPath,text);
    const args=["--experimental-strip-types",join(dir,"scripts/research-validate.ts")];
    const complete=[...args,"--completion",batch.batchId];
    const scoped=[...complete,"--authorization",ownerPath,"--authorization-sha256",digest];
    const run=(a:string[])=>spawnSync(process.execPath,a,{encoding:"utf8"});
    const progress=run(scoped);assert.equal(progress.status,1);assert.match(progress.stdout,/steps COMPLETE; declaration NOT SUBMITTED/);assert.doesNotMatch(progress.stdout,/exit ALLOWED/);
    assert.equal(run(args).status,0);
    plan.readyForReview=true;writeFileSync(planPath,JSON.stringify(plan));
    const ready=run(scoped);assert.equal(ready.status,0,ready.stderr);assert.match(ready.stdout,/exit ALLOWED/);assert.match(ready.stdout,/MANUAL CHECK REQUIRED/);assert.match(ready.stdout,/independent evidence review still required/);
    const noScope=run(complete);assert.equal(noScope.status,1);assert.match(noScope.stdout,/authorization-missing/);
    writeFileSync(ownerPath,text+" ");assert.equal(run(scoped).status,1);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
