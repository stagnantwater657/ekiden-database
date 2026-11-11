import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import dataset from "../data/all-japan-2024.json" with { type: "json" };
import type { Database } from "../lib/model.ts";
import { createFileRepository, validateDatabase } from "../lib/repository.ts";
import { parseFilters, queryHref, switchView } from "../lib/query.ts";
const db: Database = dataset;
async function all(
  database: Database,
  params: Record<string, string | undefined> = {},
) {
  const repo = createFileRepository(database);
  const first = await repo.search(parseFilters({ ...params, pageSize: "50" }));
  const rows = [...first.rows];
  for (let page = 2; page <= first.pageCount; page++)
    rows.push(
      ...(
        await repo.search(
          parseFilters({ ...params, pageSize: "50", page: String(page) }),
        )
      ).rows,
    );
  return rows;
}
test("25 final standings independently checked against official p.1 by university name", () => {
  const expected: Record<string, number> = {
    國學院大: 1,
    駒澤大: 2,
    青山学院大: 3,
    創価大: 4,
    早稲田大: 5,
    城西大: 6,
    立教大: 7,
    帝京大: 8,
    東京国際大: 9,
    日本体育大: 10,
    大東文化大: 11,
    中央大: 12,
    東洋大: 13,
    神奈川大: 14,
    東海大: 15,
    京都産業大: 16,
    皇學館大: 17,
    大阪経済大: 18,
    関西大: 19,
    札幌学院大: 20,
    鹿児島大: 21,
    立命館大: 22,
    岡山大: 23,
    新潟大: 24,
    東北大: 25,
  };
  assert.equal(db.entries.length, Object.keys(expected).length);
  for (const entry of db.entries) {
    const name = db.universities.find((u) => u.id === entry.universityId)!.name;
    assert.equal(entry.finalRank, expected[name], name);
    const source = db.sources.find((s) => s.id === entry.finalRankSourceId)!;
    assert.equal(
      source.url,
      "https://daigaku-ekiden.com/result/files/result_241103.pdf",
    );
    assert.match(source.locator, /p\.1/);
    assert.ok(Number.isFinite(Date.parse(source.collectedAt)));
  }
});
test("original 200 section results including their provenance remain byte-equivalent as JSON values", () => {
  assert.equal(
    createHash("sha256").update(JSON.stringify(db.results)).digest("hex"),
    "3ffb35885a6bbba18c5ce5577b99bda5bb70ef2bfb92ce29e8b88300f657ca92",
  );
});
test("default section view follows sections, official rank, time and stable IDs independently of input order", async () => {
  const copy = structuredClone(db);
  copy.results.reverse();
  copy.entries.reverse();
  const rows = await all(copy);
  assert.equal(rows[0].athlete.name, "平島 龍斗");
  assert.deepEqual(
    rows.slice(0, 3).map((r) => r.rank),
    [1, 2, 3],
  );
  assert.equal(rows[25].section.number, 2);
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1],
      b = rows[i];
    assert.ok(a.section.number <= b.section.number);
    if (a.section.number === b.section.number) assert.ok(a.rank! <= b.rank!);
  }
  const tied = rows.filter((r) => r.section.number === 7 && r.rank === 2);
  assert.equal(tied.length, 2);
  assert.ok(tied[0].id.localeCompare(tied[1].id) < 0);
  assert.deepEqual(
    rows.map((r) => r.id),
    (await all(db)).map((r) => r.id),
  );
  assert.equal(new Set(rows.map((r) => r.id)).size, 200);
});
test("university view uses official final rank, then each university sections 1 through 8", async () => {
  const copy = structuredClone(db);
  copy.results.reverse();
  copy.entries.reverse();
  const rows = await all(copy, { view: "university" });
  assert.equal(rows[0].university.id, "kokugakuin");
  for (let i = 0; i < 25; i++) {
    const group = rows.slice(i * 8, i * 8 + 8);
    assert.ok(group.every((r) => r.entry.finalRank === i + 1));
    assert.deepEqual(
      group.map((r) => r.section.number),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
  }
});
test("missing official ranks are last within their section/edition, with deterministic unranked teams", async () => {
  const copy = structuredClone(db);
  copy.results.find((r) => r.sectionId === "aj24-s1" && r.rank === 1)!.rank =
    null;
  let rows = await all(copy);
  assert.equal(rows[24].rank, null);
  assert.equal(rows[25].section.number, 2);
  copy.entries[0].finalRank = null;
  copy.entries[1].finalRank = null;
  rows = await all(copy, { view: "university" });
  assert.equal(rows[0].entry.finalRank, 3);
  assert.ok(rows.slice(-16).every((r) => r.entry.finalRank === null));
  assert.deepEqual(
    rows.slice(-16, -8).map((r) => r.section.number),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  for (const direction of ["asc", "desc"])
    assert.equal(
      (await all(copy, { sort: "rank", direction, section: "1" })).at(-1)!.rank,
      null,
    );
});
function crossEditionFixture(): Database {
  // Synthetic relational fixture only: not published as real race results.
  const copy = structuredClone(db);
  copy.sources.push({ ...copy.sources[0], id: "test-only-source" });
  copy.editions.push({
    ...copy.editions[0],
    id: "test-edition",
    year: 2023,
    number: 55,
  });
  copy.sections.push(
    ...db.sections.map((s) => ({
      ...s,
      id: `test-${s.id}`,
      editionId: "test-edition",
    })),
  );
  copy.entries.push(
    ...db.entries.map((e) => ({
      ...e,
      id: `test-${e.id}`,
      editionId: "test-edition",
      finalRankSourceId: "test-only-source",
    })),
  );
  copy.results.push(
    ...db.results.map((r) => ({
      ...r,
      id: `test-${r.id}`,
      entryId: `test-${r.entryId}`,
      sectionId: `test-${r.sectionId}`,
      sourceId: "test-only-source",
    })),
  );
  copy.results.reverse();
  return copy;
}
test("different editions never mix sections, in either view or manual time sorting", async () => {
  for (const params of [
    {},
    { view: "university" },
    { sort: "time", direction: "desc" },
  ]) {
    const rows = await all(crossEditionFixture(), params);
    assert.ok(rows.slice(0, 200).every((r) => r.edition.year === 2023));
    assert.ok(rows.slice(200).every((r) => r.edition.year === 2024));
    assert.equal(new Set(rows.map((r) => r.id)).size, 400);
  }
});
test("query-wide sources and edition ranges include off-page matches, exclude unrelated sources", async () => {
  const fixture = crossEditionFixture();
  fixture.sources.push({ ...db.sources[0], id: "unrelated" });
  const repo = createFileRepository(fixture);
  const result = await repo.search(parseFilters({ pageSize: "10" }));
  assert.equal(result.editions.length, 2);
  assert.deepEqual(
    new Set(result.sources.map((s) => s.id)),
    new Set(["test-only-source", "official-2024", "official-2024-final-ranks"]),
  );
  const filtered = await repo.search(parseFilters({ year: "2023" }));
  assert.deepEqual(
    filtered.sources.map((s) => s.id),
    ["test-only-source"],
  );
  assert.equal(filtered.editions.length, 1);
  const empty = await repo.search(parseFilters({ q: "no such runner" }));
  assert.deepEqual(empty.sources, []);
  assert.deepEqual(empty.editions, []);
});
test("URL round trips view/manual sort/page and view switches clear sorting and reset pagination", () => {
  const filters = parseFilters({
    view: "university",
    sort: "time",
    direction: "desc",
    page: "4",
    section: "7",
    year: "2024",
  });
  const url = new URL(queryHref("/results", filters), "https://example.org");
  assert.deepEqual(parseFilters(Object.fromEntries(url.searchParams)), filters);
  assert.deepEqual(switchView(filters, "section"), {
    ...filters,
    view: "section",
    sort: "default",
    direction: "asc",
    page: 1,
  });
  assert.equal(parseFilters({ view: "bad", sort: "bad" }).view, "section");
  assert.equal(parseFilters({ view: "bad", sort: "bad" }).sort, "default");
});
test("final ranking validation rejects invalid values and missing provenance, accepts null", () => {
  for (const rank of [0, -1, 1.5]) {
    const copy = structuredClone(db);
    copy.entries[0].finalRank = rank;
    assert.throws(() => validateDatabase(copy));
  }
  const copy = structuredClone(db);
  copy.entries[0].finalRankSourceId = null;
  assert.throws(() => validateDatabase(copy));
  copy.entries[0].finalRankSourceId = "missing";
  assert.throws(() => validateDatabase(copy));
  copy.entries[0].finalRank = null;
  copy.entries[0].finalRankSourceId = null;
  assert.doesNotThrow(() => validateDatabase(copy));
});

test("equal official section ranks use time before ID; missing times are last among ties", async () => {
  const copy = structuredClone(db);
  const tied = copy.results
    .filter((r) => r.sectionId === "aj24-s7" && r.rank === 2)
    .sort((a, b) => a.id.localeCompare(b.id));
  tied[0].timeSeconds = 3100;
  tied[1].timeSeconds = 3000;
  let rows = (await all(copy, { section: "7" })).filter((r) => r.rank === 2);
  assert.deepEqual(
    rows.map((r) => r.id),
    [tied[1].id, tied[0].id],
  );
  tied[1].timeSeconds = null;
  rows = (await all(copy, { section: "7" })).filter((r) => r.rank === 2);
  assert.deepEqual(
    rows.map((r) => r.id),
    [tied[0].id, tied[1].id],
  );
});

test("distinct races retain deterministic groups even with identical years and edition numbers", async () => {
  const copy = crossEditionFixture();
  copy.races.push({ ...copy.races[0], id: "another-race", name: "TEST ONLY" });
  const edition = copy.editions.find((e) => e.id === "test-edition")!;
  edition.raceId = "another-race";
  edition.year = 2024;
  edition.number = 56;
  const rows = await all(copy);
  assert.ok(rows.slice(0, 200).every((r) => r.race.id === "all-japan"));
  assert.ok(rows.slice(200).every((r) => r.race.id === "another-race"));
});
