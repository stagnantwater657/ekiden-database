export type QueryParams = Record<string, string | string[] | undefined>;
export const sortKeys = [
  "default",
  "race",
  "year",
  "university",
  "section",
  "athlete",
  "time",
  "rank",
] as const;
export type SortKey = (typeof sortKeys)[number];
export type ResultView = "section" | "university";
export interface Filters {
  view: ResultView;
  race: string;
  edition: string;
  year: string;
  university: string;
  section: string;
  athlete: string;
  q: string;
  sort: SortKey;
  direction: "asc" | "desc";
  page: number;
  pageSize: number;
}
const scalar = (value: QueryParams[string]) =>
  (Array.isArray(value) ? value[0] : value) ?? "";
export function parseFilters(params: QueryParams): Filters {
  const read = (key: string) => scalar(params[key]).trim();
  const sort = read("sort");
  const page = Number(read("page"));
  return {
    view: read("view") === "university" ? "university" : "section",
    race: read("race"),
    edition: read("edition"),
    year: read("year"),
    university: read("university"),
    section: read("section"),
    athlete: read("athlete"),
    q: read("q").slice(0, 100),
    sort: sortKeys.includes(sort as SortKey) ? (sort as SortKey) : "default",
    direction: read("direction") === "desc" ? "desc" : "asc",
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: [10, 25, 50].includes(Number(read("pageSize")))
      ? Number(read("pageSize"))
      : 25,
  };
}
export function queryHref(path: string, filters: Partial<Filters>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value !== "" && value !== undefined) query.set(key, String(value));
  return query.size ? `${path}?${query}` : path;
}
export function formatTime(seconds: number | null): string {
  if (seconds === null) return "—";
  const s = String(seconds % 60).padStart(2, "0");
  return seconds >= 3600
    ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${s}`
    : `${Math.floor(seconds / 60)}:${s}`;
}

export function switchView(filters: Filters, view: ResultView): Filters {
  return { ...filters, view, sort: "default", direction: "asc", page: 1 };
}
