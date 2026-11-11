import Link from "next/link";
import { getRepository } from "../lib/repository";
import {
  formatTime,
  parseFilters,
  queryHref,
  type QueryParams,
  type Filters,
  type SortKey,
} from "../lib/query";
import { Empty, Sources } from "./database";
export async function Results({
  params,
  path = "/results",
  scope = {},
}: {
  params: QueryParams;
  path?: string;
  scope?: Partial<Filters>;
}) {
  const filters = { ...parseFilters(params), ...scope };
  const repository = getRepository();
  const [catalog, result] = await Promise.all([
    repository.catalog(),
    repository.search(filters),
  ]);
  const labels: [SortKey, string][] = [
    ["race", "赛事"],
    ["year", "年份"],
    ["university", "大学"],
    ["section", "区间"],
    ["athlete", "选手"],
    ["time", "成绩"],
    ["rank", "区间顺位"],
  ];
  const select = (
    name: keyof Filters,
    label: string,
    options: { id: string; name: string }[],
  ) =>
    !scope[name] && (
      <label className="grid gap-2 text-sm" key={name}>
        {label}
        <select
          name={name}
          defaultValue={String(filters[name])}
          className="min-w-0 border border-stone-300 bg-white p-2"
        >
          <option value="">全部</option>
          {filters[name] &&
            !options.some((o) => o.id === String(filters[name])) && (
              <option value={String(filters[name])}>
                未收录：{filters[name]}
              </option>
            )}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <section className="mt-8" aria-label="区间成绩查询">
      <form
        key={JSON.stringify(filters)}
        action={path}
        method="get"
        className="grid gap-4 border border-stone-200 bg-stone-100 p-5 sm:grid-cols-3 lg:grid-cols-4"
      >
        {Object.entries(scope).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={String(value)} />
        ))}
        {filters.edition && !scope.edition && (
          <input type="hidden" name="edition" value={filters.edition} />
        )}
        {filters.athlete && !scope.athlete && (
          <input type="hidden" name="athlete" value={filters.athlete} />
        )}
        {select("race", "赛事", catalog.races)}
        {select(
          "year",
          "年份",
          [...new Set(catalog.editions.map((e) => e.year))].map((year) => ({
            id: String(year),
            name: String(year),
          })),
        )}
        {select("university", "大学", catalog.universities)}
        {select(
          "section",
          "区间",
          [...new Set(catalog.sections.map((s) => s.number))]
            .sort((a, b) => a - b)
            .map((n) => ({ id: String(n), name: `${n}区` })),
        )}
        <label className="grid gap-2 text-sm">
          选手姓名
          <input
            name="q"
            defaultValue={filters.q}
            maxLength={100}
            placeholder="支持部分姓名"
            className="min-w-0 border border-stone-300 bg-white p-2"
          />
        </label>
        <label className="grid gap-2 text-sm">
          排序
          <select
            name="sort"
            defaultValue={filters.sort}
            className="border border-stone-300 bg-white p-2"
          >
            {labels.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm">
          方向
          <select
            name="direction"
            defaultValue={filters.direction}
            className="border border-stone-300 bg-white p-2"
          >
            <option value="asc">升序</option>
            <option value="desc">降序</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm">
          每页
          <select
            name="pageSize"
            defaultValue={filters.pageSize}
            className="border border-stone-300 bg-white p-2"
          >
            {[10, 25, 50].map((n) => (
              <option key={n} value={n}>
                {n} 条
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-5">
          <button className="bg-red-900 px-5 py-2 text-white" type="submit">
            应用筛选
          </button>
          <Link className="text-sm underline" href={queryHref(path, scope)}>
            重置筛选
          </Link>
        </div>
      </form>
      {(filters.edition || filters.athlete) && (
        <p className="mt-4 text-sm text-stone-600">
          当前限定：
          {catalog.editions.find((e) => e.id === filters.edition)?.year}
          {filters.edition ? " 届次 " : ""}
          {catalog.athletes.find((a) => a.id === filters.athlete)?.name} ·{" "}
          <Link className="underline" href="/results">
            查询全部成绩
          </Link>
        </p>
      )}
      <div className="my-5 flex flex-wrap justify-between gap-2 text-sm text-stone-600">
        <p role="status">共 {result.total} 条成绩</p>
        <p>区间距离不同，请结合区间筛选比较成绩。</p>
      </div>
      {result.total === 0 ? (
        <Empty>
          {catalog.results.length
            ? "筛选无结果，请调整条件或重置筛选。"
            : "暂无区间成绩，待核验后收录。"}
        </Empty>
      ) : (
        <div className="overflow-x-auto border border-stone-200 bg-white">
          <table className="w-full whitespace-nowrap text-left text-sm">
            <caption className="sr-only">
              区间成绩，点击列名排序；点击赛事、大学或选手继续查询。
            </caption>
            <thead className="bg-stone-100">
              <tr>
                {labels.map(([key, label]) => (
                  <th
                    className="p-4"
                    key={key}
                    aria-sort={
                      filters.sort === key
                        ? filters.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <Link
                      href={queryHref(path, {
                        ...filters,
                        sort: key,
                        direction:
                          filters.sort === key && filters.direction === "asc"
                            ? "desc"
                            : "asc",
                        page: 1,
                      })}
                    >
                      {label}{" "}
                      {filters.sort === key
                        ? filters.direction === "asc"
                          ? "↑"
                          : "↓"
                        : "↕"}
                    </Link>
                  </th>
                ))}
                <th className="p-4">来源</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-stone-100 hover:bg-stone-50"
                >
                  <td className="p-4">
                    <Link
                      className="text-red-800 underline"
                      href={`/editions/${row.edition.id}`}
                    >
                      {row.race.name}
                    </Link>
                  </td>
                  <td className="p-4">{row.edition.year}</td>
                  <td className="p-4">
                    <Link
                      className="text-red-800 underline"
                      href={`/universities/${row.university.id}`}
                    >
                      {row.university.name}
                    </Link>
                  </td>
                  <td className="p-4">
                    <Link
                      className="underline"
                      href={queryHref("/results", {
                        edition: row.edition.id,
                        section: String(row.section.number),
                      })}
                    >
                      {row.section.number}区 · {row.section.distanceKm ?? "—"}{" "}
                      km
                    </Link>
                  </td>
                  <td className="p-4">
                    <Link
                      className="text-red-800 underline"
                      href={`/athletes/${row.athlete.id}`}
                    >
                      {row.athlete.name}
                    </Link>
                  </td>
                  <td className="p-4 font-mono tabular-nums">
                    {formatTime(row.timeSeconds)}
                  </td>
                  <td className="p-4 tabular-nums">{row.rank ?? "—"}</td>
                  <td className="p-4">
                    <a className="underline" href={row.source.url}>
                      官方 ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav
        aria-label="成绩分页"
        className="mt-6 flex items-center justify-center gap-6 text-sm"
      >
        {result.page > 1 && (
          <Link href={queryHref(path, { ...filters, page: result.page - 1 })}>
            上一页
          </Link>
        )}
        <span>
          第 {result.page} / {result.pageCount} 页
        </span>
        {result.page < result.pageCount && (
          <Link href={queryHref(path, { ...filters, page: result.page + 1 })}>
            下一页
          </Link>
        )}
      </nav>
      <Sources sources={catalog.sources} />
    </section>
  );
}
