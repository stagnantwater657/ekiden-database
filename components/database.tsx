import Link from "next/link";
import type { ReactNode } from "react";
import type { Source } from "../lib/model";
export function Heading({
  eyebrow,
  children,
  description,
}: {
  eyebrow: string;
  children: ReactNode;
  description?: string;
}) {
  return (
    <header className="archive-header">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="archive-title">{children}</h1>
      {description && <p className="archive-lead">{description}</p>}
    </header>
  );
}
export function Empty({
  children = "暂无数据，待核验后收录。",
}: {
  children?: ReactNode;
}) {
  return (
    <p role="status" className="empty-state">
      {children}
    </p>
  );
}
export function Sources({ sources }: { sources: Source[] }) {
  return (
    <aside aria-label="数据范围与来源" className="source-reference">
      <h2>数据范围与来源</h2>
      {!sources.length && <p>当前查询无成绩，暂无对应来源。</p>}
      {sources.map((source) => (
        <div key={source.id} className="mt-4">
          <a className="archive-link" href={source.url}>
            {source.title} ↗
          </a>
          <p>{source.coverage}</p>
          {source.revision && <p>采用版本：{source.revision}</p>}
          <p>
            {source.locator} · 采集时间：
            <time dateTime={source.collectedAt}>
              {source.collectedAt.slice(0, 19).replace("T", " ")} UTC
            </time>
          </p>
        </div>
      ))}
      <p className="mt-4">
        “—”表示尚未核实；未收录 PB，不以区间成绩推算
        PB。大学名称沿用官方成绩表。
      </p>
    </aside>
  );
}
export function Card({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link className="archive-card" href={href}>
      {children}
      <span>查看档案 ↗</span>
    </Link>
  );
}
