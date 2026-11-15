import assert from "node:assert/strict";
import test from "node:test";
import { database } from "../data/index.ts";
import {
  getRaceProfile,
  officialSectionRecords,
  validateSectionRecords,
  observedSchedule,
  type OfficialSectionRecord,
} from "../lib/race-profile.ts";

test("race archives use the latest verified course, independent of catalog ordering", () => {
  for (const race of database.races) {
    const profile = getRaceProfile(database, race.id)!;
    const latest = database.editions
      .filter((edition) => edition.raceId === race.id)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    assert.equal(profile.latest!.id, latest.id);
    assert.equal(
      profile.sections
        .reduce((sum, section) => sum + section.distanceKm!, 0)
        .toFixed(1),
      latest.distanceKm.toFixed(1),
    );
    assert.ok(
      profile.sections.every((section) => section.editionId === latest.id),
    );
    assert.ok(profile.sections.every((section) => section.record !== null));
    const reversed = structuredClone(database);
    reversed.editions.reverse();
    assert.deepEqual(
      getRaceProfile(reversed, race.id)!.archive.map((item) => item.edition.id),
      profile.archive.map((item) => item.edition.id),
    );
  }
});

test("winner history uses official final standings and totals, never the section winner", () => {
  const profile = getRaceProfile(database, "all-japan")!;
  assert.equal(profile.archive.length, 4);
  const aj24 = profile.archive.find(
    (item) => item.edition.id === "all-japan-2024",
  )!;
  assert.equal(aj24.winners[0].university!.id, "kokugakuin");
  assert.equal(aj24.winners[0].entry.totalTimeSeconds, 18596);
  assert.ok(
    profile.archive
      .flatMap((item) => item.winners)
      .every(
        (item) =>
          item.entry.finalRank === 1 && item.entry.status === "finished",
      ),
  );
  const fixture = structuredClone(database);
  fixture.entries.find(
    (entry) => entry.id === "aj24-kokugakuin",
  )!.rankingEligibility = "reference";
  assert.equal(
    getRaceProfile(fixture, "all-japan")!.archive.find(
      (item) => item.edition.id === "all-japan-2024",
    )!.winners.length,
    0,
  );
});

test("official section record metadata cannot cross course versions or masquerade as sample minima", () => {
  const old: OfficialSectionRecord = {
    ...officialSectionRecords.find((record) => record.raceId === "all-japan")!,
    raceId: "all-japan",
    courseEditionId: "all-japan-2024",
    sectionNumber: 1,
    timeSeconds: 1698,
    holderName: "Test fixture only",
    athleteId: null,
    year: 2024,
    editionId: "all-japan-2024",
    sourceId: "official-2024",
    locator: "Unit test; not production record metadata",
  };
  const current = getRaceProfile(database, "all-japan", [old])!;
  assert.equal(current.latest!.id, "all-japan-2026");
  assert.ok(current.sections.every((section) => section.record === null));
  const fixture = structuredClone(database);
  fixture.editions.push({
    ...current.latest!,
    id: "test-future-course",
    date: "2027-11-01",
    year: 2027,
    seasonYear: 2027,
    number: 59,
  });
  assert.equal(getRaceProfile(fixture, "all-japan")!.courseMetadata, null);
});

test("date ranges reflect observed editions, include both Hakone days and tolerate empty archives", () => {
  assert.equal(observedSchedule([]), "尚未收录");
  assert.equal(observedSchedule(["2024-01-02", "2024-01-03"]), "1月2—3日");
  assert.equal(observedSchedule(["2024-11-03", "2025-11-02"]), "11月2—3日");
  assert.equal(getRaceProfile(database, "hakone")!.schedule, "1月2—3日");
  assert.equal(getRaceProfile(database, "missing"), null);
  const fixture = structuredClone(database);
  fixture.editions = [];
  assert.equal(getRaceProfile(fixture, "hakone")!.latest, null);
  assert.equal(getRaceProfile(fixture, "hakone")!.sections.length, 0);
});

test("24 current course sections retain 25 sourced holders, tied records and historical editions outside the result archive", () => {
  validateSectionRecords(database);
  assert.equal(officialSectionRecords.length,25);
  assert.equal(new Set(officialSectionRecords.map((r) => `${r.raceId}/${r.sectionNumber}`)).size,24);
  const tied = getRaceProfile(database,"all-japan")!.sections.find((s) => s.number === 2)!.records;
  assert.deepEqual(tied.map((r) => [r.holderName,r.timeSeconds]),[["増子 陽太",1851],["楠岡 由浩",1851]]);
  const old = officialSectionRecords.find((r) => r.raceId === "all-japan" && r.sectionNumber === 8)!;
  assert.equal(old.timeSeconds,3332);
  assert.equal(old.year,2007);
  assert.equal(old.editionNumber,39);
  assert.equal(old.editionId,null);
  assert.equal(old.athleteId,null);
  const izumo = getRaceProfile(database,"izumo")!;
  assert.deepEqual(izumo.sections.map((s) => s.record!.timeSeconds),[1350,927,1376,1030,1055,1697]);
  assert.ok(izumo.sources.some((s) => s.id === "iuau-iz26-results"));
  assert.ok(getRaceProfile(database,"hakone")!.sources.some((s) => s.id === "ntv-hakone-current-records-102"));
});

test("current record validator rejects incompatible routes, time conflicts, duplicate holders and false athlete links", () => {
  const copy = () => structuredClone(officialSectionRecords);
  let records = copy();records[0].courseVersion = "unknown";
  assert.throws(() => validateSectionRecords(database,records),/route version/);
  records=copy();records[0].distanceKm++;
  assert.throws(() => validateSectionRecords(database,records),/distance/);
  records=copy();records.push({...records[0],id:"duplicate-holder"});
  assert.throws(() => validateSectionRecords(database,records),/duplicate holder/);
  records=copy();records.find((r) => r.holderName === "楠岡 由浩")!.timeSeconds++;
  assert.throws(() => validateSectionRecords(database,records),/co-holder/);
  records=copy();records[0].athleteId=records[1].athleteId;
  assert.throws(() => validateSectionRecords(database,records),/association/);
  records=copy();records.find((r) => r.editionNumber===39)!.athleteId=records[0].athleteId;
  assert.throws(() => validateSectionRecords(database,records),/name matching/);
});
