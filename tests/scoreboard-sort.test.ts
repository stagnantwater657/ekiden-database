import test from "node:test";
import assert from "node:assert/strict";
import { database } from "../data/index.ts";
import { buildEditionScoreboard, type ScoreboardRow } from "../lib/scoreboard.ts";
import { parseScoreboardSort, scoreboardHref, sortScoreboardRows } from "../lib/scoreboard-sort.ts";

const board = buildEditionScoreboard(database, "all-japan-2024", 2)!;

test("scoreboard defaults to ascending official section rank without mutating results", () => {
  const before = JSON.stringify(board.rows);
  const sorted = sortScoreboardRows(board.rows, parseScoreboardSort({}));
  const ranks = sorted.map((row) => row.rank).filter((rank) => rank !== null);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  assert.equal(JSON.stringify(board.rows), before);
  assert.notEqual(sorted, board.rows);
  assert.deepEqual(parseScoreboardSort({sort:"unknown",direction:"desc"}), {sort:"rank",direction:"asc"});
  assert.deepEqual(parseScoreboardSort({sort:["movement","rank"],direction:["desc","asc"]}), {sort:"movement",direction:"desc"});
});

// Synthetic UI sorting fixture only, never imported as historical facts.
const fixture = [
  ["c", 2, 180, -4], ["b", 1, 120, 3], ["a", 1, 120, 3],
  ["d", 3, 240, 0], ["z", null, null, null],
].map(([id, rank, time, movement]) => ({
  ...board.rows[0], id, rank,
  cumulative: {...board.rows[0].cumulative, timeSeconds:time, movement},
})) as ScoreboardRow[];

for (const [sort, asc, desc] of [
  ["rank", ["a","b","c","d","z"], ["d","c","a","b","z"]],
  ["cumulative", ["a","b","c","d","z"], ["d","c","a","b","z"]],
  ["movement", ["c","d","a","b","z"], ["a","b","d","c","z"]],
] as const) {
  test(`${sort}: both directions, signed values, null last and deterministic ties`, () => {
    for (const [direction, expected] of [["asc", asc], ["desc", desc]] as const) {
      assert.deepEqual(sortScoreboardRows(fixture, {sort,direction}).map((r) => r.id), expected);
      assert.deepEqual(sortScoreboardRows([...fixture].reverse(), {sort,direction}).map((r) => r.id), expected);
    }
  });
}

test("official reference-team movement stays null and sorts last in both directions", () => {
  for (const direction of ["asc", "desc"] as const) {
    const rows = sortScoreboardRows(board.rows, {sort:"movement",direction});
    assert.ok(rows.slice(-2).every((row) => row.entry.rankingEligibility === "reference"));
    assert.ok(rows.slice(-2).every((row) => row.cumulative.movement === null));
  }
});

test("section, edition and sort links preserve URL context and reset stale pagination", () => {
  const query = {section:"2",sort:"movement",direction:"desc",year:"2024",team:["one","two"],page:"3"};
  const url = new URL(scoreboardHref("all-japan-2025", query, {section:"3"}), "https://example.test");
  assert.equal(url.pathname, "/editions/all-japan-2025");
  assert.equal(url.searchParams.get("section"), "3");
  assert.equal(url.searchParams.get("year"), "2024");
  assert.deepEqual(url.searchParams.getAll("team"), ["one","two"]);
  assert.equal(url.searchParams.get("page"), null);
  assert.deepEqual(parseScoreboardSort(Object.fromEntries(url.searchParams)), {sort:"movement",direction:"desc"});
  assert.equal(query.page, "3");
  const final = scoreboardHref("all-japan-2024", query, {section:"final",sort:"rank",direction:"asc"});
  assert.match(final, /section=final&sort=rank&direction=asc/);
});
