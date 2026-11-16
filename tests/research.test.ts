import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { database } from "../data/index.ts";
import { presentationSources } from "../data/presentation/index.ts";
import { validateResearchBatch, type ResearchBatch, type ResearchContext } from "../lib/research.ts";
import { validateResearchDirectory } from "../lib/research-files.ts";
import valid from "./fixtures/research/valid.json" with { type: "json" };
import invalidCases from "./fixtures/research/invalid-cases.json" with { type: "json" };

const context: ResearchContext = {
  athletes: database.athletes,
  sources: [...database.sources, ...presentationSources],
  uncertainAthleteIds: database.identities.filter((i) => i.status === "needs-review").map((i) => i.athleteId),
};
const fixture = () => structuredClone(valid) as ResearchBatch;
const directory = fileURLToPath(new URL("../data/research/batches/", import.meta.url));
const archiveUrl = valid.records[0].candidates[0].sourceUrl;
// Synthetic source registration and verification assertions ONLY for validator tests.
// They do not certify the real candidate as a published/latest PB or register a production Source.
const testContext: ResearchContext = { ...context, sources: [...context.sources, {
  id:"fixture-waseda-history", title:"Synthetic unit-test source registration",
  url:archiveUrl, collectedAt:"2026-11-16", locator:"fixture", coverage:"validator tests only",
}] };
function verifiedFixture(): ResearchBatch {
  const b = fixture();
  b.researcher = "SYNTHETIC TEST: no additional visits or independent review claimed";
  const r = b.records[0];
  r.status = "verified";
  r.unresolved = [];
  r.updateCheck = {checked:true,asOf:"2026-11-16",summary:"Synthetic update assertion, not actual research"};
  r.final = {value:r.candidates[0].value,sourceIds:["fixture-waseda-history"],locator:"synthetic locator",revision:"synthetic revision"};
  return b;
}

test("real candidate batch and valid example validate without mutating database, sources or logs", () => {
  const before = JSON.stringify([database, presentationSources, valid]);
  assert.equal(validateResearchBatch(valid, context).records[0].status, "candidate");
  const batches = validateResearchDirectory(directory, context);
  assert.ok(batches.length >= 1);
  assert.ok(batches.some((b) => b.batchId === "2026-11-16-kudo-reverse-audit"));
  assert.equal(JSON.stringify([database, presentationSources, valid]), before);
});

for (const example of invalidCases) {
  test(`documented invalid example: ${example.name}`, () => {
    const b = fixture();
    Object.assign(b.records[0], example.recordOverrides);
    assert.throws(() => validateResearchBatch(b, context), new RegExp(example.expectedError));
  });
}

test("all five statuses stay distinct; incomplete research is permitted only with reasons and no final fact", () => {
  validateResearchBatch(verifiedFixture(), testContext);
  const missing = fixture();
  missing.records[0].status = "not-found";
  missing.records[0].candidates = [];
  missing.records[0].searches = [{stage:"discovery",query:"synthetic no-match query",checkedAt:"2026-11-16",outcome:"not-found",sources:[],result:"synthetic no match"}];
  validateResearchBatch(missing, context);
  const conflict = fixture();
  conflict.records[0].status = "conflict";
  conflict.records[0].candidates.push({...conflict.records[0].candidates[0],value:"synthetic conflicting value"});
  validateResearchBatch(conflict, context);
  const absent = verifiedFixture();
  absent.records[0].status = "verified-absent";
  absent.records[0].candidates = [];
  absent.records[0].final!.value = "Synthetic affirmative absence statement; validator cannot verify its truth";
  validateResearchBatch(absent, testContext);
  const pending = fixture();
  pending.records[0].final = verifiedFixture().records[0].final;
  assert.throws(() => validateResearchBatch(pending, testContext), /unverified conclusion/);
});

test("verified facts require complete stages, provenance, a known read Source, update checks and resolved identity", () => {
  const check = (mutate: (b: ResearchBatch) => void, error: RegExp) => {
    const b = verifiedFixture(); mutate(b);
    assert.throws(() => validateResearchBatch(b, testContext), error);
  };
  check((b) => { b.records[0].final!.sourceIds = ["unknown"]; }, /unknown adopted Source/);
  check((b) => { b.records[0].final!.sourceIds = []; }, /adopted Source IDs/);
  check((b) => { b.records[0].final!.sourceIds.push("fixture-waseda-history"); }, /adopted Source IDs/);
  check((b) => { b.records[0].final!.locator = " "; }, /non-empty string/);
  check((b) => { b.records[0].final!.revision = ""; }, /non-empty string/);
  check((b) => { b.records[0].final = null; }, /expected object/);
  check((b) => { b.records[0].final!.value = "not a recorded candidate"; }, /match a recorded candidate/);
  check((b) => { b.records[0].searches.forEach((s) => { if (s.stage === "reverse") s.stage = "discovery"; }); }, /three research stages/);
  check((b) => { b.records[0].searches.forEach((s) => s.sources.forEach((v) => {v.access="search-snippet";})); }, /read document/);
  check((b) => { b.records[0].updateCheck = {checked:false,asOf:null,summary:"not checked"}; }, /explicit update check/);
  check((b) => { b.records[0].identityEvidence = ""; }, /non-empty string/);
  check((b) => { b.records[0].unresolved = ["identity still uncertain"]; }, /unresolved issues/);
  check((b) => { b.records[0].status = "verified-absent"; }, /absence is only for PB without unresolved candidates/);
  assert.throws(() => validateResearchBatch(verifiedFixture(), {...testContext,uncertainAthleteIds:[valid.records[0].athleteId]}), /unresolved identity/);
  // A Source existing in the catalog is not enough when the logged document differs.
  assert.throws(() => validateResearchBatch(verifiedFixture(), {...testContext,sources:testContext.sources.map((s) => s.id === "fixture-waseda-history" ? {...s,url:"https://waseda-ac.jp/record/"} : s)}), /read document/);
});

test("dates, types, enum values and explicit source references fail closed", () => {
  const bad: Array<[string, (b: ResearchBatch) => void, RegExp]> = [
    ["empty records", (b) => { b.records=[]; }, /empty batch/],
    ["version", (b) => { b.schemaVersion=2 as 1; }, /unsupported version/],
    ["wrong name", (b) => { b.records[0].athleteName="a different person"; }, /name does not match/],
    ["review chronology", (b) => { b.records[0].reviewedAt="2026-11-17"; }, /exceeds batch date/],
    ["search chronology", (b) => { b.records[0].searches[0].checkedAt="2026-11-17"; }, /search after review/],
    ["invalid leap day", (b) => { b.reviewedAt="2025-02-29"; }, /invalid calendar date/],
    ["field", (b) => { b.records[0].field="10km" as never; }, /invalid enum/],
    ["scope", (b) => { b.records[0].scope=""; }, /non-empty string/],
    ["PB scope", (b) => { b.records[0].pbScope=null; }, /invalid enum/],
    ["boolean", (b) => { b.records[0].updateCheck.checked="yes" as never; }, /must be boolean/],
    ["cutoff", (b) => { b.records[0].updateCheck.asOf="2026-11-16"; }, /unchecked update/],
    ["future cutoff", (b) => { b.records[0].updateCheck={checked:true,asOf:"2026-11-17",summary:"fixture"}; }, /cutoff after review/],
    ["no searches", (b) => { b.records[0].searches=[]; }, /actual search/],
    ["no sources", (b) => { b.records[0].searches[0].sources=[]; }, /source references/],
    ["missing query", (b) => { delete (b.records[0].searches[0] as Partial<ResearchBatch["records"][number]["searches"][number]>).query; }, /required field/],
    ["bad stage", (b) => { b.records[0].searches[0].stage="done" as never; }, /invalid enum/],
    ["bad access", (b) => { b.records[0].searches[0].sources[0].access="visited-homepage" as never; }, /invalid enum/],
    ["empty section", (b) => { b.records[0].searches[0].sources[0].section=""; }, /non-empty string/],
    ["unlogged candidate", (b) => { b.records[0].candidates[0].sourceUrl="https://waseda-ac.jp/record/"; }, /absent from search log/],
  ];
  for (const [label, mutate, error] of bad) {
    const b = fixture(); mutate(b);
    assert.throws(() => validateResearchBatch(b, context), error, label);
  }
  for (const input of [null, [], 1, "{}", {}, {...valid,records:null}])
    assert.throws(() => validateResearchBatch(input, context), /Research/);
});

test("rejects placeholder/private/non-web URLs and obvious credential fields without echoing secrets", () => {
  for (const url of ["not a URL", "file:///tmp/page", "javascript:alert(1)", "https://example.com/result", "https://127.0.0.1/", "https://localhost/", "https://user:secret@waseda-ac.jp/", "https://waseda-ac.jp/?access_token=secret"]) {
    const b = fixture(); b.records[0].searches[0].sources[0].url=url;
    assert.throws(() => validateResearchBatch(b, context), /source URL/);
  }
  const b = fixture();
  Object.assign(b.records[0].searches[0], {cookie:"synthetic-secret-value"});
  assert.throws(() => validateResearchBatch(b, context), (error: unknown) => error instanceof Error && /unknown field/.test(error.message) && !error.message.includes("synthetic-secret-value"));
});

test("same-batch duplicate final conclusions are rejected regardless of order; distinct historical scopes remain valid", () => {
  const b = verifiedFixture();
  const second = structuredClone(b.records[0]);
  second.final!.value = "different candidate";
  second.candidates[0].value = "different candidate";
  b.records.push(second);
  assert.throws(() => validateResearchBatch(b, testContext), /duplicate subject/);
  b.records.reverse();
  assert.throws(() => validateResearchBatch(b, testContext), /duplicate subject/);
  b.records[0].scope="historical-2023-04-22";
  b.records[0].pbScope="historical";
  b.records[0].updateCheck.asOf="2023-04-22";
  validateResearchBatch(b, testContext);
});

test("directory validator is offline/read-only, handles invalid JSON, filename and batch collisions, and permits legacy absence of logs", () => {
  const dir = mkdtempSync(join(tmpdir(), "ekiden-research-"));
  try {
    assert.deepEqual(validateResearchDirectory(dir, context), []);
    const file = join(dir, `${valid.batchId}.json`);
    const text = JSON.stringify(valid);
    writeFileSync(file, text);
    validateResearchDirectory(dir, context);
    assert.equal(readFileSync(file,"utf8"), text);
    writeFileSync(join(dir,"other.json"), text);
    assert.throws(() => validateResearchDirectory(dir, context), /duplicate batchId/);
    rmSync(file);
    assert.throws(() => validateResearchDirectory(dir, context), /filename must match/);
    writeFileSync(join(dir,"other.json"), "{bad json");
    assert.throws(() => validateResearchDirectory(dir, context), /invalid JSON/);
  } finally { rmSync(dir, {recursive:true,force:true}); }
});
