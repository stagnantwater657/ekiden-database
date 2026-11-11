import Link from "next/link";
import { notFound } from "next/navigation";
import { Heading } from "../../../../components/database";
import { Results } from "../../../../components/results";
import { getRepository } from "../../../../lib/repository";
import type { QueryParams } from "../../../../lib/query";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<QueryParams>;
}) {
  const { id } = await params;
  const db = await getRepository().catalog();
  const edition = db.editions.find((e) => e.id === id);
  if (!edition) notFound();
  const race = db.races.find((r) => r.id === edition.raceId)!;
  return (
    <>
      <Heading
        eyebrow="EDITION RESULTS"
        description={`${edition.date} · 已收录 ${db.entries.filter((e) => e.editionId === id).length} 所大学。点击区间可比较同区间选手。`}
      >
        {edition.year} {race.name} · 第 {edition.number} 届
      </Heading>
      <Link
        className="mt-5 inline-block text-red-800 underline"
        href={`/races/${race.id}`}
      >
        查看该赛事各届次 ↗
      </Link>
      <Results
        path={`/editions/${id}`}
        params={await searchParams}
        scope={{ edition: id, race: race.id, year: String(edition.year) }}
      />
    </>
  );
}
