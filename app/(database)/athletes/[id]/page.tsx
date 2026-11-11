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
  const athlete = db.athletes.find((a) => a.id === id);
  if (!athlete) notFound();
  return (
    <>
      <Heading
        eyebrow="ATHLETE RECORD"
        description={`出生日期：${athlete.birthDate ?? "—"} · PB：—。下表大学为参赛当届代表大学。`}
      >
        {athlete.name}
      </Heading>
      <Results
        path={`/athletes/${id}`}
        params={await searchParams}
        scope={{ athlete: id }}
      />
    </>
  );
}
