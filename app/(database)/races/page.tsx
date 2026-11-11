import { Card, Empty, Heading } from "../../../components/database";
import { getRepository } from "../../../lib/repository";
export default async function Page() {
  const db = await getRepository().catalog();
  return (
    <>
      <Heading eyebrow="RACE ARCHIVE">赛事档案</Heading>
      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        {db.races.map((race) => (
          <Card key={race.id} href={`/races/${race.id}`}>
            <h2 className="text-2xl font-bold">{race.name}</h2>
            <p className="mt-3 text-stone-500">
              已收录 {db.editions.filter((e) => e.raceId === race.id).length} 届
            </p>
          </Card>
        ))}
      </div>
      {!db.races.length && <Empty />}
    </>
  );
}
