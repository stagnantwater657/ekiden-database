import { Heading } from "../../../components/database";
import { Results } from "../../../components/results";
import type { QueryParams } from "../../../lib/query";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<QueryParams>;
}) {
  return (
    <>
      <Heading
        eyebrow="ATHLETE INDEX"
        description="输入姓名，或按代表大学及赛事查找选手；点击姓名进入个人档案。"
      >
        选手检索
      </Heading>
      <Results path="/athletes" params={await searchParams} />
    </>
  );
}
