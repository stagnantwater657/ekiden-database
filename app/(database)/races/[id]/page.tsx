import Link from "next/link";
import { notFound } from "next/navigation";
import { Sources } from "../../../../components/database";
import { getRaceProfile } from "../../../../lib/race-profile";
import { formatTime } from "../../../../lib/query";
import { getRepository } from "../../../../lib/repository";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = getRaceProfile(await getRepository().catalog(), id);
  if (!profile) notFound();
  const { race, metadata, courseMetadata, latest, sections, archive } = profile;
  return (
    <>
      <header className="archive-header">
        <Link className="eyebrow archive-link" href="/races">
          赛事档案 / RACE FILE
        </Link>
        <h1 className="archive-title">{metadata?.nameZh ?? race.name}</h1>
        <p className="mt-3 text-lg font-semibold" lang="ja">
          {race.name}
        </p>
        <p className="archive-lead">
          路线、优胜校与历届成绩，沿同一份赛事档案查阅。
        </p>
        {latest && (
          <Link
            className="archive-link mt-5 inline-block text-sm font-semibold"
            href={`/editions/${latest.id}`}
          >
            查看最新已收录赛事 · {latest.year} 第{latest.number}回 →
          </Link>
        )}
      </header>
      <section className="archive-section" aria-labelledby="race-overview">
        <h2 id="race-overview" className="section-heading">
          赛事基本资料
        </h2>
        <div className="mt-5 grid gap-8 lg:grid-cols-[1fr_1.25fr]">
          <dl className="profile-facts profile-facts-single">
            <div>
              <dt>创办年份</dt>
              <dd className="tabular-nums">
                {metadata?.foundingYear ?? "尚未核实"}
              </dd>
            </div>
            <div>
              <dt>通常举办日期</dt>
              <dd>
                {profile.schedule}
                <span className="ml-2 text-xs text-[var(--muted)]">
                  已收录届次
                </span>
              </dd>
            </div>
            <div>
              <dt>路线版本</dt>
              <dd>
                {latest ? `${latest.year} · 第${latest.number}回` : "尚未收录"}
              </dd>
            </div>
          </dl>
          <div>
            <dl className="metric-grid">
              <div className="metric">
                <dt>当前区间数</dt>
                <dd>
                  {latest ? sections.length : "—"}
                  <span className="ml-2 text-sm font-normal">区间</span>
                </dd>
              </div>
              <div className="metric">
                <dt>当前总距离</dt>
                <dd>
                  {latest?.distanceKm ?? "—"}
                  <span className="ml-2 text-sm font-normal">km</span>
                </dd>
              </div>
              <div className="metric">
                <dt>档案收录</dt>
                <dd>
                  {archive.length}
                  <span className="ml-2 text-sm font-normal">届</span>
                </dd>
              </div>
            </dl>
            <div className="mt-5 border-l-2 border-[var(--brand)] pl-4 text-sm leading-7">
              <p>
                <span className="mr-3 text-[var(--muted)]">起点</span>
                {courseMetadata?.start ?? "尚未核实"}
              </p>
              {courseMetadata?.turnaround && (
                <p>
                  <span className="mr-3 text-[var(--muted)]">折返</span>
                  {courseMetadata.turnaround}
                </p>
              )}
              <p>
                <span className="mr-3 text-[var(--muted)]">终点</span>
                {courseMetadata?.finish ?? "尚未核实"}
              </p>
            </div>
          </div>
        </div>
        <p className="source-note mt-5">
          日期范围依据本站已收录赛事，不代表未来赛程；区间与距离采用最新已核验届次，其他届次请查看各自成绩页。
        </p>
      </section>
      <section className="archive-section" aria-labelledby="race-course">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="race-course" className="section-heading">
            区间与路线
          </h2>
          {latest && (
            <p className="text-sm text-[var(--muted)]">
              {latest.year} · 第{latest.number}回路线
            </p>
          )}
        </div>
        {sections.length ? (
          <div
            className="table-scroll mt-4"
            role="region"
            aria-label="区间路线与官方纪录"
            tabIndex={0}
          >
            <table className="archive-table w-full">
              <thead>
                <tr>
                  <th scope="col">区间</th>
                  <th scope="col">距离</th>
                  <th scope="col">官方区间纪录</th>
                  <th scope="col">纪录保持者</th>
                  <th scope="col">创造年份</th>
                </tr>
              </thead>
              <tbody>
                {sections.map((section) => (
                  <tr key={section.id}>
                    <th scope="row">
                      <Link
                        className="archive-link"
                        href={`/editions/${section.editionId}?section=${section.number}`}
                      >
                        {section.number}区
                      </Link>
                    </th>
                    <td className="tabular-nums">
                      {section.distanceKm === null
                        ? "—"
                        : `${section.distanceKm} km`}
                    </td>
                    <td className="tabular-nums">
                      {section.record ? (
                        formatTime(section.record.timeSeconds)
                      ) : (
                        <span className="text-[var(--muted)]">待核实</span>
                      )}
                    </td>
                    <td>
                      {section.record ? (
                        section.record.athleteId ? (
                          <Link
                            className="archive-link"
                            href={`/athletes/${section.record.athleteId}`}
                          >
                            {section.record.holderName}
                          </Link>
                        ) : (
                          section.record.holderName
                        )
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="tabular-nums">
                      {section.record ? (
                        section.record.editionId ? (
                          <Link
                            className="archive-link"
                            href={`/editions/${section.record.editionId}`}
                          >
                            {section.record.year}
                          </Link>
                        ) : (
                          section.record.year
                        )
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">尚未收录可核验的区间路线。</p>
        )}
        <p className="source-note mt-3">
          官方区间纪录须单独核对路线版本与官方认定，不使用本站有限历史成绩中的最快值代替。
        </p>
      </section>
      <section className="archive-section" aria-labelledby="race-champions">
        <h2 id="race-champions" className="section-heading">
          已收录届次的优胜大学
        </h2>
        {archive.some((item) => item.winners.length) ? (
          <div
            className="table-scroll mt-4"
            role="region"
            aria-label="历届优胜大学"
            tabIndex={0}
          >
            <table className="archive-table w-full">
              <thead>
                <tr>
                  <th scope="col">年份</th>
                  <th scope="col">届次</th>
                  <th scope="col">冠军大学</th>
                  <th scope="col">官方总成绩</th>
                </tr>
              </thead>
              <tbody>
                {archive.flatMap(({ edition, winners }) =>
                  winners.map(({ entry, university, team }) => (
                    <tr key={entry.id}>
                      <td className="tabular-nums">{edition.year}</td>
                      <td>
                        <Link
                          className="archive-link"
                          href={`/editions/${edition.id}`}
                        >
                          第{edition.number}回
                        </Link>
                      </td>
                      <th scope="row">
                        <Link
                          className="archive-link"
                          href={
                            university
                              ? `/universities/${university.id}`
                              : `/teams/${team.id}`
                          }
                        >
                          {university?.name ?? team.name}
                        </Link>
                      </th>
                      <td className="font-mono tabular-nums">
                        {formatTime(entry.totalTimeSeconds)}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">尚未收录已核验的正式冠军成绩。</p>
        )}
        <p className="source-note mt-3">
          仅列本站已收录届次的官方最终第1名，不代表赛事完整冠军史。
        </p>
      </section>
      <section className="archive-section" aria-labelledby="race-editions">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="race-editions" className="section-heading">
            历届赛事档案
          </h2>
          <Link
            className="archive-link text-sm"
            href={`/results?race=${race.id}`}
          >
            跨届高级检索 →
          </Link>
        </div>
        {archive.length ? (
          <ol className="mt-4 divide-y divide-[var(--line)] border-y border-[var(--line)]">
            {archive.map(({ edition, teams, results }) => (
              <li key={edition.id}>
                <Link
                  className="group grid grid-cols-[auto_1fr_auto] items-center gap-4 py-4 sm:gap-7"
                  href={`/editions/${edition.id}`}
                >
                  <span className="text-2xl font-black tabular-nums">
                    {edition.year}
                  </span>
                  <div>
                    <span className="font-semibold group-hover:text-[var(--brand)]">
                      第{edition.number}回
                    </span>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      <time dateTime={edition.date}>{edition.date}</time>
                      {edition.endDate && ` — ${edition.endDate}`} ·{" "}
                      {edition.seasonYear}赛季
                    </p>
                  </div>
                  <span className="text-right text-xs leading-6 text-[var(--muted)]">
                    {teams}支队伍
                    <br />
                    {results}条区间记录 <span aria-hidden="true">↗</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <p className="empty-state">暂无已收录届次。</p>
        )}
      </section>
      <details className="mt-8 border-t border-[var(--line)] pt-4">
        <summary className="cursor-pointer text-sm font-semibold">
          赛事资料与成绩来源
        </summary>
        <Sources sources={profile.sources} />
      </details>
    </>
  );
}
