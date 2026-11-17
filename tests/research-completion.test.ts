import assert from "node:assert/strict";
import test from "node:test";
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
  const pb=r.field!=="birthDate";
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
  assert.equal(validateCompletionClaim(d.plan,d.batch).complete,true);
  const step=d.step(example.step);step.status="not-started";step.searchIndexes=[];
  assert.ok(auditResearchCompletion(d.plan,d.batch).findings.some((f)=>f.detail.includes(example.step)));
  assert.throws(()=>validateCompletionClaim(d.plan,d.batch),/premature completion/);
});

test("candidate/conflict/not-found/verified all receive completion assessment and pending states need next actions",()=>{
  for (const status of ["candidate","conflict","not-found"] as const) {
    const d=scenario();d.r.status=status;
    if (status==="not-found") d.r.candidates=[];
    validateResearchBatch(d.batch,d.context);
    assert.equal(auditResearchCompletion(d.plan,d.batch).complete,true);
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
  assert.equal(validateCompletionClaim(d.plan,d.batch).complete,true);
  step.alternativeSearchIndexes=step.searchIndexes;
  assert.throws(()=>auditResearchCompletion(d.plan,d.batch),/alternative cannot repeat/);
});

test("university annual results can be read without a PB table; no fake blocked classification needed",()=>{
  const d=scenario(),step=d.step("university-ranking");
  step.status="not-applicable";step.reason="SYNTHETIC site navigation found annual results, no historical PB ranking";
  step.searchIndexes=d.step("university-results").searchIndexes;
  assert.equal(validateCompletionClaim(d.plan,d.batch).complete,true);
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
  assert.equal(report.complete,false);assert.equal(report.findings.length,2);
  assert.ok(report.findings.every((f)=>f.subject.includes("athlete-aj24-04-2")));
  assert.ok(batch.records.every((r)=>r.status==="candidate" && r.final===null));
  assert.ok(report.findings.some((f)=>f.detail.includes("employer-results")));
  const result=spawnSync(process.execPath,["--experimental-strip-types","scripts/research-validate.ts","--completion",batch.batchId],{encoding:"utf8"});
  assert.equal(result.status,1);assert.match(result.stdout,/completion INCOMPLETE/);
  const absent=spawnSync(process.execPath,["--experimental-strip-types","scripts/research-validate.ts","--completion","no-plan"],{encoding:"utf8"});
  assert.equal(absent.status,1);assert.match(absent.stderr,/unassessed/);
  assert.match(execFileSync(process.execPath,["--experimental-strip-types","scripts/research-validate.ts"],{encoding:"utf8"}),/NOT ASSESSED/);
});
