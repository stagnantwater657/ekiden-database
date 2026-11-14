import Link from "next/link";
import type {
  EditionScoreboard as Scoreboard,
  FinalStanding,
} from "../lib/scoreboard";
import { formatGap } from "../lib/scoreboard";
import type { ResultStatus } from "../lib/model";
import { formatTime } from "../lib/query";
import { ResultBadges } from "./result-badges";
import { Empty, Sources } from "./database";
const statusLabels: Record<ResultStatus, string> = {
  finished: "完赛",
  reference: "参考成绩",
  unranked: "无排名",
  disqualified: "失格",
  "did-not-finish": "退赛",
  "did-not-start": "未出场",
  unknown: "待核验",
};
export function RankMovement({ value }: { value: number | null }) {
  if (value === null || value === 0)
    return (
      <span
        className="rank-movement rank-movement--same"
        aria-label={value === null ? "无可比较顺位" : "顺位不变"}
      >
        —
      </span>
    );
  return (
    <span
      className={`rank-movement rank-movement--${value > 0 ? "up" : "down"}`}
      aria-label={`${value > 0 ? "上升" : "下降"} ${Math.abs(value)} 位`}
    >
      {value > 0 ? "↑" : "↓"} {Math.abs(value)}
    </span>
  );
}
function TeamLink({ row }: { row: FinalStanding }) {
  return (
    <Link
      className="archive-link"
      href={
        row.university
          ? `/universities/${row.university.id}`
          : `/teams/${row.team.id}`
      }
    >
      {row.team.name}
    </Link>
  );
}
export function SectionSwitcher({
  board,
  final,
}: {
  board: Scoreboard;
  final: boolean;
}) {
  return (
    <nav className="section-switcher" aria-label="区间导航">
      {board.sections.map((section) => (
        <Link
          key={section.id}
          href={`/editions/${board.edition.id}?section=${section.number}`}
          aria-current={
            !final && board.section.id === section.id ? "page" : undefined
          }
        >
          {section.number}区
        </Link>
      ))}
      <Link
        href={`/editions/${board.edition.id}?section=final`}
        aria-current={final ? "page" : undefined}
      >
        最终综合
      </Link>
    </nav>
  );
}
function FinalResults({ board }: { board: Scoreboard }) {
  return (
    <>
      <div className="scoreboard-header">
        <h2>最终综合成绩</h2>
        <p>正式综合排名 · {board.finalRows.length} 支队伍</p>
      </div>
      {board.finalRows.length ? (
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="正式综合成绩表"
        >
          <table className="archive-table">
            <caption className="sr-only">
              最终正式综合排名、总成绩及与冠军差距
            </caption>
            <thead>
              <tr>
                <th>综合顺位</th>
                <th>大学 / 队伍</th>
                <th>官方总成绩</th>
                <th>与冠军差</th>
              </tr>
            </thead>
            <tbody>
              {board.finalRows.map((row) => (
                <tr key={row.entry.id} data-entry-id={row.entry.id}>
                  <td>
                    <span
                      className={`rank-value numeric ${row.entry.finalRank === 1 ? "rank-leading" : ""}`}
                    >
                      {row.entry.finalRank}
                    </span>
                  </td>
                  <td>
                    <TeamLink row={row} />
                  </td>
                  <td className="time">
                    {formatTime(row.entry.totalTimeSeconds)}
                  </td>
                  <td className="numeric">{formatGap(row.gapSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>暂无核验通过的正式综合排名。</Empty>
      )}
      {board.specialRows.length > 0 && (
        <section className="archive-section" aria-label="参考及特殊状态">
          <h3 className="section-heading text-base">
            参考成绩与特殊状态 <small>不计入正式综合排名</small>
          </h3>
          <div className="table-scroll">
            <table className="archive-table">
              <thead>
                <tr>
                  <th>队伍</th>
                  <th>官方总成绩</th>
                  <th>结果状态</th>
                </tr>
              </thead>
              <tbody>
                {board.specialRows.map((row) => (
                  <tr key={row.entry.id} data-entry-id={row.entry.id}>
                    <td>
                      <TeamLink row={row} />
                    </td>
                    <td className="time">
                      {formatTime(row.entry.totalTimeSeconds)}
                    </td>
                    <td>{statusLabels[row.entry.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {board.race.id === "hakone" && (
        <section className="archive-section">
          <h3 className="section-heading text-base">
            往路与复路 <small>官方分路用时</small>
          </h3>
          <div className="table-scroll">
            <table className="archive-table">
              <thead>
                <tr>
                  <th>大学 / 队伍</th>
                  <th>往路</th>
                  <th>复路</th>
                </tr>
              </thead>
              <tbody>
                {[...board.finalRows, ...board.specialRows].map((row) => (
                  <tr key={row.entry.id}>
                    <td>
                      <TeamLink row={row} />
                    </td>
                    <td className="numeric">
                      {formatTime(
                        row.entry.stages?.find(
                          (stage) => stage.kind === "outbound",
                        )?.timeSeconds ?? null,
                      )}
                    </td>
                    <td className="numeric">
                      {formatTime(
                        row.entry.stages?.find(
                          (stage) => stage.kind === "return",
                        )?.timeSeconds ?? null,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="source-note mt-3">
            采用已核验的官方往、复路用时；分路排名未收录，不由总排名替代。
          </p>
        </section>
      )}
    </>
  );
}
export function EditionScoreboard({
  board,
  final = false,
}: {
  board: Scoreboard;
  final?: boolean;
}) {
  const champion = board.finalRows.find((row) => row.entry.finalRank === 1);
  const isCalculated = board.cumulativeMode === "calculated";
  return (
    <>
      <header className="broadcast-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link className="eyebrow" href={`/races/${board.race.id}`}>
            RACE ARCHIVE / {board.race.name} ↗
          </Link>
          <span className="text-[10px] tracking-widest text-[var(--line)]">
            OFFICIAL RESULTS
          </span>
        </div>
        <h1 className="broadcast-title">
          {board.edition.year} {board.race.name}
          <span className="mt-2 block text-lg font-normal">
            第 {board.edition.number} 届
          </span>
        </h1>
        <p className="broadcast-meta">
          <time dateTime={board.edition.date}>{board.edition.date}</time>
          {board.edition.endDate && ` — ${board.edition.endDate}`}{" "}
          <span aria-hidden="true"> / </span> {board.edition.seasonYear} 赛季{" "}
          <span aria-hidden="true"> / </span> {board.sections.length} 区间 ·{" "}
          {board.edition.distanceKm} km <span aria-hidden="true"> / </span>{" "}
          {board.finalRows.length + board.specialRows.length} 支队伍
        </p>
        <div className="broadcast-champion">
          <div>
            <small>OVERALL WINNER / 优胜</small>
            {champion ? (
              <span className="text-2xl font-extrabold">
                <TeamLink row={champion} />
              </span>
            ) : (
              <span>尚待核验</span>
            )}
          </div>
          <div>
            <small>OFFICIAL TOTAL TIME</small>
            <span className="time">
              {formatTime(champion?.entry.totalTimeSeconds ?? null)}
            </span>
          </div>
        </div>
      </header>
      <SectionSwitcher board={board} final={final} />
      {final ? (
        <FinalResults board={board} />
      ) : (
        <>
          <div className="scoreboard-header">
            <h2>
              第 {board.section.number} 区{" "}
              <span className="ml-2 text-sm font-normal text-[var(--muted)]">
                {board.section.distanceKm ?? "—"} km
              </span>
            </h2>
            <p>{board.rows.length} 条区间记录 · 按官方区间顺位排列</p>
          </div>
          <div className="mb-4 flex flex-wrap justify-between gap-3">
            <p className="source-note">
              <span className="font-bold text-[var(--ink)]">
                {board.cumulativeLabel}
              </span>
              {isCalculated && " · 推算顺位，不代表官方通過順位"}
            </p>
            <Link
              className="archive-link text-xs"
              href={`/results?edition=${board.edition.id}&section=${board.section.number}`}
            >
              在高级检索中查看 ↗
            </Link>
          </div>
          {board.rows.length ? (
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="区间成绩表"
            >
              <table className="archive-table scoreboard-table">
                <caption className="sr-only">
                  第{board.section.number}区成绩，累计数据口径：
                  {board.cumulativeLabel}
                </caption>
                <thead>
                  <tr>
                    <th>区间顺位</th>
                    <th>大学 / 队伍</th>
                    <th>选手</th>
                    <th>区间成绩</th>
                    <th>{isCalculated ? "计算综合顺位" : "累计综合顺位"}</th>
                    <th>顺位变化</th>
                    <th>{isCalculated ? "计算累计用时" : "累计用时"}</th>
                    <th>与领先队差</th>
                  </tr>
                </thead>
                <tbody>
                  {board.rows.map((row) => (
                    <tr key={row.id} data-result-id={row.id}>
                      <td>
                        <span
                          className={`rank-value numeric ${row.rank === 1 ? "rank-leading" : ""}`}
                        >
                          {row.rank ?? "—"}
                        </span>
                      </td>
                      <td>
                        <Link
                          className="archive-link"
                          href={
                            row.university
                              ? `/universities/${row.university.id}`
                              : `/teams/${row.team.id}`
                          }
                        >
                          {row.team.name}
                        </Link>
                        {row.team.kind !== "university" && (
                          <span className="special-status">
                            {row.entry.rankingEligibility === "official"
                              ? "选拔队 · 正式排名资格"
                              : "选拔队 · 参考成绩"}
                          </span>
                        )}
                      </td>
                      <td>
                        <Link
                          className="archive-link"
                          href={`/athletes/${row.athlete.id}`}
                        >
                          {row.athlete.name}
                        </Link>
                        {row.grade && (
                          <span className="ml-2 text-[10px] text-[var(--muted)]">
                            {row.grade}年
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="time">
                          {formatTime(row.timeSeconds)}
                        </span>
                        <ResultBadges resultId={row.id} />
                        {row.status && row.status !== "finished" && (
                          <span className="special-status">
                            {statusLabels[row.status]}
                          </span>
                        )}
                      </td>
                      <td className="numeric">{row.cumulative.rank ?? "—"}</td>
                      <td>
                        <RankMovement value={row.cumulative.movement} />
                      </td>
                      <td
                        className="numeric"
                        title={row.cumulative.locator ?? undefined}
                      >
                        {formatTime(row.cumulative.timeSeconds)}
                      </td>
                      <td className="numeric">
                        {formatGap(row.cumulative.gapSeconds)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>暂无本区间成绩。</Empty>
          )}
          <div className="source-note mt-4 space-y-2">
            {board.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        </>
      )}
      <details className="source-reference">
        <summary>核查数据来源与覆盖范围（{board.sources.length}）</summary>
        <Sources sources={board.sources} />
      </details>
    </>
  );
}
