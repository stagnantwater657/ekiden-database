import assert from "node:assert/strict";
import test from "node:test";
import { database } from "../data/index.ts";
import {
  athleteProfileSupplements,
  athleteSupplementFor,
  athleteSupplementSourceIds,
  formatPersonalBest,
  validateAthleteProfiles,
  type AthleteProfileSupplement,
} from "../lib/athlete-facts.ts";
import { athleteArchive } from "../lib/profiles.ts";

// Fictional values exist ONLY in this test fixture, never in production data.
const fixture = (): AthleteProfileSupplement => ({
  athleteId: "athlete-aj24-03-4",
  reviewedAt: "2026-11-15",
  birthDate: {
    value: "2000-01-02", sourceId: "official-2024",
    locator: "synthetic birth date", revision: "unit-test fixture",
  },
  highSchool: {
    value: "架空高校", sourceId: "official-2024",
    locator: "synthetic school", revision: "unit-test fixture",
  },
  personalBests: [
    {
      event: "5000m", timeMilliseconds: 804540, precision: "centisecond",
      achievedOn: "2025-01-10", meet: "synthetic 5000m meet",
      sourceId: "official-2024", locator: "synthetic result", revision: "unit-test fixture",
    },
    {
      event: "10000m", timeMilliseconds: 1662130, precision: "centisecond",
      achievedOn: "2025-02-10", meet: "synthetic 10000m meet",
      sourceId: "official-2024", locator: "synthetic result", revision: "unit-test fixture",
    },
    {
      event: "half-marathon", timeMilliseconds: 3755000, precision: "second",
      achievedOn: "2025-03-10", meet: "synthetic half marathon",
      sourceId: "official-2024", locator: "synthetic result", revision: "unit-test fixture",
    },
  ],
});

test("first-batch athlete IDs are stable and only sourced supplements are exposed", () => {
  validateAthleteProfiles(database);
  assert.ok(Array.isArray(athleteProfileSupplements));
  for (const athleteId of [
    "athlete-aj25-02-7", // 佐藤 圭汰
    "athlete-aj24-03-4", // 黒田 朝日
    "athlete-aj24-02-3", // 伊藤 蒼唯
    "athlete-aj24-05-2", // 山口 智規
    "athlete-aj24-12-1", // 溜池 一太
  ]) {
    assert.ok(database.athletes.some((athlete) => athlete.id === athleteId));
    assert.equal(athleteArchive(database, athleteId)?.supplement, athleteSupplementFor(athleteId));
  }
});

test("PB formatter keeps track hundredths and road whole seconds", () => {
  const profile = fixture();
  assert.deepEqual(profile.personalBests.map(formatPersonalBest), [
    "13:24.54", "27:42.13", "1:02:35",
  ]);
  validateAthleteProfiles(database, [profile]);
  assert.deepEqual(new Set(athleteSupplementSourceIds(profile)), new Set(["official-2024"]));
});

test("PB validation rejects missing provenance, invalid dates and fabricated precision", () => {
  const check = (mutate: (profile: AthleteProfileSupplement) => void, pattern: RegExp) => {
    const profile = fixture();
    mutate(profile);
    assert.throws(() => validateAthleteProfiles(database, [profile]), pattern);
  };
  check((p) => { p.personalBests[0].sourceId = "unknown"; }, /provenance/);
  check((p) => { p.personalBests[0].locator = ""; }, /provenance/);
  check((p) => { p.personalBests[0].timeMilliseconds = 804541; }, /precision/);
  check((p) => { p.personalBests[0].precision = "second"; }, /precision/);
  check((p) => { p.personalBests[0].achievedOn = "2026-12-01"; }, /performance date/);
  check((p) => { p.personalBests[0].achievedOn = "2025-02-30"; }, /performance date/);
  check((p) => { p.personalBests[0].meet = ""; }, /missing meet/);
  check((p) => { p.personalBests.push(structuredClone(p.personalBests[0])); }, /duplicate PB event/);
  check((p) => { p.birthDate!.value = "2025-02-30"; }, /birth date/);
  check((p) => { p.highSchool!.value = " "; }, /high school/);
  check((p) => { p.athleteId = "not-an-athlete"; }, /unknown athlete/);
});

test("repeated IDs, empty profiles and unresolved identity links never get published", () => {
  const a = fixture();
  assert.throws(() => validateAthleteProfiles(database, [a, structuredClone(a)]), /duplicate athlete/);
  a.birthDate = undefined;
  a.highSchool = undefined;
  a.personalBests = [];
  assert.throws(() => validateAthleteProfiles(database, [a]), /empty profile/);
  const uncertain = database.identities.find((item) => item.status === "needs-review");
  assert.ok(uncertain);
  const b = fixture();
  b.athleteId = uncertain!.athleteId;
  assert.throws(() => validateAthleteProfiles(database, [b]), /unresolved identity/);
});

test("first batch publishes only sourced facts with exact hundredths and whole-second half", () => {
  assert.equal(athleteProfileSupplements.length, 5);
  const byId = new Map(athleteProfileSupplements.map((item) => [item.athleteId, item]));
  const marks = (id: string) => byId.get(id)!.personalBests.map(formatPersonalBest);
  assert.deepEqual(marks("athlete-aj25-02-7"), ["13:09.45", "27:28.50"]);
  assert.deepEqual(marks("athlete-aj24-03-4"), ["13:29.56", "27:37.62", "1:01:39"]);
  assert.deepEqual(marks("athlete-aj24-02-3"), ["13:32.88", "27:56.85", "1:01:16"]);
  assert.deepEqual(marks("athlete-aj24-05-2"), ["13:16.38", "27:52.37", "1:01:16"]);
  assert.deepEqual(marks("athlete-aj24-12-1"), ["13:19.24", "27:52.38", "1:00:13"]);
  assert.equal(
    athleteProfileSupplements.reduce((n, profile) => n + profile.personalBests.length, 0),
    14,
  );
  assert.equal(byId.get("athlete-aj24-05-2")!.highSchool!.value, "学法石川高（福島県）");
  for (const profile of athleteProfileSupplements) {
    assert.ok(profile.birthDate, `${profile.athleteId} lacks a sourced birth date`);
    for (const pb of profile.personalBests) {
      assert.ok(pb.meet.trim());
      assert.ok(pb.locator.trim());
      assert.ok(pb.achievedOn < profile.reviewedAt);
    }
  }
});
