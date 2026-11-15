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
  data = copy(); data[0].cumulative.find((p) => p.resultId === "aj23-result-01-8")!.rank = 2;
  assert.throws(() => validatePresentation(database, data), /final time\/rank/);
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

test("Izumo uses revised ranks, explicit awards and every new/tied record including overseas non-winners", () => {
  for (const [year, points, awards, records, ties] of [[2023,114,6,0,0],[2024,126,6,0,0],[2025,132,6,1,0],[2026,132,6,10,1]]) {
    const data = editionPresentations.find((e) => e.editionId === `izumo-${year}`)!;
    assert.equal(data.cumulative.length, points);
    assert.deepEqual(["section-award", "section-record", "section-record-tie"].map((type) => data.honors.filter((h) => h.type === type).length), [awards, records, ties]);
  }
  // Corrected individual rank alone cannot establish a re-awarded prize.
  assert.equal(getResultHonors("iz23-result-03-5"), null);
  assert.equal(getResultHonors("iz23-result-03-2")!.sectionAward, true);
  assert.equal(getResultHonors("iz23-result-05-2")!.sectionAward, true);
  assert.equal(getResultHonors("iz26-result-21-5")!.sectionRecord, true);
  assert.equal(getResultHonors("iz26-result-21-5")!.sectionAward, false);
  assert.equal(getResultHonors("iz26-result-08-3")!.sectionRecordTie, true);
  for (const leg of [1,2,3,4,5,6]) {
    for (const row of buildEditionScoreboard(database,"izumo-2023",leg)!.rows.filter((r) => ["disqualified","did-not-finish"].includes(r.entry.status))) {
      assert.equal(row.cumulative.timeSeconds,null);
      assert.equal(row.cumulative.rank,null);
      assert.equal(getResultHonors(row.id),null);
    }
    const reference = buildEditionScoreboard(database,"izumo-2026",leg)!.rows.find((r) => r.entry.rankingEligibility === "reference")!;
    assert.equal(reference.cumulative.mode,"official");
    assert.equal(reference.cumulative.rank,null);
  }
});

test("Hakone checkpoint standings use the NTV 記録速報 総合 values, never road order or a section-time guess", () => {
  for (const [year, points, ranked, awards, records] of [[2024,230,230,10,2],[2025,210,200,10,6],[2026,210,200,10,6]] as const) {
    const supplement = editionPresentations.find((e) => e.editionId === `hakone-${year}`)!;
    assert.equal(supplement.cumulative.length,points);
    assert.equal(supplement.cumulative.filter((point) => point.rank !== null).length,ranked);
    assert.ok(supplement.cumulative.every((point) => point.sourceId === `ntv-hk${String(year).slice(2)}-sokuhou`));
    assert.ok(supplement.cumulative.every((point) => point.locator.includes("総合順位") && point.locator.includes("not road order")));
    assert.equal(supplement.honors.filter((h) => h.type === "section-award").length,awards);
    assert.equal(supplement.honors.filter((h) => h.type === "section-record").length,records);
    for (const leg of [1,2,5,6,9,10]) {
      const view = buildEditionScoreboard(database, `hakone-${year}`,leg)!;
      assert.equal(view.cumulativeMode,"official");
      for (const row of view.rows) {
        assert.ok(row.cumulative.timeSeconds !== null);
        if (row.entry.status === "reference") {
          // Official elapsed time is kept; the reference crew gains no overall rank.
          assert.equal(row.cumulative.rank,null);
          assert.equal(row.cumulative.movement,null);
          assert.equal(row.cumulative.gapSeconds,null);
        } else {
          assert.ok(row.cumulative.rank !== null);
        }
      }
    }
    const finish = buildEditionScoreboard(database,`hakone-${year}`,10)!;
    assert.ok(finish.rows.every((r) => r.cumulative.rank === r.entry.finalRank && r.cumulative.timeSeconds === r.entry.totalTimeSeconds));
    const outbound = buildEditionScoreboard(database,`hakone-${year}`,5)!;
    assert.ok(outbound.rows.every((r) => r.cumulative.timeSeconds === r.entry.stages!.find((s) => s.kind === "outbound")!.timeSeconds));
  }
  assert.equal(getResultHonors("hk26-result-05-1")!.sectionRecord,true);
  assert.equal(getResultHonors("hk26-result-05-1")!.sectionAward,false);
  assert.equal(getResultHonors("hk26-result-21-1"),null); // Kawasaki: reference time, not official record.
});

test("published raw editions, registry and identity decisions remain byte-for-byte identical to PR15 main", async () => {
  const { readFileSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const baseline = JSON.parse(readFileSync(new URL("../data/presentation/baseline.json",import.meta.url),"utf8"));
  for (const item of baseline.files) {
    assert.equal(createHash("sha256").update(readFileSync(new URL(`../${item.path}`,import.meta.url))).digest("hex"),item.sha256,item.path);
  }
  assert.equal(database.editions.length,11);
  assert.equal(database.results.length,2030);
});

test("committed coverage report is reproducible and every result is counted once", async () => {
  const { readFileSync } = await import("node:fs");
  const { presentationReport } = await import("../lib/presentation-report.ts");
  const report = presentationReport(database);
  assert.deepEqual(JSON.parse(readFileSync(new URL("../data/reports/presentation.json",import.meta.url),"utf8")),report);
  assert.deepEqual(report.totals,{editions:11,results:2030,officialCumulative:2014,calculatedCumulative:0,missingCumulative:16,sectionAwards:87,sectionRecords:39,sectionRecordTies:2});
  for (const row of report.editions) assert.equal(row.cumulative.official+row.cumulative.calculated+row.cumulative.missing,row.results);
});
