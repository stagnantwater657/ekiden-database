import Link from "next/link";
import { getRepository } from "../lib/repository";
import {
  formatTime,
  parseFilters,
  queryHref,
  switchView,
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
    ["section", "区间"],
    ["rank", "区间顺位"],
    ["university", "大学名称"],
    ["athlete", "选手"],
    ["time", "成绩"],
  ];
  const sortOptions: [SortKey, string][] = [
    ["default", "视图默认排序"],
    ...labels,
    ["finalRank", "大学综合排名"],
    ["race", "赛事"],
    ["year", "年份"],
  ];
  const pageGroups = [
    ...new Map(
      result.rows.map((row) => [row.edition.id, row.edition]),
    ).values(),
  ].map((edition) => ({
    edition,
    rows: result.rows.filter((row) => row.edition.id === edition.id),
  }));
  const conditions = [
    filters.season && `赛季：${filters.season}`,
    filters.team &&
      `队伍：${catalog.teams.find((t) => t.id === filters.team)?.name ?? filters.team}`,
    filters.race &&
      `赛事：${catalog.races.find((r) => r.id === filters.race)?.name ?? filters.race}`,
    filters.year && `年份：${filters.year}`,
    filters.edition &&
      `届次：${catalog.editions.find((e) => e.id === filters.edition)?.number ?? filters.edition}`,
    filters.university &&
      `大学：${catalog.universities.find((u) => u.id === filters.university)?.name ?? filters.university}`,
    filters.section && `区间：${filters.section}区`,
    filters.athlete &&
      `选手：${catalog.athletes.find((a) => a.id === filters.athlete)?.name ?? filters.athlete}`,
    filters.q && `姓名包含：${filters.q}`,
  ].filter(Boolean);
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
      <nav aria-label="成绩视图" className="mb-5 flex gap-3">
        {(
          [
            ["section", "区间视图"],
            ["university", "大学视图"],
          ] as const
        ).map(([view, label]) => (
          <Link
            key={view}
            aria-current={filters.view === view ? "page" : undefined}
            className={`border px-4 py-2 text-sm ${filters.view === view ? "border-red-900 bg-red-900 text-white" : "border-stone-300 bg-white"}`}
            href={queryHref(path, switchView(filters, view))}
          >
            {label}
          </Link>
        ))}
      </nav>
      <form
        key={JSON.stringify(filters)}
        action={path}
        method="get"
        className="grid gap-4 border border-stone-200 bg-stone-100 p-5 sm:grid-cols-3 lg:grid-cols-4"
      >
        <input type="hidden" name="view" value={filters.view} />
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
          "season",
          "赛季",
          [...new Set(catalog.editions.map((e) => e.seasonYear))].map(
            (year) => ({ id: String(year), name: String(year) }),
          ),
        )}
        {select("team", "队伍（含选拔队）", catalog.teams)}
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
            {sortOptions.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm">
          方向（仅手动排序）
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
      <aside
        aria-label="查询上下文"
        className="my-5 space-y-2 border-l-2 border-red-800 pl-4 text-sm leading-6 text-stone-600"
      >
        <p>
          {conditions.length
            ? conditions.join(" · ")
            : "筛选范围：全部已收录赛事及年份"}
        </p>
        <p>
          {filters.sort === "default"
            ? filters.view === "section"
              ? "区间视图：届次 → 区间 → 官方区间顺位"
              : "大学视图：届次 → 官方最终综合排名 → 各校区间"
            : `手动排序：每届内按${sortOptions.find(([key]) => key === filters.sort)?.[1]}${filters.direction === "asc" ? "升序" : "降序"}；点击视图可恢复默认排序。`}
        </p>
        <p>
          结果范围：{result.editions.length} 届比赛
          {result.editions.length > 1
            ? "（跨赛事或届次，按届次分组展示，不合并排名）"
            : ""}
        </p>
        <ul className="flex flex-wrap gap-x-5 gap-y-1">
          {result.editions.map((edition) => (
            <li key={edition.id}>
              <Link
                className="text-red-800 underline"
                href={`/editions/${edition.id}`}
              >
                {edition.race.name} · {edition.year} · 第 {edition.number} 届
              </Link>{" "}
              · {edition.date}
            </li>
          ))}
        </ul>
        {(filters.edition || filters.athlete) && (
          <Link className="inline-block underline" href="/results">
            查询全部成绩
          </Link>
        )}
      </aside>
      <div className="my-5 flex flex-wrap justify-between gap-2 text-sm text-stone-600">
        <p role="status">共 {result.total} 条成绩</p>
        <p>
          {filters.sort === "time" && !filters.section
            ? "正在跨区间按用时排序：不同区间距离不可直接比较。"
            : "区间距离不同，请结合区间筛选比较成绩。"}
        </p>
      </div>
      {result.total === 0 ? (
        <Empty>
          {catalog.results.length
            ? "筛选无结果，请调整条件或重置筛选。"
            : "暂无区间成绩，待核验后收录。"}
        </Empty>
      ) : (
        <div className="max-w-4xl overflow-x-auto border border-stone-200 bg-white">
          <table className="w-full whitespace-nowrap text-left text-sm">
            <caption className="sr-only">
              区间成绩，点击列名手动排序；点击区间、大学或选手继续查询。
            </caption>
            <thead className="bg-stone-100">
              <tr>
                {labels.map(([key, label]) => (
                  <th
                    className="px-4 py-3"
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
              </tr>
            </thead>
            {pageGroups.map((group) => (
              <tbody key={group.edition.id}>
                {result.editions.length > 1 && (
                  <tr className="border-t border-stone-300 bg-stone-50">
                    <th colSpan={5} scope="rowgroup" className="px-4 py-3">
                      <Link
                        className="text-red-800 underline"
                        href={`/editions/${group.edition.id}`}
                      >
                        {group.rows[0].race.name} · {group.edition.year} · 第{" "}
                        {group.edition.number} 届 · {group.edition.date}
                      </Link>
                    </th>
                  </tr>
                )}
                {group.rows.map((row) => (
                  <tr
                    key={row.id}
                    data-result-id={row.id}
                    className="border-t border-stone-100 hover:bg-stone-50"
                  >
                    <td className="w-40 px-4 py-3">
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
                    <td className="w-28 px-4 py-3 font-mono tabular-nums">
                      {row.rank ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        className="text-red-800 underline"
                        href={
                          row.university
                            ? `/universities/${row.university.id}`
                            : `/teams/${row.team.id}`
                        }
                      >
                        {row.team.name}
                      </Link>
                      {row.team.kind !== "university" && (
                        <span className="ml-2 text-xs text-stone-500">
                          选拔队 ·{" "}
                          {row.entry.status === "reference"
                            ? "参考成绩"
                            : "无正式综合排名"}
                        </span>
                      )}
                      {filters.view === "university" && (
                        <span className="ml-2 text-xs text-stone-500">
                          综合 {row.entry.finalRank ?? "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        className="text-red-800 underline"
                        href={`/athletes/${row.athlete.id}`}
                      >
                        {row.athlete.name}
                      </Link>
                    </td>
                    <td className="w-28 px-4 py-3 font-mono tabular-nums">
                      {formatTime(row.timeSeconds)}
                      {row.status && row.status !== "finished" && (
                        <span className="ml-2 text-xs">
                          {row.status === "reference"
                            ? "参考成绩"
                            : row.status === "disqualified"
                              ? "失格"
                              : row.status === "did-not-finish"
                                ? "退赛"
                                : row.status === "did-not-start"
                                  ? "未出场"
                                  : "无排名 / 待核验"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
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
      <Sources sources={result.sources} />
    </section>
  );
}
