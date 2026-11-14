import Link from "next/link";
import type { UniversityArchive } from "../lib/profiles";
import { yearRange } from "../lib/profiles";
import { formatTime, queryHref } from "../lib/query";
import { ProfileSources } from "./athlete-profile";
import { Empty } from "./database";
export function UniversityProfile({ profile }: { profile: UniversityArchive }) {
  const { university, performances } = profile;
  return (
    <>
      <header className="archive-header">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="eyebrow">UNIVERSITY ARCHIVE / 大学名鑑</p>
            <h1 className="archive-title" lang="ja">
              {university.name}
            </h1>
            <p className="archive-lead">
              大学队历届表现与历史选手 · 仅统计本站已收录赛事
            </p>
          </div>
          <Link
            className="archive-link mt-2 text-sm"
            href={queryHref("/results", { university: university.id })}
          >
            高级检索 ↗
          </Link>
        </div>
        <dl className="metric-grid mt-7">
          <div className="metric">
            <dt>大学队参赛</dt>
            <dd>
              {performances.length}
              <span className="ml-2 text-sm font-normal">届</span>
            </dd>
          </div>
          <div className="metric">
            <dt>历史选手</dt>
            <dd>
              {profile.athletes.length}
              <span className="ml-2 text-sm font-normal">人</span>
            </dd>
          </div>
          <div className="metric">
            <dt>代表大学出场</dt>
            <dd>
              {profile.starts - profile.selectionStarts}
              <span className="ml-2 text-sm font-normal">次</span>
            </dd>
          </div>
        </dl>
      </header>
      <section
        className="archive-section"
        aria-labelledby="university-overview"
      >
        <h2 id="university-overview" className="section-heading">
          三大驿传概况 <small>COLLEGIATE RECORD</small>
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            ["hakone", "箱根驿传"],
            ["all-japan", "全日本大学驿传"],
            ["izumo", "出云驿传"],
          ].map(([id, name]) => {
            const entries = performances.filter((p) => p.race.id === id);
            const ranked = entries.filter(
              (p) =>
                p.entry.status === "finished" &&
                p.entry.rankingEligibility !== "reference" &&
                p.entry.finalRank !== null,
            );
            return (
              <div
                className="border-t-2 border-[var(--ink)] bg-[var(--surface)] p-5"
                key={id}
              >
                <Link className="archive-link text-sm" href={`/races/${id}`}>
                  {name} ↗
                </Link>
                <p className="mt-4 text-2xl font-bold tabular-nums">
                  {entries.length}
                  <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                    届收录
                  </span>
                </p>
                <p className="source-note mt-3">
                  已收录最佳综合顺位：
                  {ranked.length
                    ? Math.min(...ranked.map((p) => p.entry.finalRank!))
                    : "—"}
                </p>
              </div>
            );
          })}
        </div>
      </section>
      <section className="archive-section" aria-labelledby="university-history">
        <h2 id="university-history" className="section-heading">
          历届综合表现 <small>EDITION HISTORY</small>
        </h2>
        {performances.length ? (
          <div className="table-scroll">
            <table className="archive-table">
              <thead>
                <tr>
                  <th>赛事 / 届次</th>
                  <th>年份</th>
                  <th>正式综合顺位</th>
                  <th>官方总成绩</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {performances.map(({ entry, edition, race }) => (
                  <tr key={entry.id}>
                    <td>
                      <Link
                        className="archive-link"
                        href={`/editions/${edition.id}?section=final`}
                      >
                        {race.name} · 第 {edition.number} 回
                      </Link>
                    </td>
                    <td className="numeric">{edition.year}</td>
                    <td className="numeric">
                      {entry.rankingEligibility !== "reference" &&
                      entry.status === "finished"
                        ? (entry.finalRank ?? "—")
                        : "—"}
                    </td>
                    <td className="time">
                      {formatTime(entry.totalTimeSeconds)}
                    </td>
                    <td className="text-[var(--muted)]">
                      {entry.status === "finished"
                        ? "完赛"
                        : entry.status === "disqualified"
                          ? "失格"
                          : entry.status === "did-not-finish"
                            ? "退赛"
                            : entry.status === "reference"
                              ? "参考成绩"
                              : entry.status === "did-not-start"
                                ? "未出场"
                                : "无排名 / 待核验"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>尚未收录该大学队的正式参赛记录。</Empty>
        )}
        <p className="source-note mt-3">
          选拔队选手的原属大学关系不计入该大学队的综合成绩。
        </p>
      </section>
      <section
        className="archive-section"
        aria-labelledby="university-athletes"
      >
        <h2 id="university-athletes" className="section-heading">
          历史参赛选手 <small>ATHLETE DIRECTORY</small>
        </h2>
        {profile.athletes.length ? (
          <div className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
            {profile.athletes.map(
              ({ athlete, years, starts, selectionStarts }) => (
                <Link
                  className="flex items-center justify-between gap-4 border-b border-[var(--line)] py-4"
                  href={`/athletes/${athlete.id}`}
                  key={athlete.id}
                >
                  <div>
                    <h3 className="text-sm font-bold" lang="ja">
                      {athlete.name}
                    </h3>
                    <p className="mt-2 text-[11px] text-[var(--muted)]">
                      {yearRange(years)} · {starts} 次出场
                      {selectionStarts > 0
                        ? ` · 含${selectionStarts}次选拔队`
                        : ""}
                    </p>
                  </div>
                  <span
                    className="text-xs text-[var(--muted)]"
                    aria-hidden="true"
                  >
                    ↗
                  </span>
                </Link>
              ),
            )}
          </div>
        ) : (
          <Empty>尚未收录可核验的历史选手。</Empty>
        )}
      </section>
      <ProfileSources sources={profile.sources} />
    </>
  );
}
