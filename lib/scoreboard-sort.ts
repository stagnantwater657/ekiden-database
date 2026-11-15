import type { QueryParams } from "./query.ts";
import type { ScoreboardRow } from "./scoreboard.ts";

export type ScoreboardSort = {
  sort: "rank" | "cumulative" | "movement";
  direction: "asc" | "desc";
};

export function parseScoreboardSort(query: QueryParams): ScoreboardSort {
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const sort = first(query.sort);
  if (sort !== "rank" && sort !== "cumulative" && sort !== "movement")
    return { sort: "rank", direction: "asc" };
  return { sort, direction: first(query.direction) === "desc" ? "desc" : "asc" };
}

export function scoreboardHref(
  editionId: string,
  query: QueryParams,
  patch: Record<string, string>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
    for (const item of values) params.append(key, item);
  }
  for (const [key, value] of Object.entries(patch)) params.set(key, value);
  params.delete("page");
  return `/editions/${editionId}?${params}`;
}

export function sortScoreboardRows(
  rows: readonly ScoreboardRow[],
  order: ScoreboardSort,
): ScoreboardRow[] {
  const value = (row: ScoreboardRow) =>
    order.sort === "rank" ? row.rank : order.sort === "cumulative"
      ? row.cumulative.timeSeconds : row.cumulative.movement;
  return [...rows].sort((a, b) => {
    const av = value(a), bv = value(b);
    // Missing values stay last in both directions; ties retain a stable order.
    if (av === null && bv !== null) return 1;
    if (bv === null && av !== null) return -1;
    return (
      (av === null || bv === null ? 0 : (av - bv) * (order.direction === "asc" ? 1 : -1)) ||
      a.id.localeCompare(b.id)
    );
  });
}
