import Link from "next/link";
import { Empty, Heading } from "../../../components/database";
import { getRepository } from "../../../lib/repository";
export default async function Page() {
  const db = await getRepository().catalog();
  return (
    <>
      <Heading
        eyebrow="UNIVERSITY DIRECTORY"
        description="沿着大学历届参赛记录，查阅综合表现与历史选手。统计仅覆盖本站已收录赛事。"
      >
        大学档案
      </Heading>
      <section className="archive-section">
        <h2 className="section-heading">
          大学索引 <small>{db.universities.length} UNIVERSITY ARCHIVES</small>
        </h2>
        <div className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
          {db.universities.map((u) => {
            const entries = db.entries.filter((e) => e.universityId === u.id);
            return (
              <Link
                key={u.id}
                href={`/universities/${u.id}`}
                className="flex items-center justify-between gap-3 border-b border-[var(--line)] py-5"
              >
                <div>
                  <h3 className="text-sm font-bold">{u.name}</h3>
                  <p className="mt-2 text-[11px] text-[var(--muted)]">
                    {entries.length
                      ? `${entries.length} 届大学队参赛记录`
                      : "已收录选拔队选手所属大学"}
                  </p>
                </div>
                <span
                  className="text-xs text-[var(--muted)]"
                  aria-hidden="true"
                >
                  ↗
                </span>
              </Link>
            );
          })}
        </div>
        {!db.universities.length && <Empty />}
      </section>
    </>
  );
}
