import Link from "next/link";
import { SiteFooter, SiteHeader } from "../components/site-shell";
import { getRepository } from "../lib/repository";
import { formatTime } from "../lib/query";
const raceLabels = [
  {
    id: "izumo",
    name: "出云",
    caption: "出雲全日本大学選抜駅伝競走",
    number: "01",
  },
  {
    id: "all-japan",
    name: "全日本",
    caption: "全日本大学駅伝対校選手権大会",
    number: "02",
  },
  {
    id: "hakone",
    name: "箱根",
    caption: "東京箱根間往復大学駅伝競走",
    number: "03",
  },
];
export default async function Home() {
  const db = await getRepository().catalog();
  const latest = [...db.editions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 4);
  return (
    <>
      <SiteHeader />
      <main className="site-width">
        <section className="home-hero">
          <div>
            <p className="eyebrow">THE JAPANESE COLLEGIATE EKIDEN ARCHIVE</p>
            <h1 className="home-title">
              每一程，<span>都有迹可循。</span>
            </h1>
            <p className="archive-lead">
              从出云到伊势路，再到箱根。
              <br />
              连接赛事、大学与选手的日本大学驿传年鉴。
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-6">
              <Link className="action-link" href="/results">
                检索历史成绩 <span>↗</span>
              </Link>
              <Link className="archive-link text-xs" href="/races">
                浏览三大驿传 →
              </Link>
            </div>
          </div>
          <aside className="home-stat-panel" aria-label="数据库收录范围">
            <p className="eyebrow">
              ARCHIVE / {Math.min(...db.editions.map((e) => e.year))} —{" "}
              {Math.max(...db.editions.map((e) => e.year))}
            </p>
            <dl>
              {[
                [db.editions.length, "届赛事"],
                [db.results.length.toLocaleString(), "条区间记录"],
                [db.athletes.length.toLocaleString(), "位选手"],
                [db.universities.length, "所大学"],
              ].map(([value, label]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs leading-6 text-[var(--line)]">
              历史成绩按届次保存，选手跨赛季关联。
              <br />
              每条记录均可追溯至对应资料来源。
            </p>
          </aside>
        </section>
        <section className="archive-section" aria-labelledby="races">
          <h2 id="races" className="section-heading">
            三大驿传 <small>THE BIG THREE</small>
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {raceLabels.map((r) => {
              const editions = db.editions
                .filter((e) => e.raceId === r.id)
                .sort((a, b) => b.date.localeCompare(a.date));
              const current = editions[0];
              return (
                <Link
                  key={r.id}
                  href={`/races/${r.id}`}
                  aria-label={`${r.name}赛事入口`}
                  className="home-race"
                >
                  <div className="flex justify-between">
                    <span className="eyebrow">RACE ARCHIVE / {r.number}</span>
                    <span className="text-xs text-[var(--muted)]">
                      {editions.length} 届收录
                    </span>
                  </div>
                  <h3>
                    {r.name}
                    <span className="ml-2 text-lg font-normal">駅伝</span>
                  </h3>
                  <p className="mt-2">{r.caption}</p>
                  <div className="mt-7 flex justify-between border-t border-[var(--line)] pt-4 text-xs">
                    <span>
                      {
                        db.sections.filter((s) => s.editionId === current?.id)
                          .length
                      }{" "}
                      区间 · {current?.distanceKm ?? "—"} km
                    </span>
                    <span>赛事档案 ↗</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
        <section className="archive-section" aria-labelledby="recent">
          <h2 id="recent" className="section-heading">
            最近收录的比赛 <small>EDITION INDEX</small>
          </h2>
          <div className="table-scroll">
            <table className="archive-table">
              <thead>
                <tr>
                  <th>比赛日期</th>
                  <th>赛事 / 届次</th>
                  <th>优胜大学</th>
                  <th>官方总成绩</th>
                  <th>
                    <span className="sr-only">入口</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {latest.map((e) => {
                  const winner = db.entries.find(
                    (entry) =>
                      entry.editionId === e.id &&
                      entry.finalRank === 1 &&
                      entry.status === "finished",
                  );
                  const university = db.universities.find(
                    (u) => u.id === winner?.universityId,
                  );
                  return (
                    <tr key={e.id}>
                      <td className="numeric text-[var(--muted)]">{e.date}</td>
                      <td>
                        <Link
                          className="archive-link"
                          href={`/editions/${e.id}`}
                        >
                          {db.races.find((r) => r.id === e.raceId)?.name} · 第{" "}
                          {e.number} 届
                        </Link>
                      </td>
                      <td>
                        {university ? (
                          <Link
                            className="archive-link"
                            href={`/universities/${university.id}`}
                          >
                            {university.name}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="time">
                        {formatTime(winner?.totalTimeSeconds ?? null)}
                      </td>
                      <td>
                        <Link
                          aria-label={`${e.year} 第${e.number}届成绩`}
                          href={`/editions/${e.id}`}
                        >
                          成绩 ↗
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <aside id="data-coverage" className="source-reference">
          <h2>从比赛记录，走进选手档案</h2>
          <p className="mt-2">
            已收录 {db.editions.length} 届赛事、{db.results.length}{" "}
            条区间参赛记录。资料不完整的字段保持空缺；赛道纪录及个人 PB
            仅在来源核实后补充。
          </p>
          <Link className="archive-link mt-3 inline-block" href="/results">
            按年份、赛季、大学和选手交叉检索 →
          </Link>
        </aside>
      </main>
      <SiteFooter />
    </>
  );
}
