import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { database } from "../data/index.ts";
import { athleteSupplementFor, validateAthleteProfiles } from "../lib/athlete-facts.ts";
import corrections from "../data/research/corrections/2026-11-25-pr25-high-schools.json" with { type: "json" };

// Transcribed 出身校 cells, reviewed against the official roster, not generated
// by deleting suspected prefixes. Page/row and rejected readings live in the ledger.
const expected = [
  ["athlete-aj24-15-7", "倉敷"], ["athlete-aj24-11-3", "埼玉栄"],
  ["athlete-aj24-15-2", "上田西"], ["athlete-aj24-15-8", "九州学院"],
  ["athlete-aj24-10-3", "旭野"], ["athlete-aj24-11-5", "弘前実業"],
  ["athlete-aj24-10-1", "相洋"], ["athlete-aj25-14-2", "佐野日大"],
  ["athlete-aj25-13-3", "八千代松陰"], ["athlete-aj25-13-8", "春日部東"],
  ["athlete-aj25-08-8", "洛南"], ["athlete-aj25-08-5", "市立船橋"],
  ["athlete-aj25-08-4", "鳥栖工業"], ["athlete-aj25-07-7", "洛南"],
  ["athlete-aj24-10-2", "中越"], ["athlete-aj24-10-5", "仙台育英"],
  ["athlete-aj24-07-7", "大牟田"], ["athlete-aj25-15-1", "東海大静岡翔洋"],
];

test("PR25: all 18 high schools use the school column, not the adjacent faculty", () => {
  assert.equal(corrections.corrections.length, expected.length);
  for (const [athleteId, school] of expected) {
    assert.equal(athleteSupplementFor(athleteId)?.highSchool?.value, school, athleteId);
    const correction = corrections.corrections.find((c) => c.athleteId === athleteId)!;
    assert.equal(correction.after, school);
    assert.notEqual(correction.before, school);
    assert.match(athleteSupplementFor(athleteId)!.highSchool!.locator, /出身校列/);
  }
});

test("PR25: preserve rejected readings and dated searches without adopting old evidence", () => {
  for (const c of corrections.corrections) {
    const batch = JSON.parse(readFileSync(new URL(`../data/research/batches/${c.batchId}.json`, import.meta.url), "utf8"));
    const records = batch.records.filter((r: { athleteId: string; field: string }) => r.athleteId === c.athleteId && r.field === "highSchool");
    assert.equal(records.length, 1, "do not append a contradictory verified conclusion");
    const r = records[0];
    assert.equal(r.status, "verified");
    assert.equal(r.final.value, c.after);
    assert.equal(r.final.locator, c.locator);
    assert.equal(r.candidates[0].value, c.before);
    assert.match(r.candidates[0].locator, /已否定/);
    assert.equal(r.searches[0].checkedAt, "2026-11-18");
    assert.equal(r.searches.at(-1).checkedAt, "2026-11-25");
    assert.equal(r.audit.evidence[0].status, "unverified");
    assert.deepEqual(r.audit.adoptedEvidenceIds, ["school-column-review"]);
    assert.equal(r.audit.evidence.at(-1).status, "verified");
  }
});

test("school correction does not add a substring blacklist for complex school names", () => {
  const profile = structuredClone(athleteSupplementFor("athlete-aj25-15-1")!);
  assert.equal(profile.highSchool!.value, "東海大静岡翔洋");
  // Synthetic school name intentionally includes 体育; no global ban is appropriate.
  profile.highSchool!.value = "架空大学附属体育科学高等学校（合成テスト）";
  assert.doesNotThrow(() => validateAthleteProfiles(database, [profile]));
});
