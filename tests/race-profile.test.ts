import assert from "node:assert/strict";
import test from "node:test";
import { database } from "../data/index.ts";
import {
  getRaceProfile,
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
    assert.ok(profile.sections.every((section) => section.record === null));
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
