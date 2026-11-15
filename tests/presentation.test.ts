import test from "node:test";
import assert from "node:assert/strict";
import { database } from "../data/index.ts";
import { editionPresentations, validatePresentation } from "../lib/presentation.ts";
import { buildEditionScoreboard, getResultHonors } from "../lib/scoreboard.ts";

test("all-Japan supplements retain printed cumulative times, tie ranks and all explicit new-record marks", () => {
  validatePresentation(database);
  const expected = [[2023, 212, 8, 4, 0], [2024, 216, 8, 2, 0], [2025, 216, 8, 2, 1], [2026, 216, 9, 6, 0]];
  for (const [year, cumulative, awards, records, ties] of expected) {
    const data = editionPresentations.find((e) => e.editionId === `all-japan-${year}`)!;
    assert.equal(data.cumulative.length, cumulative);
    assert.deepEqual(["section-award", "section-record", "section-record-tie"].map((type) => data.honors.filter((h) => h.type === type).length), [awards, records, ties]);
  }
  assert.equal(getResultHonors("aj26-result-01-2")!.sectionRecord, true); // 鈴木大翔, third, 30:57
  assert.equal(getResultHonors("aj26-result-01-2")!.sectionAward, false);
  assert.equal(getResultHonors("aj25-result-08-2")!.sectionRecordTie, true);
  assert.equal(getResultHonors("aj25-result-08-2")!.sectionRecord, false);
  const finish = buildEditionScoreboard(database, "all-japan-2026", 8)!;
  const central = finish.rows.find((r) => r.entry.universityId === "chuo")!;
  const komazawa = finish.rows.find((r) => r.entry.universityId === "komazawa")!;
  assert.equal(central.cumulative.timeSeconds, 18689);
  assert.equal(komazawa.cumulative.timeSeconds, 18689);
  assert.equal(central.cumulative.rank, 5);
  assert.equal(komazawa.cumulative.rank, 6);
});

test("withdrawal preserves only explicitly sourced pre-withdrawal ranks, never a final rank", () => {
  const earlier = buildEditionScoreboard(database, "all-japan-2023", 4)!.rows.find((r) => r.entry.id === "aj23-entry-10")!;
  assert.equal(earlier.cumulative.rank, 25);
  assert.equal(earlier.cumulative.timeSeconds, 8703);
  for (const leg of [5, 6, 7, 8]) {
    const row = buildEditionScoreboard(database, "all-japan-2023", leg)!.rows.find((r) => r.entry.id === "aj23-entry-10")!;
    assert.equal(row.cumulative.timeSeconds, null);
    assert.equal(row.cumulative.rank, null);
    assert.equal(row.entry.finalRank, null);
  }
});

test("supplement validation rejects wrong links, times, ranks, duplicates, provenance and record conflicts", () => {
  const copy = () => structuredClone(editionPresentations);
  let data = copy(); data[0].cumulative[0].entryId = "wrong";
  assert.throws(() => validatePresentation(database, data), /relationship/);
  data = copy(); data[0].cumulative[0].timeSeconds++;
  assert.throws(() => validatePresentation(database, data), /inconsistent/);
  data = copy(); data[0].cumulative.push(data[0].cumulative[0]);
  assert.throws(() => validatePresentation(database, data), /duplicate/);
  data = copy(); data[0].honors[0].sourceId = "unknown";
  assert.throws(() => validatePresentation(database, data), /evidence/);
  data = copy(); data[0].honors.push(data[0].honors[0]);
  assert.throws(() => validatePresentation(database, data), /duplicate/);
  data = copy(); const record = data[0].honors.find((h) => h.type === "section-record")!;
  data[0].honors.push({...record, id: record.resultId + "/section-record-tie", type: "section-record-tie"});
  assert.throws(() => validatePresentation(database, data), /conflict/);
  data = copy(); data[0].cumulative.find((p) => p.entryId === "aj23-entry-26")!.rank = 1;
  assert.throws(() => validatePresentation(database, data), /reference/);
});
