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
  const team = db.teams.find((t) => t.id === id);
  if (!team) notFound();
  return (
    <>
      <Heading
        eyebrow="TEAM RECORD"
        description={
          team.kind === "university"
            ? "正式大学队参赛记录"
            : "选拔队参赛记录；参考成绩不参与正式大学综合排名。"
        }
      >
        {team.name}
      </Heading>
      <Results
        path={`/teams/${id}`}
        params={await searchParams}
        scope={{ team: id }}
      />
    </>
  );
}
