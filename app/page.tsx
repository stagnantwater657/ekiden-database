import Link from "next/link";
const navigation = [
  { name: "选手", href: "/athletes" },
  { name: "大学", href: "/universities" },
  { name: "赛事", href: "/races" },
  { name: "区间成绩", href: "/results" },
];
const races = [
  {
    name: "出云",
    japanese: "出雲駅伝",
    number: "01",
    distance: "6 区间 · 45.1 km",
    caption: "秋日赛季，从出云启程。",
    color: "bg-emerald-800",
  },
  {
    name: "全日本",
    japanese: "全日本大学駅伝",
    number: "02",
    distance: "8 区间 · 106.8 km",
    caption: "伊势路上，争夺日本第一。",
    color: "bg-amber-800",
  },
  {
    name: "箱根",
    japanese: "箱根駅伝",
    number: "03",
    distance: "10 区间 · 往返赛道",
    caption: "新年的山路，百年的接力。",
    color: "bg-red-900",
  },
];
export default function Home() {
  return (
    <>
      <header className="border-b border-stone-200">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-6 py-6">
          <Link href="/" className="text-lg font-black tracking-tight">
            EKIDEN<span className="text-red-800"> / </span>DATABASE
          </Link>
          <nav
            aria-label="主导航"
            className="flex flex-wrap gap-6 text-sm text-stone-600"
          >
            {navigation.map((item) => (
              <a
                key={item.name}
                href={item.href}
                className="hover:text-red-800 focus-visible:outline-2 focus-visible:outline-red-800"
              >
                {item.name}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 pb-20">
        <section className="relative overflow-hidden border-b border-stone-300 py-20 sm:py-28">
          <p className="mb-7 text-xs font-bold tracking-[.24em] text-red-800">
            THE RECORD OF EVERY RELAY
          </p>
          <h1 className="max-w-3xl text-5xl leading-tight font-black tracking-tight sm:text-7xl">
            Ekiden Database
          </h1>
          <p className="mt-5 text-xl text-stone-600 sm:text-2xl">
            日本大学驿传数据库
          </p>
          <p className="mt-8 max-w-lg leading-8 text-stone-500">
            一条襷，连接每个人的奔跑。
            <br />
            从出云到箱根，记录大学驿传的每一程。
          </p>
          <div
            aria-hidden="true"
            className="absolute -right-20 bottom-10 -z-10 h-60 w-60 rotate-[-25deg] border-[32px] border-red-900/5 sm:h-80 sm:w-80"
          />
        </section>
        <section aria-labelledby="races" className="pt-12">
          <div className="mb-8 flex items-end justify-between">
            <h2 id="races" className="text-2xl font-bold">
              三大驿传
            </h2>
            <span className="text-xs tracking-widest text-stone-500">
              THE BIG THREE
            </span>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {races.map((race) => (
              <a
                href={
                  race.name === "全日本" ? "/races/all-japan" : "#coming-soon"
                }
                key={race.name}
                aria-label={`${race.name}赛事入口${race.name === "全日本" ? "" : "（筹备中）"}`}
                className="group overflow-hidden border border-stone-200 bg-white transition hover:-translate-y-1 hover:shadow-md"
              >
                <div
                  className={`${race.color} flex h-44 items-end justify-between p-6 text-white`}
                >
                  <span className="text-5xl font-black">{race.name}</span>
                  <span className="text-sm opacity-60">{race.number} /</span>
                </div>
                <div className="p-6">
                  <p className="text-xs tracking-wider text-stone-500">
                    {race.japanese} · {race.distance}
                  </p>
                  <p className="mt-4 text-stone-700">{race.caption}</p>
                  <p className="mt-8 text-sm font-semibold">
                    赛事档案 <span aria-hidden="true">↗</span>
                    <span className="float-right font-normal text-stone-400">
                      {race.name === "全日本" ? "2024 已收录" : "筹备中"}
                    </span>
                  </p>
                </div>
              </a>
            ))}
          </div>
        </section>
        <aside
          id="coming-soon"
          className="mt-12 border-l-2 border-red-800 bg-stone-100 p-6 scroll-mt-8"
        >
          <h2 className="font-semibold">从一场比赛，连接每一位选手</h2>
          <p className="mt-2 text-sm leading-7 text-stone-600">
            已接入 2024 年全日本大学驿传 25 所大学的 200
            条区间成绩。出云、箱根数据尚待收录。
            <Link href="/results" className="ml-2 text-red-800 underline">
              开始交叉检索 ↗
            </Link>
          </p>
        </aside>
      </main>
      <footer className="border-t border-stone-200 px-6 py-7 text-center text-xs tracking-wider text-stone-500">
        EKIDEN DATABASE · 每一程，都值得记录。
      </footer>
    </>
  );
}
