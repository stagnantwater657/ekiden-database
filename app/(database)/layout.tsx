import Link from "next/link";
export default function DatabaseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="border-b border-stone-200">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-6 py-6">
          <Link href="/" className="text-lg font-black">
            EKIDEN<span className="text-red-800"> / </span>DATABASE
          </Link>
          <nav aria-label="主导航" className="flex gap-6 text-sm">
            <Link href="/races">赛事</Link>
            <Link href="/results">区间成绩</Link>
            <Link href="/athletes">选手</Link>
            <Link href="/universities">大学</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 pb-20">{children}</main>
      <footer className="border-t border-stone-200 p-6 text-center text-xs text-stone-500">
        EKIDEN DATABASE · 每一程，都值得记录。
      </footer>
    </>
  );
}
