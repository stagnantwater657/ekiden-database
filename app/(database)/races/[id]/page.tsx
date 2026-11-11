import { notFound } from "next/navigation";
import { Card, Empty, Heading } from "../../../../components/database";
import { getRepository } from "../../../../lib/repository";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = await getRepository().catalog();
  const race = db.races.find((r) => r.id === id);
  if (!race) notFound();
  const editions = db.editions.filter((e) => e.raceId === id);
  return (
    <>
      <Heading eyebrow="EDITIONS">{race.name}</Heading>
      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        {editions.map((e) => (
          <Card key={e.id} href={`/editions/${e.id}`}>
            <h2 className="text-2xl font-bold">
              {e.year} · 第 {e.number} 届
            </h2>
            <p className="mt-3">{e.date}</p>
          </Card>
        ))}
      </div>
      {!editions.length && <Empty />}
    </>
  );
}
