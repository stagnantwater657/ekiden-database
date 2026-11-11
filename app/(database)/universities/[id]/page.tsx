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
  const university = db.universities.find((u) => u.id === id);
  if (!university) notFound();
  return (
    <>
      <Heading
        eyebrow="UNIVERSITY RECORD"
        description="按届次及区间查询该校参赛记录，点击选手查看个人记录。"
      >
        {university.name}
      </Heading>
      <Results
        path={`/universities/${id}`}
        params={await searchParams}
        scope={{ university: id }}
      />
    </>
  );
}
