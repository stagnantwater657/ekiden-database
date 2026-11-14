import Link from "next/link";
import type { Source } from "../lib/model";
import type { AthleteArchive } from "../lib/profiles";
import { yearRange } from "../lib/profiles";
import { formatTime, queryHref } from "../lib/query";
import { ResultBadges } from "./result-badges";

export function ProfileSources({ sources }: { sources: Source[] }) {
  return (
    <details className="source-note mt-10" aria-label="档案资料来源">
      <summary className="cursor-pointer font-bold">
        资料来源与核验说明 · {sources.length} 项
      </summary>
      <p className="mt-3">
        本页仅展示已收录资料；缺失的个人资料与 PB 不根据驿传成绩推算。
      </p>
      <ul className="mt-4 space-y-4">
        {sources.map((source) => (
          <li key={source.id}>
            <a className="archive-link font-medium" href={source.url}>
              {source.title} ↗
            </a>
            <p>{source.coverage}</p>
            <p>
              {source.locator} · 采集于{" "}
              <time dateTime={source.collectedAt}>
                {source.collectedAt.slice(0, 10)}
              </time>
            </p>
            {source.revision && <p>采用版本：{source.revision}</p>}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function AthleteProfile({ profile }: { profile: AthleteArchive }) {
  const { athlete } = profile;
  return (
    <>
      <header className="archive-header">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="eyebrow">ATHLETE ARCHIVE / 選手名鑑</p>
            <h1 className="archive-title" lang="ja">
              {athlete.name}
            </h1>
            <p className="archive-lead">
              三大驿传个人档案 · 参赛记录按赛事整理
            </p>
          </div>
          <Link
            className="archive-link mt-2 text-sm font-semibold"
            href={queryHref("/results", { athlete: athlete.id })}
          >
            高级检索 ↗
          </Link>
        </div>
        <dl className="metric-grid mt-7">
          <div className="metric">
            <dt>已收录出场</dt>
            <dd>
              {profile.starts}
              <span className="ml-2 text-sm font-normal">次</span>
            </dd>
          </div>
          <div className="metric">
            <dt>参赛赛季</dt>
            <dd>
              {profile.seasons.length}
              <span className="ml-2 text-sm font-normal">个</span>
            </dd>
          </div>
          <div className="metric">
            <dt>收录赛季范围</dt>
            <dd className="!text-xl">{yearRange(profile.seasons)}</dd>
          </div>
        </dl>
      </header>
      <section className="archive-section" aria-labelledby="athlete-facts">
        <h2 id="athlete-facts" className="section-heading">
          基本档案{" "}
          <span className="text-xs font-normal tracking-wider text-[var(--muted)]">
            PROFILE
          </span>
        </h2>
        {profile.needsReview && (
          <p role="status" className="source-note mb-5">
            此档案存在待核验的身份或姓名信息，尚未与候选历史档案合并。
          </p>
        )}
        <dl className="profile-facts">
          <div>
            <dt>日文姓名</dt>
            <dd lang="ja">{athlete.name}</dd>
          </div>
          <div>
            <dt>出生日期</dt>
            <dd>{athlete.birthDate ?? "尚未收录"}</dd>
          </div>
          <div>
            <dt>出身高中</dt>
            <dd>尚未收录</dd>
          </div>
          <div>
            <dt>当前所属大学</dt>
            <dd>尚未收录</dd>
          </div>
          <div className="profile-facts-wide">
            <dt>当前实业团 / 毕业后队伍</dt>
            <dd>尚未收录</dd>
          </div>
          <div className="profile-facts-wide">
            <dt>大学经历 · 已收录参赛关系</dt>
            <dd>
              {profile.universities.length ? (
                <ul className="space-y-2">
                  {profile.universities.map(({ university, years }) => (
                    <li
                      key={university.id}
                      className="flex flex-wrap items-baseline gap-x-4 gap-y-1"
                    >
                      <Link
                        className="archive-link"
                        href={`/universities/${university.id}`}
                        lang="ja"
                      >
                        {university.name}
                      </Link>
                      <span className="text-sm font-normal text-[var(--muted)]">
                        {yearRange(years)} 年有参赛记录
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                "尚未收录"
              )}
            </dd>
          </div>
        </dl>
        <p className="mt-5 text-xs leading-6 text-[var(--muted)]">
          大学经历依据当届代表关系整理，年份为已收录出场年份，不代表完整在学期间或当前所属。
        </p>
      </section>
      <section className="archive-section" aria-labelledby="athlete-pb">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="athlete-pb" className="section-heading !mb-0">
            个人最佳{" "}
            <span className="text-xs font-normal tracking-wider text-[var(--muted)]">
              PERSONAL BEST
            </span>
          </h2>
          <p className="text-xs text-[var(--muted)]">
            独立项目成绩 · 不以驿传区间用时推算
          </p>
        </div>
        <div className="grid grid-cols-3 divide-x divide-[var(--line)] border-y border-[var(--line)]">
          {["5000m", "10000m", "半程马拉松"].map((event) => (
            <div key={event} className="px-3 py-5 sm:px-5 first:pl-0">
              <h3 className="text-sm font-semibold">{event}</h3>
              <p
                className="mt-2 font-mono text-3xl tabular-nums"
                aria-label={`${event} 成绩尚未收录`}
              >
                —
              </p>
              <p className="mt-2 text-xs text-[var(--muted)]">尚未收录</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-[var(--muted)]">
          后续补录将同时列出创造日期、赛事与成绩来源。
        </p>
      </section>
      <section className="archive-section" aria-labelledby="athlete-history">
        <h2 id="athlete-history" className="section-heading">
          三大驿传战绩{" "}
          <span className="text-xs font-normal tracking-wider text-[var(--muted)]">
            RACE HISTORY
          </span>
        </h2>
        <div className="space-y-8">
          {profile.groups.map(({ race, rows }) => (
            <section key={race.id} aria-labelledby={`history-${race.id}`}>
              <div className="mb-3 flex items-baseline justify-between gap-4 border-l-2 border-[var(--brand)] pl-3">
                <h3 id={`history-${race.id}`} className="text-lg font-bold">
                  <Link
                    className="archive-link"
                    href={`/races/${race.id}`}
                    lang="ja"
                  >
                    {race.name}
                  </Link>
                </h3>
                <span className="shrink-0 text-xs text-[var(--muted)]">
                  {rows.length} 次出场
                </span>
              </div>
              {!rows.length ? (
                <p role="status" className="empty-state">
                  暂无已收录的参赛记录。
                </p>
              ) : (
                <div className="table-scroll">
                  <table className="archive-table w-full">
                    <caption className="sr-only">
                      {athlete.name} · {race.name}参赛记录
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">届次</th>
                        <th scope="col">年份</th>
                        <th scope="col">区间</th>
                        <th scope="col" className="text-right">
                          距离
                        </th>
                        {profile.showTeams && <th scope="col">当届代表队伍</th>}
                        <th scope="col" className="text-right">
                          区间顺位
                        </th>
                        <th scope="col" className="text-right">
                          区间成绩
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id} data-result-id={row.id}>
                          <td>
                            <Link
                              className="archive-link whitespace-nowrap"
                              href={`/editions/${row.edition.id}`}
                            >
                              第 {row.edition.number} 回
                            </Link>
                          </td>
                          <td className="font-mono tabular-nums">
                            {row.edition.year}
                          </td>
                          <td>
                            <Link
                              className="archive-link whitespace-nowrap"
                              href={queryHref(`/editions/${row.edition.id}`, {
                                section: String(row.section.number),
                              })}
                            >
                              {row.section.number}区
                            </Link>
                          </td>
                          <td className="text-right font-mono tabular-nums whitespace-nowrap">
                            {row.section.distanceKm === null
                              ? "—"
                              : `${row.section.distanceKm} km`}
                          </td>
                          {profile.showTeams && (
                            <td>
                              <Link
                                className="archive-link whitespace-nowrap"
                                href={
                                  row.entry.universityId
                                    ? `/universities/${row.entry.universityId}`
                                    : `/teams/${row.team.id}`
                                }
                                lang="ja"
                              >
                                {row.team.name}
                              </Link>
                              {row.team.kind !== "university" && (
                                <span className="ml-2 text-xs text-[var(--muted)]">
                                  选拔队
                                </span>
                              )}
                            </td>
                          )}
                          <td className="text-right font-mono tabular-nums">
                            {row.rank ?? "—"}
                          </td>
                          <td className="text-right">
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <span className="font-mono font-semibold tabular-nums">
                                {formatTime(row.timeSeconds)}
                              </span>
                              <ResultBadges resultId={row.id} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>
      </section>
      <ProfileSources sources={profile.sources} />
    </>
  );
}
