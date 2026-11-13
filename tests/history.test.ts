import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { database, registry, batches } from "../data/index.ts";
import legacy from "../data/all-japan-2024.json" with { type: "json" };
import facts from "../data/imports/all-japan-2025-facts.json" with { type: "json" };
import { assembleDatabase } from "../lib/data-assembly.ts";
import {
  mergeRegistry,
  validateImport,
  importReport,
} from "../lib/importer.ts";
import { identityCandidates, validateIdentity } from "../lib/identity.ts";
import { createFileRepository, validateDatabase } from "../lib/repository.ts";
import {
  parseFilters,
  queryHref,
  switchView,
  formatTime,
} from "../lib/query.ts";
import { seasonYearFor } from "../lib/seasons.ts";
const edition = batches.find((b) => b.edition.id === "all-japan-2025")!;
const repo = createFileRepository(database);
test("all editions validate; legacy 200 complete result objects and published IDs are unchanged", () => {
  validateDatabase(database);
  assert.deepEqual(
    database.results.filter((r) => r.id.startsWith("aj24-")),
    legacy.results,
  );
  for (const key of ["athletes", "universities"] as const)
    for (const entity of legacy[key])
      assert.deepEqual(
        database[key].find((e) => e.id === entity.id),
        entity,
      );
  assert.deepEqual(
    batches[0].entries.map((e) => [e.id, e.finalRank, e.finalRankSourceId]),
    legacy.entries.map((e) => [e.id, e.finalRank, e.finalRankSourceId]),
  );
});
test("2025 complete actual lineup, official ranks and times match independently checked factual ledger", () => {
  assert.equal(facts.length, 216);
  assert.equal(edition.entries.length, 27);
  assert.equal(edition.results.length, 216);
  for (const f of facts) {
    const row = edition.results.find(
      (r) =>
        r.id === `aj25-result-${String(f.bib).padStart(2, "0")}-${f.section}`,
    )!;
    const entry = edition.entries.find((e) => e.id === row.entryId)!;
    assert.equal(
      database.athletes.find((a) => a.id === row.athleteId)?.name,
      f.name,
    );
    assert.equal(formatTime(row.timeSeconds), f.time);
    assert.equal(row.rank, f.rank);
    assert.equal(entry.finalRank, f.finalRank);
    assert.equal(formatTime(entry.totalTimeSeconds), f.total);
    assert.equal(
      database.teams.find((t) => t.id === entry.teamId)?.name,
      f.team,
    );
  }
  assert.deepEqual(
    edition.sections.map((s) => s.distanceKm),
    [9.5, 11.1, 11.9, 11.8, 12.4, 12.8, 17.6, 19.7],
  );
  assert.doesNotThrow(() => validateImport(registry, batches, edition));
  const report = importReport(database, edition.edition.id);
  assert.equal(report.crossEditionAthletes, 60);
  assert.equal(report.reusedFromEarlierEditions, 60);
  assert.equal(report.officialFinalRanks, 25);
  assert.equal(report.review.length, 5);
});
test("repeated import is idempotent; conflicts cannot overwrite published identities or editions", () => {
  assert.deepEqual(
    assembleDatabase(registry, [...batches, edition, edition]),
    database,
  );
  assert.deepEqual(mergeRegistry(registry, registry), registry);
  const changed = structuredClone(edition);
  changed.results[0].timeSeconds = 1;
  assert.throws(
    () => assembleDatabase(registry, [...batches, changed]),
    /Conflicting/,
  );
  const additions = structuredClone(registry);
  additions.athletes[0].name = "changed";
  assert.throws(() => mergeRegistry(registry, additions), /Conflicting/);
  const output = JSON.parse(
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", "scripts/data-import.ts"],
      { encoding: "utf8" },
    ),
  );
  assert.equal(output.reports[1].starts, 216);
});
test("season year is independent of calendar year and URLs retain season/team/view/sort/page", () => {
  for (const y of [2023, 2024, 2025]) {
    assert.equal(seasonYearFor("hakone", y + 1), y);
    assert.equal(seasonYearFor("izumo", y), y);
    assert.equal(seasonYearFor("all-japan", y), y);
  }
  const f = parseFilters({
    season: "2025",
    team: "team-japan-selection",
    view: "university",
    sort: "time",
    direction: "desc",
    page: "3",
  });
  assert.deepEqual(
    parseFilters(
      Object.fromEntries(
        new URL(queryHref("/results", f), "https://example.test").searchParams,
      ),
    ),
    f,
  );
  assert.equal(switchView(f, "section").page, 1);
  assert.equal(switchView(f, "section").season, "2025");
});
test("verified athlete retains a single detail identity over two years; unresolved matches remain separate", async () => {
  const r = await repo.search(parseFilters({ athlete: "athlete-aj24-01-5" }));
  assert.equal(r.total, 2);
  assert.deepEqual(
    r.rows.map((x) => [x.edition.year, x.section.number, x.timeSeconds]),
    [
      [2024, 5, 2135],
      [2025, 3, 1991],
    ],
  );
  for (const i of edition.identities.filter((i) => i.status === "needs-review"))
    assert.ok(!i.candidateIds.includes(i.athleteId));
  assert.equal(
    identityCandidates("野中恒亨", database.athletes)[0],
    "athlete-aj24-01-5",
  );
  const decision = structuredClone(
    edition.identities.find((i) => i.status === "confirmed")!,
  );
  decision.evidenceSourceIds = [decision.evidenceSourceIds[0]];
  assert.throws(
    () =>
      validateIdentity(
        decision,
        database.athletes,
        new Set(database.sources.map((s) => s.id)),
      ),
    /corroborating/,
  );
});
test("selection teams retain official section ranks but have no official overall ranking", async () => {
  const found = await repo.search(
    parseFilters({
      team: "team-japan-selection",
      season: "2025",
      view: "university",
    }),
  );
  assert.equal(found.total, 8);
  assert.ok(
    found.rows.every(
      (r) =>
        r.university === null &&
        r.entry.finalRank === null &&
        r.rank !== null &&
        r.status === "reference",
    ),
  );
  const result = await repo.search(
    parseFilters({
      edition: "all-japan-2025",
      view: "university",
      pageSize: "50",
      page: "5",
    }),
  );
  assert.ok(result.rows.every((r) => r.entry.finalRank === null));
  assert.deepEqual(found.sources.map((s) => s.id).sort(), [
    "iuau-aj2025-results",
    "iuau-aj2025-roster",
  ]);
});
test("mixed editions paginate deterministically and default section and university views remain intact", async () => {
  for (const view of ["section", "university"]) {
    const all = [];
    for (let page = 1; page <= 9; page++)
      all.push(
        ...(
          await repo.search(
            parseFilters({ view, page: String(page), pageSize: "50" }),
          )
        ).rows,
      );
    assert.equal(all.length, 416);
    assert.equal(new Set(all.map((r) => r.id)).size, 416);
    assert.ok(all.slice(0, 200).every((r) => r.edition.year === 2024));
    assert.ok(all.slice(200).every((r) => r.edition.year === 2025));
    const current = all.slice(200);
    if (view === "section")
      assert.deepEqual(
        current.slice(0, 27).map((r) => r.rank),
        Array.from({ length: 27 }, (_, i) => i + 1),
      );
    else {
      assert.equal(current[0].team.name, "駒澤大");
      assert.deepEqual(
        current.slice(0, 8).map((r) => r.section.number),
        [1, 2, 3, 4, 5, 6, 7, 8],
      );
    }
  }
});
test("invalid global IDs, relationships, status, season, distance and identity evidence fail closed", () => {
  for (const mutate of [
    (d: typeof database) => {
      d.teams[0].id = d.athletes[0].id;
    },
    (d: typeof database) => {
      d.editions[0].seasonYear = 2020;
    },
    (d: typeof database) => {
      d.sections[0].distanceKm = 10;
    },
    (d: typeof database) => {
      d.results[0].sectionId = "aj25-s1";
    },
    (d: typeof database) => {
      d.results[1].athleteId = d.results[0].athleteId;
    },
    (d: typeof database) => {
      d.entries.at(-1)!.finalRank = 1;
    },
    (d: typeof database) => {
      d.entries[0].status = "disqualified";
    },
    (d: typeof database) => {
      d.results.at(-1)!.grade = "M2";
      d.results.at(-1)!.participationSourceId = "missing";
    },
  ]) {
    const d = structuredClone(database);
    mutate(d);
    assert.throws(() => validateDatabase(d));
  }
  const bad = structuredClone(edition);
  bad.sections[0].editionId = "all-japan-2024";
  assert.throws(() => validateImport(registry, [batches[0]], bad));
});
