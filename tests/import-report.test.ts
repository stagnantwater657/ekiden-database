import test from "node:test";
import assert from "node:assert/strict";
import { database, registry, batches } from "./fixtures/phase-one.ts";
import { assembleDatabase } from "../lib/data-assembly.ts";
import { importReport } from "../lib/importer.ts";
import type { Database } from "../lib/model.ts";
const counts = (db: Database, id: string) => {
  const report = importReport(db, id);
  return [report.crossEditionAthletes, report.reusedFromEarlierEditions];
};
test("real shared identities distinguish cross-edition association from earlier-date reuse", () => {
  assert.deepEqual(counts(database, "all-japan-2024"), [60, 0]);
  assert.deepEqual(counts(database, "all-japan-2025"), [60, 60]);
});
test("batch order and entity array order do not affect identity counts", () => {
  const reversed = assembleDatabase(registry, [...batches].reverse());
  reversed.editions.reverse();
  reversed.entries.reverse();
  reversed.results.reverse();
  for (const id of ["all-japan-2024", "all-japan-2025"])
    assert.deepEqual(counts(reversed, id), counts(database, id));
});
// Reporting-only synthetic fixture: never written to formal history or imported.
function addAppearance(db: Database, id: string, date: string) {
  const source = db.results.find((r) => r.athleteId === "athlete-aj24-01-5")!;
  const entry = db.entries.find((e) => e.id === source.entryId)!;
  const edition = db.editions.find((e) => e.id === entry.editionId)!;
  db.editions.push({ ...edition, id, date });
  db.entries.push({ ...entry, id: `entry-${id}`, editionId: id });
  db.results.push({ ...source, id: `result-${id}`, entryId: `entry-${id}` });
}
test("actual date rather than edition label or year controls earlier reuse; same day excluded", () => {
  const db = structuredClone(database);
  addAppearance(db, "aaa-same-day", "2024-11-03");
  assert.deepEqual(counts(db, "all-japan-2024"), [60, 0]);
  addAppearance(db, "zzz-earlier-day", "2024-11-02");
  assert.deepEqual(counts(db, "all-japan-2024"), [60, 1]);
});
test("backfilled earlier editions recalculate counts and repeated appearances count people only once", () => {
  const db = structuredClone(database);
  assert.deepEqual(counts(db, "all-japan-2024"), [60, 0]);
  addAppearance(db, "fixture-older-a", "2023-11-05");
  assert.deepEqual(counts(db, "all-japan-2024"), [60, 1]);
  addAppearance(db, "fixture-older-b", "2022-11-06");
  assert.deepEqual(counts(db, "all-japan-2024"), [60, 1]);
  assert.deepEqual(counts(db, "all-japan-2025"), [60, 60]);
  assert.deepEqual(counts(db, "fixture-older-b"), [1, 0]);
  assert.deepEqual(counts(db, "fixture-older-a"), [1, 1]);
});
test("unconfirmed candidate links are not identity reuse", () => {
  const reviews = database.identities.filter(
    (i) => i.status === "needs-review",
  );
  assert.equal(reviews.length, 5);
  assert.equal(reviews.filter((i) => i.candidateIds.length > 0).length, 3);
  const unresolvedIds = new Set(reviews.map((i) => i.athleteId));
  for (const review of reviews)
    assert.ok(!review.candidateIds.includes(review.athleteId));
  // Keep all earlier records/candidates, but inspect only unresolved starts this year.
  const db = structuredClone(database);
  const entries = new Set(
    db.entries.filter((e) => e.editionId === "all-japan-2025").map((e) => e.id),
  );
  db.results = db.results.filter(
    (r) => !entries.has(r.entryId) || unresolvedIds.has(r.athleteId),
  );
  assert.deepEqual(counts(db, "all-japan-2025"), [0, 0]);
});
