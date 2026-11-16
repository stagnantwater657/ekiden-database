import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateResearchBatch, type ResearchBatch, type ResearchContext } from "../lib/research.ts";
import { validateResearchDirectory } from "../lib/research-files.ts";
import { researchAuditSummary, validateResearchMeets } from "../lib/research-audit.ts";
import fixture from "./fixtures/research/v2.json" with { type: "json" };
import old from "./fixtures/research/valid.json" with { type: "json" };
import meets from "../data/research/meets.json" with { type: "json" };
import { database } from "../data/index.ts";
import { presentationSources } from "../data/presentation/index.ts";

const fresh = () => structuredClone(fixture) as unknown as {batch: ResearchBatch; context: ResearchContext};
const accept = (data: ReturnType<typeof fresh>) => validateResearchBatch(data.batch, data.context);
const reject = (change: (d: ReturnType<typeof fresh>) => void, error: RegExp) => {
  const d = fresh(); change(d); assert.throws(() => accept(d), error);
};

test("v2 synthetic fixture validates offline without mutation; v1 remains readable but not equivalent assurance", () => {
  const d = fresh(), before = JSON.stringify(d);
  accept(d); assert.equal(JSON.stringify(d), before);
  assert.match(researchAuditSummary(d.batch.records[0]), /2 declared origin groups/);
  assert.match(researchAuditSummary(old.records[0] as never), /legacy v1/);
});

test("R9/R12: later faster eligible mark prevents publishing an earlier real mark as current PB", () => {
  reject((d) => {
    const r = d.batch.records[0], a = r.audit!;
    a.pbUpdate!.selectedId = "old"; r.final!.value = a.performances[0].value;
  }, /slower than known eligible/);
  reject((d) => {d.batch.records[0].candidates.push({...d.batch.records[0].candidates[0],value:"SYNTHETIC overlooked candidate"});}, /account for every recorded candidate/);
  reject((d) => {d.batch.records[0].audit!.pbUpdate!.foundFaster = false;}, /foundFaster conflicts/);
  const d = fresh();
  const a = d.batch.records[0].audit!;
  a.performances[0].timeMilliseconds = 860000;
  a.performances[0].eligibility = "excluded";
  a.performances[0].reason = "SYNTHETIC disqualified race; not comparable official PB";
  a.pbUpdate!.foundFaster = false;
  accept(d);
  a.performances[0].eligibility = "unconfirmed";
  assert.throws(() => accept(d), /faster unresolved candidate/);
});

test("R9: checked=true alone and graduates without employer follow-up are rejected", () => {
  reject((d) => {d.batch.records[0].audit!.pbUpdate!.checks=[];}, /completed update range/);
  reject((d) => {d.batch.records[0].audit!.coverage[1]={category:"employer",status:"not-checked",searchIndexes:[],reason:"Not done"};}, /graduate PB requires employer/);
  reject((d) => {d.batch.records[0].audit!.pbUpdate!.checks.pop();}, /affiliation category missing/);
  reject((d) => {d.batch.records[0].audit!.affiliation!.organization=null;}, /known affiliation/);
  reject((d) => {d.batch.records[0].audit!.affiliation!.stage="unknown";}, /known affiliation/);
});

test("students may mark employer not applicable with a reason, without inventing an employer visit", () => {
  const d=fresh(), a=d.batch.records[0].audit!;
  a.affiliation={stage:"student",organization:"Fixture university",evidenceIds:["baseline"],reason:"Synthetic enrolled student"};
  a.coverage[1]={category:"employer",status:"not-applicable",searchIndexes:[],reason:"Not graduated at cutoff"};
  accept(d);
  a.coverage[1].reason="";
  assert.throws(() => accept(d), /non-empty/);
});

test("one sufficient adopted source is allowed; blocked university is explicit and needs alternative follow-up", () => {
  const d=fresh(), r=d.batch.records[0], a=r.audit!;
  r.searches.push({stage:"verification",query:"SYNTHETIC archived university request",checkedAt:"2026-11-16",outcome:"inaccessible",sources:[{url:"https://synthetic-research-fixture.org/archive",section:"archive",access:"unavailable",finding:"Synthetic failure"}],result:"Unavailable"});
  a.coverage[0]={category:"university",status:"blocked",searchIndexes:[4],reason:"University archive unavailable"};
  a.pbUpdate!.checks.shift();
  // One employer document supplies both value and event facts; never force two sources.
  a.evidence[1].supports.push("achievedOn","meet","edition","distance");
  a.performances[1].event.evidenceIds=["mark"];
  a.adoptedEvidenceIds=["mark"];r.final!.sourceIds=["fixture-employer"];
  accept(d);assert.match(researchAuditSummary(r),/1 adopted sources.*single-origin/);
  a.limitations=[];assert.throws(()=>accept(d),/blocked required category/);
});

test("R10/R14: mark, actual date, event and distance require correctly mapped evidence", () => {
  reject((d) => {d.batch.records[0].audit!.performances[1].event.evidenceIds=["mark"];}, /date\/meet\/distance/);
  reject((d) => {d.batch.records[0].audit!.performances[1].evidenceIds=["event"];}, /primary mark evidence/);
  reject((d) => {d.batch.records[0].audit!.performances[1].achievedOn="";}, /non-empty/);
  reject((d) => {d.batch.records[0].audit!.performances[1].event.competedOn="2025-06-03";}, /competition date/);
  reject((d) => {d.batch.records[0].audit!.performances[1].event.distanceMetres=10000;}, /distance mismatch/);
  reject((d) => {d.batch.records[0].audit!.performances[1].event.discipline="10000m";}, /discipline mismatch/);
  const d=fresh();
  const extra=structuredClone(d.batch.records[0].audit!.evidence[1]); extra.id="second-mark"; extra.role="cross-check";
  d.batch.records[0].audit!.evidence.push(extra);
  d.batch.records[0].audit!.performances[1].evidenceIds.push(extra.id);
  d.batch.records[0].audit!.adoptedEvidenceIds.push(extra.id);
  accept(d); // multiple references to one fact, without duplicating Source registration
});

test("R13: known metadata rejects wrong edition/date/ID; no fuzzy name or year inference", () => {
  reject((d) => {d.batch.records[0].audit!.performances[1].event.edition=1;}, /conflicts with known/);
  reject((d) => {d.batch.records[0].audit!.performances[1].event.startsOn="2025-05-31";}, /conflicts with known/);
  reject((d) => {d.batch.records[0].audit!.performances[1].event.metadataId="unknown";}, /unknown meet/);
  reject((d) => {
    const e=d.batch.records[0].audit!.performances[1].event; e.metadataId=null; e.edition=1;
  }, /conflicts with known/); // known source URL still matches, even if ID omitted
  const d=fresh(), e=d.batch.records[0].audit!.performances[0].event;
  e.edition=null; e.editionStatus="pending";
  d.batch.records[0].audit!.limitations.push("Old meet edition not confirmed; do not derive from year");
  accept(d);
  // Catalog is intentionally tiny; checking it doesn't verify all Japanese event metadata.
  assert.equal(validateResearchMeets(meets).length, 1);
  assert.throws(() => validateResearchMeets([...meets,...meets]), /duplicate meet/);
});

test("R13 limited real meet catalog catches 77 to 76 without asserting any real athlete mark", () => {
  const d=fresh(), r=d.batch.records[0], known=validateResearchMeets(meets)[0];
  d.context.meets=[known];r.field="half-marathon";
  for (const p of r.audit!.performances) {
    p.timeMilliseconds *= 4;p.precision="second";
    p.event.discipline="half-marathon";p.event.distanceMetres=21097.5;
  }
  const p=r.audit!.performances[1];p.achievedOn=known.startsOn;
  Object.assign(p.event,{metadataId:known.id,name:known.name,edition:known.edition,startsOn:known.startsOn,endsOn:known.endsOn,competedOn:known.startsOn});
  // Synthetic Source registration/read claims only; the real metadata's provenance is separate.
  d.context.sources=d.context.sources.map((source)=>source.id==="fixture-event" ? {...source,url:known.sourceUrl} : source);
  r.searches[1].sources[0].url=known.sourceUrl;
  accept(d);p.event.edition=76;
  assert.throws(()=>accept(d),/conflicts with known/);
});

test("R11: other valid evidence plus missing original is representable and reported, not invented absence", () => {
  const d=fresh(), r=d.batch.records[0];
  r.audit!.limitations.push("Synthetic university result available; organizer independent timing file unavailable");
  r.searches.push({stage:"verification",query:"Synthetic organizer file request",checkedAt:"2026-11-16",outcome:"inaccessible",sources:[{url:"https://synthetic-research-fixture.org/unavailable",section:"timing file",access:"unavailable",finding:"Synthetic access failure"}],result:"Original unavailable"});
  r.audit!.coverage[2]={category:"official",status:"blocked",searchIndexes:[4],reason:"Timing original inaccessible; schedule source remains available"};
  accept(d);
  assert.match(researchAuditSummary(r), /2 limitations/);
  r.status="candidate";r.final=null;r.unresolved=["Needs independent evidence review"];
  r.audit!.adoptedEvidenceIds=[];r.audit!.pbUpdate!.selectedId=null;
  accept(d);
  r.status="conflict";accept(d);
  r.status="not-found";
  assert.throws(() => accept(d), /cannot hide known candidates/);
});

test("missing Source, existing-but-unverified Source, and malformed evidence links are distinct", () => {
  reject((d) => {d.batch.records[0].audit!.evidence[1].sourceId="missing";}, /unknown evidence Source/);
  reject((d) => {d.batch.records[0].audit!.evidence[1].status="unverified";}, /unverified evidence/);
  reject((d) => {d.batch.records[0].audit!.adoptedEvidenceIds=["missing-link"];}, /unknown evidence reference/);
  reject((d) => {d.batch.records[0].audit!.evidence[1].locator="";}, /non-empty/);
  reject((d) => {d.batch.records[0].audit!.evidence[1].checkedAt=null;}, /dated read/);
  reject((d) => {d.batch.records[0].audit!.adoptedEvidenceIds=["mark"];}, /final Sources must match/);
  const d=fresh(), r=d.batch.records[0];
  r.status="candidate";r.final=null;r.unresolved=["Mark source exists but not yet checked"];
  r.audit!.adoptedEvidenceIds=[];r.audit!.pbUpdate!.selectedId=null;
  r.audit!.evidence[1].status="unverified";r.audit!.evidence[1].checkedAt=null;
  r.audit!.performances[1].eligibility="unconfirmed";
  r.audit!.pbUpdate!.checks.pop();
  accept(d);
});

test("coverage and update ranges must link real logged steps; missing fields and unchecked categories stay visible", () => {
  reject((d) => {d.batch.records[0].audit!.coverage.pop();}, /all five/);
  reject((d) => {d.batch.records[0].audit!.coverage[0].searchIndexes=[99];}, /invalid search/);
  reject((d) => {d.batch.records[0].audit!.pbUpdate!.checks[1].evidenceIds=["baseline"];}, /own read/);
  reject((d) => {d.batch.records[0].audit!.pbUpdate!.checks[1].through="2026-11-17";}, /invalid subsequent/);
  reject((d) => {delete (d.batch.records[0].audit!.pbUpdate as Partial<NonNullable<typeof d.batch.records[number]["audit"]>["pbUpdate"]>)!.decision;}, /required field/);
  reject((d) => {delete d.batch.records[0].audit;}, /required field/);
});

test("single-origin and unknown independence are reported; republications are not counted as independent proof", () => {
  const d=fresh(), r=d.batch.records[0];
  r.audit!.evidence.forEach((e)=>{e.originKey="shared-original";e.independenceNote="Syndicated same original";});
  accept(d);assert.match(researchAuditSummary(r), /1 declared origin groups \(single-origin evidence\)/);
  r.audit!.evidence[1].originKey=null;
  accept(d);assert.match(researchAuditSummary(r), /independence unknown/);
  const duplicate=structuredClone(r.audit!.evidence[2]);duplicate.id="relabelled";duplicate.originKey="different";
  r.audit!.evidence.push(duplicate);
  assert.throws(()=>accept(d), /same document/);
});

test("biography permits one-source evidence and does not require PB or employer workflow", () => {
  const d=fresh(), r=d.batch.records[0];
  r.field="highSchool";r.pbScope=null;r.final!.sourceIds=["fixture-employer"];
  r.final!.value="Fixture school";r.candidates=[{...r.candidates[1],value:"Fixture school"}];
  r.audit!.adoptedEvidenceIds=["mark"];r.audit!.affiliation=null;r.audit!.performances=[];r.audit!.pbUpdate=null;
  r.updateCheck={checked:false,asOf:null,summary:"Birth/school facts are not PBs"};
  accept(d);assert.match(researchAuditSummary(r), /single-origin/);
});

test("legacy snapshot compatibility rejects new/edited v1 logs while v2 needs no allowlist", () => {
  const dir=mkdtempSync(join(tmpdir(),"research-v2-"));
  const context={athletes:database.athletes,editions:database.editions,sources:[...database.sources,...presentationSources],uncertainAthleteIds:[]};
  try {
    const filename=`${old.batchId}.json`, text=JSON.stringify(old);
    writeFileSync(join(dir,filename),text);
    assert.throws(()=>validateResearchDirectory(dir,context,{}),/require schemaVersion 2/);
    const legacy={[filename]:createHash("sha256").update(text).digest("hex")};
    validateResearchDirectory(dir,context,legacy);
    writeFileSync(join(dir,filename),text+"\n");
    assert.throws(()=>validateResearchDirectory(dir,context,legacy),/legacy snapshot mismatch/);
    rmSync(join(dir,filename));
    const d=fresh();writeFileSync(join(dir,`${d.batch.batchId}.json`),JSON.stringify(d.batch));
    validateResearchDirectory(dir,d.context,{});
  } finally {rmSync(dir,{recursive:true,force:true});}
});
