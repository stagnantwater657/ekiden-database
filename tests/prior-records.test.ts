import test from "node:test";
import assert from "node:assert/strict";
import { database } from "../data/index.ts";
import {
  priorRecordFor,
  priorSectionRecords,
  validatePriorRecords,
} from "../lib/prior-records.ts";
import { officialSectionRecords } from "../lib/race-profile.ts";
import { buildEditionScoreboard, getResultHonors } from "../lib/scoreboard.ts";

test("every imported edition and section carries an explicit pre-race record state", () => {
  validatePriorRecords(database);
  const expected = { hakone: 30, "all-japan": 32, izumo: 24 };
  for (const [raceId, sections] of Object.entries(expected)) {
    const editionIds = database.editions
      .filter((edition) => edition.raceId === raceId)
      .map((edition) => edition.id);
    assert.equal(
      priorSectionRecords.filter((record) => record.raceId === raceId).length,
      sections,
    );
    for (const editionId of editionIds) {
      const legs = database.sections.filter((s) => s.editionId === editionId);
      for (const leg of legs) {
        const record = priorRecordFor(editionId, leg.number)!;
        assert.ok(record, `${editionId} section ${leg.number} is missing a state`);
        assert.ok(
          ["verified", "unverified", "not-applicable"].includes(record.status),
        );
        assert.equal(record.courseEditionId, editionId);
        assert.equal(record.sectionNumber, leg.number);
      }
    }
  }
  assert.equal(
    priorSectionRecords.filter((record) => record.status === "verified").length,
    86,
  );
  assert.equal(
    priorSectionRecords.filter((record) => record.status !== "verified").length,
    0,
  );
});

test("no record shown on an edition page was set after that edition started", () => {
  for (const record of priorSectionRecords) {
    const edition = database.editions.find((item) => item.id === record.editionId)!;
    for (const holder of record.holders) {
      assert.ok(
        holder.editionNumber < edition.number,
        `${record.id} holder ${holder.holderName} set at a later edition`,
      );
      assert.ok(
        holder.year < edition.year,
        `${record.id} holder year is not earlier`,
      );
      if (holder.athleteId)
        assert.ok(
          holder.editionId &&
            database.editions.some((item) => item.id === holder.editionId),
        );
    }
  }
});

test("co-holders keep every holder at the shared record time", () => {
  const record = priorRecordFor("all-japan-2026", 2)!;
  assert.equal(record.timeSeconds, 1861); // 31:01
  assert.equal(record.holders.length, 2);
  assert.deepEqual(
    record.holders.map((holder) => holder.holderName),
    ["佐藤 圭汰", "楠岡 由浩"],
  );
  assert.deepEqual(
    record.holders.map((holder) => holder.editionNumber),
    [55, 57],
  );
  const board = buildEditionScoreboard(database, "all-japan-2026", 2)!;
  assert.equal(board.priorRecord!.holders.length, 2);
});

test("a record broken in the race is still shown as it stood before the start", () => {
  // 2区 stood at 1:05:31 (101st, 2025) before the 102nd; キムタイ ran 1:05:09 in it.
  const board = buildEditionScoreboard(database, "hakone-2026", 2)!;
  assert.equal(board.priorRecord!.timeSeconds, 3931);
  const current = officialSectionRecords.filter(
    (record) => record.raceId === "hakone" && record.sectionNumber === 2,
  );
  assert.equal(Math.min(...current.map((record) => record.timeSeconds)), 3909);
  const winner = board.rows.find((row) => row.id === "hk26-result-07-2")!;
  assert.equal(winner.timeSeconds, 3909);
  assert.equal(getResultHonors("hk26-result-07-2")!.sectionRecord, true);
  // The same page must never leak the newer record into the overview.
  assert.notEqual(board.priorRecord!.timeSeconds, winner.timeSeconds);
});

test("Hakone 100th keeps its own pre-race record after later editions improved it", () => {
  // 5区: 1:10:04 before the 100th (99th, 2023); 1:09:14 set during it; 1:09:11 by 2025.
  const board = buildEditionScoreboard(database, "hakone-2024", 5)!;
  assert.equal(board.priorRecord!.timeSeconds, 4204);
  assert.equal(board.priorRecord!.holders[0].editionNumber, 99);
  assert.equal(
    buildEditionScoreboard(database, "hakone-2025", 5)!.priorRecord!.timeSeconds,
    4154,
  );
  assert.equal(
    buildEditionScoreboard(database, "hakone-2026", 5)!.priorRecord!.timeSeconds,
    4151,
  );
});

test("route mismatch and provenance gaps are rejected, not silently displayed", () => {
  const copy = () => structuredClone(priorSectionRecords);
  let data = copy();
  data[0].holders[0].editionNumber = 999;
  assert.throws(() => validatePriorRecords(database, data), /not before/);
  data = copy();
  data[0].courseVersion = "all-japan-2026-confirmed-route";
  assert.throws(() => validatePriorRecords(database, data), /route/);
  data = copy();
  data[0].sourceId = null;
  assert.throws(() => validatePriorRecords(database, data), /provenance/);
  data = copy();
  data[0].timeSeconds = 0;
  assert.throws(() => validatePriorRecords(database, data), /invalid record time/);
  data = copy();
  data.push(structuredClone(data[0]));
  assert.throws(() => validatePriorRecords(database, data), /duplicate/);
  data = copy();
  data[0].holders = [];
  assert.throws(() => validatePriorRecords(database, data), /holder/);
});

test("the Izumo 1区 header conflict is recorded instead of silently resolved", () => {
  const board = buildEditionScoreboard(database, "izumo-2026", 1)!;
  assert.equal(board.priorRecord!.timeSeconds, 1350); // 22:30
  assert.match(board.priorRecord!.note ?? "", /18:44/);
  assert.match(board.priorRecord!.note ?? "", /22:30/);
});
