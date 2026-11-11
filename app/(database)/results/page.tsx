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
        eyebrow="CROSS SEARCH"
        description="按赛事、年份、大学、区间与姓名交叉检索。筛选、排序及分页均保存在网址中，可直接分享。"
      >
        区间成绩
      </Heading>
      <Results params={await searchParams} />
    </>
  );
}
