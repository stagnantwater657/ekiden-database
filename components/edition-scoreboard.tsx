import { parseScoreboardSort, scoreboardHref, sortScoreboardRows, type ScoreboardSort } from "../lib/scoreboard-sort";
import type { QueryParams } from "../lib/query";
import { getResultHonors } from "../lib/scoreboard";
import Link from "next/link";
import type {
  EditionScoreboard as Scoreboard,
  FinalStanding,
} from "../lib/scoreboard";
import { formatGap } from "../lib/scoreboard";
import type { ResultStatus } from "../lib/model";
import { formatTime } from "../lib/query";
import type { PriorSectionRecord } from "../lib/prior-records";
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
/**
 * The record in force when the edition started. A record set during the race is
 * never shown here; it stays a 区間新 badge on the results table below.
 */
function PriorRecord({ record }: { record: PriorSectionRecord | null }) {
  if (!record || record.status !== "verified") {
    return (
      <>
        <p className="source-note">赛前纪录尚待核验</p>
        <p className="source-note">
          {record?.note ?? "暂无本届对应路线的已核验赛前纪录资料。"}
        </p>
      </>
    );
  }
  const provenance = [record.locator, record.revision]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <p className="source-note">本届开赛前有效</p>
      {record.holders.map((holder, index) => (
        <p key={`${record.id}-holder-${index}`}>
          <span className="time" title={provenance || undefined}>
            {formatTime(record.timeSeconds)}
          </span>
          {" · "}
          {holder.athleteId ? (
            <Link className="archive-link" href={`/athletes/${holder.athleteId}`}>
              {holder.holderName}
            </Link>
          ) : (
            holder.holderName
          )}
          {" · "}
          {holder.universityId ? (
            <Link
              className="archive-link"
              href={`/universities/${holder.universityId}`}
            >
              {holder.universityName}
            </Link>
          ) : (
            holder.universityName
          )}
          {" · "}
          {holder.editionId ? (
            <Link className="archive-link" href={`/editions/${holder.editionId}`}>
              {holder.year} 第{holder.editionNumber}回
            </Link>
          ) : (
            `${holder.year} 第${holder.editionNumber}回`
          )}
        </p>
      ))}
      {record.holders.length > 1 && (
        <p className="source-note">共同纪录保持者，按同一记录成绩并列</p>
      )}
      {record.note && <p className="source-note">{record.note}</p>}
    </>
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
  query = {},
}: {
  board: Scoreboard;
  query?: QueryParams;
  final: boolean;
}) {
  return (
    <nav className="section-switcher" aria-label="区间导航">
      {board.sections.map((section) => (
        <Link
          key={section.id}
          href={scoreboardHref(board.edition.id, query, {section: String(section.number)})}
          aria-current={
            !final && board.section.id === section.id ? "page" : undefined
          }
        >
          {section.number}区
        </Link>
      ))}
      <Link
        href={scoreboardHref(board.edition.id, query, {section: "final"})}
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
  query = {},
}: {
  board: Scoreboard;
  final?: boolean;
  query?: QueryParams;
}) {
  const order = parseScoreboardSort(query);
  const rows = sortScoreboardRows(board.rows, order);
  const winners = board.rows.filter((row) => getResultHonors(row.id)?.sectionAward);
  const sortHeader = (key: ScoreboardSort["sort"], label: string) => (
    <th scope="col" aria-sort={order.sort === key ? (order.direction === "asc" ? "ascending" : "descending") : "none"}>
      <Link className="score-sort" href={scoreboardHref(board.edition.id, query, {section:String(board.section.number), sort:key, direction:order.sort === key && order.direction === "asc" ? "desc" : "asc"})}>
        {label}<span aria-hidden="true" className="sort-arrow">{order.sort === key ? (order.direction === "asc" ? "↑" : "↓") : "↕"}</span>
        <span className="sr-only">，切换为{order.sort === key && order.direction === "asc" ? "降序" : "升序"}</span>
      </Link>
    </th>
  );
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
      <SectionSwitcher board={board} final={final} query={query} />
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
            <p>{board.rows.length} 条区间记录 · 按{order.sort === "rank" ? "区间顺位" : order.sort === "cumulative" ? "累计用时" : "顺位变化"}{order.direction === "asc" ? "升序" : "降序"}排列</p>
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
          <section className="section-overview" aria-label="本区间成绩概览">
            <div>
              <h3>区间赏</h3>
              {winners.length ? winners.map((row) => (
                <p key={row.id}>
                  <Link className="archive-link" href={`/athletes/${row.athlete.id}`}>{row.athlete.name}</Link>
                  {" · "}<TeamLink row={{entry:row.entry,team:row.team,university:row.university,gapSeconds:null}} />
                  {" · "}<span className="time">{formatTime(row.timeSeconds)}</span>
                  <ResultBadges resultId={row.id} />
                </p>
              )) : <p className="source-note">区间赏尚待核验</p>}
            </div>
            <div>
              <h3>区间纪录</h3>
              <PriorRecord record={board.priorRecord} />
            </div>
          </section>
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
                    {sortHeader("rank", "区间顺位")}
                    <th>大学 / 队伍</th>
                    <th>选手</th>
                    <th>区间成绩</th>
                    <th>{isCalculated ? "计算综合顺位" : "综合顺位"}</th>
                    {sortHeader("movement", "顺位变化")}
                    {sortHeader("cumulative", isCalculated ? "计算累计用时" : "累计用时")}
                    <th>与领先队差</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
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
