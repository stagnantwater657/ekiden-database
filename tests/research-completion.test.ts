import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  assert.equal(validateCompletionClaim(d.plan,d.batch).stepsComplete,true);
  const step=d.step(example.step);step.status="not-started";step.searchIndexes=[];
  assert.ok(auditResearchCompletion(d.plan,d.batch).findings.some((f)=>f.detail.includes(example.step)));
  assert.throws(()=>validateCompletionClaim(d.plan,d.batch),/premature completion/);
});

test("candidate/conflict/not-found/verified all receive completion assessment and pending states need next actions",()=>{
  for (const status of ["candidate","conflict","not-found"] as const) {
    const d=scenario();d.r.status=status;
    if (status==="not-found") d.r.candidates=[];
    validateResearchBatch(d.batch,d.context);
    assert.equal(auditResearchCompletion(d.plan,d.batch).stepsComplete,true);
    d.plan.subjects[0].nextActions=[];
    assert.ok(auditResearchCompletion(d.plan,d.batch).findings.some((f)=>f.code==="missing-next-action"));
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
  assert.ok(auditResearchCompletion(d.plan,d.batch).findings.some((f)=>f.code==="missing-record"));
  d.plan.subjects.shift();
  assert.ok(auditResearchCompletion(d.plan,d.batch).findings.some((f)=>f.code==="unplanned-record"));
  d.plan.subjects.push(structuredClone(d.plan.subjects[0]));
  assert.throws(()=>auditResearchCompletion(d.plan,d.batch),/duplicate subject/);
});

test("PB reverse search must actually contain name and exact/alternate marks; generic WA query is insufficient",()=>{
  for (const kind of ["exact-value","alternate-value","event-year"]) {
    const d=scenario();d.r.searches[d.step(kind).searchIndexes[0]].query="WA personal best";
    assert.ok(auditResearchCompletion(d.plan,d.batch).findings.some((f)=>f.code.startsWith("missing-")));
  }
  const d=scenario();d.step("exact-value").status="not-applicable";
  assert.ok(auditResearchCompletion(d.plan,d.batch).findings.some((f)=>f.code==="unsupported-waiver"));
});

test("404/blocked needs actual target, reason and distinct executed alternative; legitimate unresolved is allowed",()=>{
  const d=scenario(),step=d.step("organizer-results");step.status="blocked";
  assert.ok(auditResearchCompletion(d.plan,d.batch).findings.some((f)=>f.code==="missing-failure"));
  const s=d.r.searches[step.searchIndexes[0]];s.outcome="inaccessible";s.sources[0].access="unavailable";s.sources[0].finding="SYNTHETIC HTTP 404";
  assert.ok(auditResearchCompletion(d.plan,d.batch).findings.some((f)=>f.code==="missing-alternative"));
  step.alternativeSearchIndexes=d.step("university-results").searchIndexes;
  assert.equal(validateCompletionClaim(d.plan,d.batch).stepsComplete,true);
  step.alternativeSearchIndexes=step.searchIndexes;
  assert.throws(()=>auditResearchCompletion(d.plan,d.batch),/alternative cannot repeat/);
});

test("university annual results can be read without a PB table; no fake blocked classification needed",()=>{
  const d=scenario(),step=d.step("university-ranking");
  step.status="not-applicable";step.reason="SYNTHETIC site navigation found annual results, no historical PB ranking";
  step.searchIndexes=d.step("university-results").searchIndexes;
  assert.equal(validateCompletionClaim(d.plan,d.batch).stepsComplete,true);
  step.searchIndexes=[];
  assert.ok(auditResearchCompletion(d.plan,d.batch).findings.some((f)=>f.code==="unsupported-waiver"));
});

test("all seven publisher categories accepted; a supporter site or snippet is not a read university route",()=>{
  const d=scenario();
  for (const category of researchSourceCategories) {
    d.r.searches[0].sources[0].category=category;
    validateResearchBatch(d.batch,d.context);
  }
  const s=d.r.searches[d.step("university-results").searchIndexes[0]].sources[0];
  s.category="media";
  assert.ok(auditResearchCompletion(d.plan,d.batch).findings.some((f)=>f.code==="unread-route"));
  s.category="university";s.access="search-snippet";
  assert.ok(auditResearchCompletion(d.plan,d.batch).findings.some((f)=>f.code==="unread-route"));
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
  const saved=validateCompletionClaim(d.plan,d.batch,auth);
  assert.deepEqual([saved.stepsComplete,saved.readyForReview,saved.authorizationComplete,saved.exitAllowed],[true,false,true,false]);
  d.plan.readyForReview=true;
  assert.equal(validateCompletionClaim(d.plan,d.batch,auth).exitAllowed,true);
  const legacy=validateCompletionClaim(d.plan,d.batch);
  assert.equal(legacy.stepsComplete,true);assert.equal(legacy.authorizationComplete,false);assert.equal(legacy.exitAllowed,false);
  d.plan.readyForReview=false;d.step("university-ranking").status="not-started";d.step("university-ranking").searchIndexes=[];
  assert.equal(validateCompletionClaim(d.plan,d.batch,auth).stepsComplete,false);
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
    d.batch.records.push(item.r);d.plan.subjects.push(item.plan.subjects[0]);
  }
  validateResearchBatch(d.batch,d.context);
  assert.equal(authorizedSubjects(scope,d.batch.batchId).length,25);
  assert.equal(validateCompletionClaim(d.plan,d.batch,scope).exitAllowed,true);
  d.batch.records=d.batch.records.filter((r)=>!["birthDate","highSchool"].includes(r.field));
  d.plan.subjects=d.plan.subjects.filter((r)=>!["birthDate","highSchool"].includes(r.field));
  assert.equal(d.batch.records.length,15);assert.equal(d.plan.subjects.length,15);
  validateResearchBatch(d.batch,d.context);
  const report=auditResearchCompletion(d.plan,d.batch,scope);
  assert.equal(report.stepsComplete,true);assert.equal(report.authorizationComplete,false);assert.equal(report.exitAllowed,false);
  assert.equal(report.authorizationFindings.filter((f)=>f.code==="authorized-plan-missing").length,10);
  assert.equal(report.authorizationFindings.filter((f)=>f.code==="authorized-record-missing").length,10);
  assert.throws(()=>validateCompletionClaim(d.plan,d.batch,scope),/authorized-plan-missing/);
});

test("explicit partial-field authorizations pass; extra fields, changed cutoff and duplicate grants do not",()=>{
  const d=scenario(cases[3]);
  const auth=ownerScope(d.batch.batchId,["fixture-athlete"],["birthDate"]);
  assert.equal(validateCompletionClaim(d.plan,d.batch,auth).exitAllowed,true);
  const overrun=ownerScope(d.batch.batchId,["fixture-athlete"],["highSchool"]);
  assert.ok(auditResearchCompletion(d.plan,d.batch,overrun).authorizationFindings.some((f)=>f.code==="outside-authorization"));
  const changed=structuredClone(auth);changed.assignments[0].scope.asOf="2026-11-15";
  assert.equal(auditResearchCompletion(d.plan,d.batch,changed).exitAllowed,false);
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
  assert.ok(auditResearchCompletion(d.plan,d.batch).findings.some((f)=>f.code==="unrelated-waiver"));
  const blocked=d.step("organizer-results");blocked.status="blocked";
  const failed=d.r.searches[d.step("personal-profile").searchIndexes[0]];
  failed.outcome="inaccessible";failed.sources[0].access="unavailable";
  blocked.searchIndexes=d.step("personal-profile").searchIndexes;
  blocked.alternativeSearchIndexes=d.step("university-results").searchIndexes;
  assert.ok(auditResearchCompletion(d.plan,d.batch).findings.some((f)=>f.code==="unrelated-failure"));
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
  const report=validateCompletionClaim(d.plan,d.batch,ownerScope(d.batch.batchId));
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
    symlinkSync(resolve("lib"),join(dir,"lib"),"dir");
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
