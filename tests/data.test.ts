import test from "node:test";
import assert from "node:assert/strict";
import dataset from "../data/all-japan-2024.json" with { type: "json" };
import { createFileRepository, validateDatabase } from "../lib/repository.ts";
import { parseFilters, queryHref, formatTime } from "../lib/query.ts";
import type { Database } from "../lib/model.ts";
const db: Database = dataset;
const repository = createFileRepository(db);
const search = (p: Record<string, string>) =>
  repository.search(parseFilters(p));
test("official batch has 25 universities, 200 athletes/results and eight sections per entry", () => {
  validateDatabase(db);
  assert.equal(db.universities.length, 25);
  assert.equal(db.athletes.length, 200);
  assert.equal(db.results.length, 200);
  for (const entry of db.entries)
    assert.equal(db.results.filter((r) => r.entryId === entry.id).length, 8);
  assert.equal(
    db.sections.reduce((sum, s) => sum + (s.distanceKm ?? 0), 0),
    106.8,
  );
  assert.ok(db.athletes.every((a) => a.birthDate === null));
});
test("each university section sum matches independently transcribed official total (PDF p.1)", () => {
  const totals = [
    "5:09:56",
    "5:10:24",
    "5:10:41",
    "5:13:17",
    "5:14:24",
    "5:14:57",
    "5:16:21",
    "5:16:24",
    "5:17:46",
    "5:17:52",
    "5:18:08",
    "5:19:49",
    "5:20:08",
    "5:22:42",
    "5:23:43",
    "5:28:58",
    "5:31:36",
    "5:32:53",
    "5:33:52",
    "5:35:50",
    "5:37:24",
    "5:38:18",
    "5:40:11",
    "5:40:28",
    "5:57:12",
  ];
  db.entries.forEach((entry, i) =>
    assert.equal(
      formatTime(
        db.results
          .filter((r) => r.entryId === entry.id)
          .reduce((sum, r) => sum + (r.timeSeconds ?? 0), 0),
      ),
      totals[i],
      entry.universityId,
    ),
  );
});
test("invalid sources, foreign keys, cross-edition joins and duplicate starts are rejected", () => {
  for (const mutate of [
    (d: Database) => {
      d.results[0].sourceId = "missing";
    },
    (d: Database) => {
      d.results[0].athleteId = "missing";
    },
    (d: Database) => {
      d.sections[0].editionId = "missing";
    },
    (d: Database) => {
      d.results[1].sectionId = d.results[0].sectionId;
    },
    (d: Database) => {
      d.results[1].athleteId = d.results[0].athleteId;
    },
    (d: Database) => {
      d.results[0].timeSeconds = -1;
    },
  ]) {
    const copy = structuredClone(db);
    mutate(copy);
    assert.throws(() => validateDatabase(copy));
  }
});
test("all filters intersect and normalized names tolerate spaces", async () => {
  const result = await search({
    race: "all-japan",
    edition: "all-japan-2024",
    year: "2024",
    university: "kokugakuin",
    section: "6",
    q: "山本歩夢",
  });
  assert.equal(result.total, 1);
  assert.equal(result.rows[0].timeSeconds, 2207);
  assert.equal(result.rows[0].rank, 1);
  assert.equal((await search({ year: "2023" })).total, 0);
  assert.equal((await search({ university: "missing" })).total, 0);
  assert.equal((await search({ athlete: result.rows[0].athleteId })).total, 1);
});
test("numeric sorting, deterministic tie breaks and page boundaries", async () => {
  const asc = await search({ section: "7", sort: "time", pageSize: "50" });
  assert.equal(asc.rows[0].athlete.name, "篠原 倖太朗");
  assert.equal(asc.rows[0].timeSeconds, 2997);
  assert.equal(asc.rows.filter((r) => r.rank === 2).length, 2); // Preserve official ties.
  const desc = await search({ section: "7", sort: "time", direction: "desc" });
  assert.equal(desc.rows[0].timeSeconds, 3887);
  const first = await search({ pageSize: "10" }),
    second = await search({ pageSize: "10", page: "2" });
  assert.equal(first.pageCount, 20);
  assert.equal(
    new Set([...first.rows, ...second.rows].map((r) => r.id)).size,
    20,
  );
  assert.equal((await search({ page: "9999" })).page, 8);
});
test("empty datasets and unknown values remain usable; nulls sort last", async () => {
  const copy = structuredClone(db);
  copy.results[0].timeSeconds = null;
  const repo = createFileRepository(copy);
  for (const direction of ["asc", "desc"]) {
    const result = await repo.search(
      parseFilters({ university: "kokugakuin", sort: "time", direction }),
    );
    assert.equal(result.rows.at(-1)?.timeSeconds, null);
  }
  copy.results = [];
  assert.equal(
    (await createFileRepository(copy).search(parseFilters({}))).total,
    0,
  );
});
test("URL codec validates input and round trips Unicode filters", () => {
  const f = parseFilters({
    page: "-2",
    pageSize: "999",
    sort: "__proto__",
    direction: "bad",
    q: ["山本 歩夢", "other"],
  });
  assert.equal(f.page, 1);
  assert.equal(f.pageSize, 25);
  assert.equal(f.sort, "section");
  assert.equal(f.direction, "asc");
  const url = new URL(queryHref("/results", f), "http://localhost");
  assert.deepEqual(parseFilters(Object.fromEntries(url.searchParams)), f);
  assert.equal(parseFilters({ page: "Infinity" }).page, 1);
  assert.equal(formatTime(null), "—");
  assert.equal(formatTime(3603), "1:00:03");
});
