import Link from "next/link";
import { Heading } from "../../../components/database";
import {
  raceMetadata,
  raceOrder,
  getRaceProfile,
} from "../../../lib/race-profile";
import { getRepository } from "../../../lib/repository";
export default async function Page() {
  const db = await getRepository().catalog();
  return (
    <>
      <Heading
        eyebrow="RACE DIRECTORY / THE BIG THREE"
        description="按赛事查阅路线、已收录优胜校与历届比赛。每一届保留独立的官方成绩与来源。"
      >
        三大驿传年鉴
      </Heading>
      <div className="archive-section grid gap-5 md:grid-cols-3">
        {raceOrder.map((id, index) => {
          const profile = getRaceProfile(db, id);
          if (!profile) return null;
          return (
            <Link href={`/races/${id}`} key={id} className="home-race">
              <p className="eyebrow">RACE FILE / 0{index + 1}</p>
              <h2 className="mt-6 text-2xl font-black">
                {raceMetadata.find((r) => r.raceId === id)?.nameZh ??
                  profile.race.name}
              </h2>
              <p className="mt-3" lang="ja">
                {profile.race.name}
              </p>
              <div className="mt-6 border-t border-[var(--line)] pt-4">
                <p>
                  {profile.sections.length} 区间 ·{" "}
                  {profile.latest?.distanceKm ?? "—"} km
                </p>
                <p>已收录 {profile.editions.length} 届赛事</p>
              </div>
              <span className="mt-6 block text-xs font-bold">
                进入赛事档案 ↗
              </span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
