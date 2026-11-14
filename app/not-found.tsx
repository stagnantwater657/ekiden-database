import Link from "next/link";
export default function NotFound() {
  return (
    <main className="site-width py-12">
      <h1 className="text-2xl font-bold">暂无此档案</h1>
      <p className="my-5">该记录尚未收录，或链接已失效。</p>
      <Link className="archive-link" href="/results">
        返回区间成绩查询
      </Link>
    </main>
  );
}
