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
    <div className="border-b border-stone-300 py-10">
      <p className="text-xs font-bold tracking-[.2em] text-red-800">
        {eyebrow}
      </p>
      <h1 className="mt-4 text-3xl font-black sm:text-5xl">{children}</h1>
      {description && (
        <p className="mt-5 max-w-3xl leading-7 text-stone-600">{description}</p>
      )}
    </div>
  );
}
export function Empty({
  children = "暂无数据，待核验后收录。",
}: {
  children?: ReactNode;
}) {
  return (
    <p
      role="status"
      className="my-8 border border-dashed border-stone-300 p-8 text-stone-600"
    >
      {children}
    </p>
  );
}
export function Sources({ sources }: { sources: Source[] }) {
  return (
    <aside
      aria-label="数据范围与来源"
      className="mt-10 border-l-2 border-red-800 bg-stone-100 p-5 text-sm leading-7"
    >
      <h2 className="font-bold">数据范围与来源</h2>
      {!sources.length && <p>当前查询无成绩，暂无对应来源。</p>}
      {sources.map((source) => (
        <div key={source.id} className="mt-3">
          <a className="text-red-800 underline" href={source.url}>
            {source.title} ↗
          </a>
          <p>{source.coverage}</p>
          {source.revision && <p>采用版本：{source.revision}</p>}
          <p className="text-stone-500">
            {source.locator} · 采集时间：
            <time dateTime={source.collectedAt}>
              {source.collectedAt.slice(0, 19).replace("T", " ")} UTC
            </time>
          </p>
        </div>
      ))}
      <p>
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
    <Link
      className="block border border-stone-200 bg-white p-6 transition hover:border-red-800"
      href={href}
    >
      {children}
      <span className="mt-4 block text-sm text-red-800">查看档案 ↗</span>
    </Link>
  );
}
