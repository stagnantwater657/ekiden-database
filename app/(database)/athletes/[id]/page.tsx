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
        description={`出生日期：${athlete.birthDate ?? "—"} · PB：—。下表为参赛当届代表队伍，历史记录不受当前在校状态影响。`}
      >
        {athlete.name}
      </Heading>
      {db.identities.some(
        (i) => i.athleteId === id && i.status === "needs-review",
      ) && (
        <p className="mt-4 text-sm text-stone-600">
          此档案存在待核验身份或姓名信息，尚未与候选历史档案合并。
        </p>
      )}
      <Results
        path={`/athletes/${id}`}
        params={await searchParams}
        scope={{ athlete: id }}
      />
    </>
  );
}
