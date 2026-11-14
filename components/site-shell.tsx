import Link from "next/link";
export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-width site-header-inner">
        <Link href="/" className="wordmark" aria-label="Ekiden Database 首页">
          <span className="wordmark-icon" aria-hidden="true">
            駅
          </span>
          <span>
            <span className="wordmark-title">EKIDEN DATABASE</span>
            <span className="wordmark-caption">日本大学驿传 · 资料档案</span>
          </span>
        </Link>
        <nav aria-label="主导航" className="site-nav">
          <Link href="/races">赛事年鉴</Link>
          <Link href="/athletes">选手档案</Link>
          <Link href="/universities">大学档案</Link>
          <Link href="/results">高级检索 ↗</Link>
        </nav>
      </div>
    </header>
  );
}
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-width flex flex-wrap justify-between gap-3">
        <p className="font-bold tracking-wider">EKIDEN DATABASE</p>
        <p>日本大学驿传资料库 · 以可核验的记录，连接每一程。</p>
        <Link href="/results">数据查询与来源 ↗</Link>
      </div>
    </footer>
  );
}
