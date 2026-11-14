import test from "node:test";
import assert from "node:assert/strict";
import { database } from "../data/index.ts";
import supplement from "../data/presentation/all-japan-2024.json" with { type: "json" };
import {
  buildEditionScoreboard,
  formatGap,
  getResultHonors,
  rankMovement,
} from "../lib/scoreboard.ts";
import type { Database } from "../lib/model.ts";

const scoreboard = (edition = "all-japan-2024", section = 1, db = database) =>
  buildEditionScoreboard(db, edition, section)!;

test("official cumulative supplement covers all 216 existing records with traceable sources, no new athletes or results", () => {
  const original = JSON.stringify(database);
  const entryIds = new Set(
    database.entries
      .filter((entry) => entry.editionId === supplement.editionId)
      .map((entry) => entry.id),
  );
  const records = database.results.filter((result) =>
    entryIds.has(result.entryId),
  );
  assert.equal(supplement.cumulative.length, 216);
  assert.deepEqual(
    new Set(supplement.cumulative.map((point) => point.resultId)),
    new Set(records.map((result) => result.id)),
  );
  assert.ok(
    database.sources.some((source) => source.id === supplement.sourceId),
  );
  assert.equal(supplement.usage.permissionReference, null);
  for (const entry of database.entries.filter((entry) =>
    entryIds.has(entry.id),
  )) {
    let sum = 0;
    for (let section = 1; section <= 8; section++) {
      const row = scoreboard("all-japan-2024", section).rows.find(
        (result) => result.entry.id === entry.id,
      )!;
      sum += row.timeSeconds!;
      assert.equal(row.cumulative.timeSeconds, sum);
      assert.equal(row.cumulative.mode, "official");
      assert.match(row.cumulative.locator!, /^p\.2; No\./);
      if (entry.status === "reference") assert.equal(row.cumulative.rank, null);
      if (section === 8) assert.equal(row.cumulative.rank, entry.finalRank);
    }
    assert.equal(sum, entry.totalTimeSeconds);
  }
  assert.equal(
    JSON.stringify(database),
    original,
    "presentation must not mutate verified source data or identities",
  );
});

test("official cumulative rank is not the section rank and retains separately printed equal-second ranks", () => {
  const first = scoreboard().rows.find(
    (row) => row.entry.id === "aj24-komazawa",
  )!;
  // Official PDF p.2 No.1: upper 28:25[13], lower 28:25[14].
  assert.equal(first.rank, 14);
  assert.equal(first.cumulative.rank, 13);
  assert.equal(first.cumulative.movement, null);
  const second = scoreboard("all-japan-2024", 2);
  const aoyama = second.rows.find(
    (row) => row.entry.id === "aj24-aoyama-gakuin",
  )!;
  const soka = second.rows.find((row) => row.entry.id === "aj24-soka")!;
  assert.equal(aoyama.cumulative.timeSeconds, 59 * 60 + 25);
  assert.equal(soka.cumulative.timeSeconds, 59 * 60 + 25);
  assert.equal(aoyama.cumulative.rank, 1);
  assert.equal(soka.cumulative.rank, 2);
  assert.equal(aoyama.cumulative.gapSeconds, 0);
  assert.equal(soka.cumulative.gapSeconds, 0);
  assert.equal(aoyama.cumulative.movement, 3);
});

test("cumulative movement and gap use previous cumulative rank and current leader, not section splits", () => {
  const row = scoreboard("all-japan-2024", 2).rows.find(
    (item) => item.entry.id === "aj24-kokugakuin",
  )!;
  // Official p.2 No.3: 28:20[2] → 1:00:19[6], leader 59:25.
  assert.equal(row.cumulative.rank, 6);
  assert.equal(row.cumulative.movement, -4);
  assert.equal(row.cumulative.timeSeconds, 3619);
  assert.equal(row.cumulative.gapSeconds, 54);
  assert.equal(formatGap(row.cumulative.gapSeconds), "+00:54");
  assert.equal(rankMovement(9, 3), 6);
  assert.equal(rankMovement(3, 9), -6);
  assert.equal(rankMovement(3, 3), 0);
  assert.equal(rankMovement(null, 3), null);
  assert.equal(rankMovement(3, null), null);
  assert.equal(formatGap(null), "—");
  assert.equal(formatGap(0), "+00:00");
  assert.equal(formatGap(45), "+00:45");
  assert.equal(formatGap(3661), "+1:01:01");
  assert.equal(formatGap(-1), "—");
});

test("reference teams have their official cumulative time but no invented rank, movement or gap", () => {
  const view = scoreboard("all-japan-2024", 8);
  assert.equal(view.finalRows.length, 25);
  assert.equal(view.specialRows.length, 2);
  for (const special of view.specialRows) {
    const row = view.rows.find((item) => item.entry.id === special.entry.id)!;
    assert.equal(row.cumulative.timeSeconds, special.entry.totalTimeSeconds);
    assert.equal(row.cumulative.rank, null);
    assert.equal(row.cumulative.movement, null);
    assert.equal(row.cumulative.gapSeconds, null);
    assert.equal(special.gapSeconds, null);
    assert.equal(special.entry.finalRank, null);
  }
  assert.equal(view.finalRows[0].gapSeconds, 0);
  assert.equal(view.finalRows[1].gapSeconds, 28); // Official p.1 5:10:24 vs 5:09:56.
});

function syntheticOrdinaryEdition(): Database {
  // Synthetic unit-test fixture only; never imported or published as race facts.
  const db = structuredClone(database);
  db.entries = db.entries
    .filter(
      (entry) =>
        entry.editionId === "all-japan-2025" && entry.finalRank !== null,
    )
    .slice(0, 2);
  const ids = new Set(db.entries.map((entry) => entry.id));
  db.results = db.results.filter((result) => ids.has(result.entryId));
  db.entries.forEach((entry, index) => {
    entry.totalTimeSeconds = 760 + (index === 0 ? 10 : 0);
    entry.finalRank = index === 0 ? 2 : 1;
    for (const result of db.results.filter((row) => row.entryId === entry.id)) {
      const leg = db.sections.find(
        (section) => section.id === result.sectionId,
      )!.number;
      result.timeSeconds = leg === 2 ? (index === 0 ? 70 : 60) : 100;
    }
  });
  return db;
}

test("ordinary complete editions derive explicit calculated cumulative totals, ties, movement and gaps deterministically", () => {
  const db = syntheticOrdinaryEdition();
  const first = scoreboard("all-japan-2025", 1, db);
  assert.equal(first.cumulativeMode, "calculated");
  assert.equal(first.cumulativeLabel, "按区间用时计算");
  assert.ok(
    first.rows.every(
      (row) => row.cumulative.rank === 1 && row.cumulative.movement === null,
    ),
  );
  const second = scoreboard("all-japan-2025", 2, db);
  const a = second.rows.find((row) => row.entry.id === db.entries[0].id)!;
  const b = second.rows.find((row) => row.entry.id === db.entries[1].id)!;
  assert.deepEqual(
    [
      a.cumulative.timeSeconds,
      a.cumulative.rank,
      a.cumulative.movement,
      a.cumulative.gapSeconds,
    ],
    [170, 2, -1, 10],
  );
  assert.deepEqual(
    [
      b.cumulative.timeSeconds,
      b.cumulative.rank,
      b.cumulative.movement,
      b.cumulative.gapSeconds,
    ],
    [160, 1, 0, 0],
  );
  assert.equal(
    a.cumulative.sourceId,
    null,
    "a calculation is not an official cumulative source",
  );
  db.results.reverse();
  db.entries.reverse();
  assert.deepEqual(scoreboard("all-japan-2025", 2, db).rows, second.rows);
});

test("missing or abnormal results and Hakone never enter the ordinary cumulative calculation", () => {
  for (const edition of [
    "all-japan-2023",
    "izumo-2023",
    "hakone-2024",
    "hakone-2025",
    "hakone-2026",
  ]) {
    const view = scoreboard(edition, 2);
    assert.equal(view.cumulativeMode, "unavailable");
    assert.ok(
      view.rows.every((row) =>
        Object.values(row.cumulative)
          .filter((value) => value !== "unavailable")
          .every((value) => value === null),
      ),
    );
    assert.ok(
      view.specialRows.every(
        (row) => row.gapSeconds === null && row.entry.finalRank === null,
      ),
    );
  }
  const missing = syntheticOrdinaryEdition();
  missing.results[0].timeSeconds = null;
  assert.equal(
    scoreboard("all-japan-2025", 2, missing).cumulativeMode,
    "unavailable",
  );
  const badTotal = syntheticOrdinaryEdition();
  badTotal.entries[0].totalTimeSeconds! += 1;
  assert.equal(
    scoreboard("all-japan-2025", 2, badTotal).cumulativeMode,
    "unavailable",
  );
  for (const status of [
    "did-not-finish",
    "disqualified",
    "did-not-start",
    "unknown",
  ] as const) {
    const abnormal = syntheticOrdinaryEdition();
    abnormal.entries[0].status = status;
    abnormal.entries[0].finalRank = null;
    assert.equal(
      scoreboard("all-japan-2025", 2, abnormal).cumulativeMode,
      "unavailable",
    );
  }
});

test("only explicit verified official awards and records produce badges, including both for the same performance", () => {
  const expected = [
    [1, "平島 龍斗", 1698, false],
    [2, "鶴川 正也", 1864, false],
    [3, "ヴィクター キムタイ", 2002, false],
    [4, "黒田 朝日", 1983, true],
    [5, "野中 恒亨", 2135, false],
    [6, "山本 歩夢", 2207, true],
    [7, "篠原 倖太朗", 2997, false],
    [8, "山川 拓馬", 3429, false],
  ] as const;
  assert.equal(supplement.honors.length, expected.length);
  for (const [section, name, seconds, record] of expected) {
    const row = scoreboard("all-japan-2024", section).rows.find((result) =>
      getResultHonors(result.id),
    )!;
    const honor = getResultHonors(row.id)!;
    assert.equal(row.athlete.name, name);
    assert.equal(row.timeSeconds, seconds);
    assert.equal(honor.sectionAward, true);
    assert.equal(honor.sectionRecord, record);
    assert.match(honor.locator, /^p\.1 区間賞/);
  }
  assert.equal(getResultHonors("unknown"), null);
  for (const row of scoreboard("all-japan-2025", 1).rows)
    assert.equal(getResultHonors(row.id), null);
});

test("scoreboard section sort and navigation fallback are stable and all 11 editions remain available", () => {
  assert.equal(database.editions.length, 11);
  for (const edition of database.editions) {
    for (const leg of database.sections.filter(
      (section) => section.editionId === edition.id,
    )) {
      const view = scoreboard(edition.id, leg.number);
      assert.equal(view.section.id, leg.id);
      assert.ok(view.rows.length > 0);
      const ranked = view.rows.filter((row) => row.rank !== null);
      assert.deepEqual(
        ranked.map((row) => row.rank),
        ranked.map((row) => row.rank).sort((a, b) => a! - b!),
      );
    }
  }
  assert.equal(scoreboard("all-japan-2024", 99).section.number, 1);
  assert.equal(buildEditionScoreboard(database, "not-a-race"), null);
});

test("scoreboard sources include participation evidence and separately sourced stages", () => {
  const view = scoreboard();
  assert.ok(
    view.sources.some(
      (source) => source.id === "iuau-aj2024-completion-affiliations",
    ),
  );
  for (const edition of database.editions) {
    const board = scoreboard(edition.id);
    const included = new Set(board.sources.map((source) => source.id));
    const entryIds = new Set(
      [...board.finalRows, ...board.specialRows].map((item) => item.entry.id),
    );
    for (const result of database.results.filter((item) =>
      entryIds.has(item.entryId),
    )) {
      if (result.grade && result.participationSourceId)
        assert.ok(included.has(result.participationSourceId));
    }
    for (const standing of [...board.finalRows, ...board.specialRows]) {
      for (const stage of standing.entry.stages ?? [])
        assert.ok(included.has(stage.sourceId));
    }
  }
  const db = structuredClone(database);
  const entry = db.entries.find((item) => item.editionId === "all-japan-2024")!;
  const source = { ...db.sources[0], id: "test-only-stage-source" };
  db.sources.push(source);
  entry.stages = [
    {
      kind: "outbound",
      firstSection: 1,
      lastSection: 4,
      timeSeconds: 100,
      rank: null,
      sourceId: source.id,
      locator: "Synthetic unit-test fixture only",
    },
  ];
  assert.ok(
    scoreboard("all-japan-2024", 1, db).sources.some(
      (item) => item.id === source.id,
    ),
  );
});
