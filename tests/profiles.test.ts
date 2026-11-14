import assert from "node:assert/strict";
import test from "node:test";
import { database } from "../data/index.ts";
import {
  athleteArchive,
  universityArchive,
  yearRange,
} from "../lib/profiles.ts";

test("athlete archive keeps all verified cross-race/year starts under the stable identity", () => {
  const before = JSON.stringify(database);
  const profile = athleteArchive(database, "athlete-aj24-03-4")!;
  assert.deepEqual(
    profile.groups.map((group) => group.race.id),
    ["hakone", "all-japan", "izumo"],
  );
  assert.ok(profile.groups.every((group) => group.rows.length > 0));
  const expected = database.results.filter(
    (result) => result.athleteId === profile.athlete.id,
  );
  assert.equal(profile.starts, expected.length);
  assert.deepEqual(
    profile.groups.flatMap((group) => group.rows.map((row) => row.id)).sort(),
    expected.map((row) => row.id).sort(),
  );
  assert.ok(
    profile.groups
      .flatMap((group) => group.rows)
      .some((row) => row.edition.year === 2024),
  );
  assert.ok(
    profile.groups
      .flatMap((group) => group.rows)
      .some((row) => row.edition.year === 2026),
  );
  assert.equal(JSON.stringify(database), before);
});

test("selection home universities do not inherit team standings and special affiliations remain visible", () => {
  const selected = database.results.find(
    (result) => result.id === "aj24-japan-selection-s2",
  )!;
  const profile = athleteArchive(database, selected.athleteId)!;
  assert.equal(profile.athlete.id, "athlete-hk25-21-1");
  assert.equal(profile.starts, 2);
  assert.equal(profile.showTeams, true);
  assert.ok(selected.representingUniversityId);
  assert.ok(
    profile.universities.some(
      (item) => item.university.id === selected.representingUniversityId,
    ),
  );
  const university = universityArchive(
    database,
    selected.representingUniversityId!,
  )!;
  assert.ok(
    university.athletes.some((item) => item.athlete.id === selected.athleteId),
  );
  assert.ok(university.selectionStarts > 0);
  assert.ok(
    university.performances.every(
      (item) => item.entry.universityId === university.university.id,
    ),
  );
  assert.ok(
    !university.performances.some((item) => item.entry.id === selected.entryId),
  );
});

test("profile sources cover honors and affiliation evidence without merging review candidates", () => {
  const award = athleteArchive(database, "athlete-aj24-03-4")!;
  assert.ok(
    award.sources.some(
      (source) => source.id === "iuau-aj2024-completion-results",
    ),
  );
  const review = database.identities.find(
    (identity) => identity.status === "needs-review",
  )!;
  const profile = athleteArchive(database, review.athleteId)!;
  assert.equal(profile.needsReview, true);
  assert.ok(
    profile.groups
      .flatMap((group) => group.rows)
      .every((row) => row.athleteId === review.athleteId),
  );
  const selection = athleteArchive(database, "athlete-hk25-21-1")!;
  for (const row of selection.groups.flatMap((group) => group.rows)) {
    if (row.participationSourceId)
      assert.ok(
        selection.sources.some(
          (source) => source.id === row.participationSourceId,
        ),
      );
  }
});

test("empty and missing profiles are explicit; observed years do not become current affiliations", () => {
  assert.equal(athleteArchive(database, "missing"), null);
  assert.equal(universityArchive(database, "missing"), null);
  assert.equal(yearRange([]), "尚未收录");
  assert.equal(yearRange([2025, 2024, 2025]), "2024—2025");
  assert.equal(yearRange([2024, 2024]), "2024");
  const fixture = structuredClone(database);
  const athlete = fixture.athletes[0];
  fixture.results = fixture.results.filter(
    (row) => row.athleteId !== athlete.id,
  );
  const profile = athleteArchive(fixture, athlete.id)!;
  assert.equal(profile.starts, 0);
  assert.equal(profile.universities.length, 0);
  assert.ok(profile.groups.every((group) => group.rows.length === 0));
});
