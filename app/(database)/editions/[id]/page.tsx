import { notFound } from "next/navigation";
import { EditionScoreboard } from "../../../../components/edition-scoreboard";
import { getRepository } from "../../../../lib/repository";
import { buildEditionScoreboard } from "../../../../lib/scoreboard";
import type { QueryParams } from "../../../../lib/query";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<QueryParams>;
}) {
  const [{ id }, query, db] = await Promise.all([
    params,
    searchParams,
    getRepository().catalog(),
  ]);
  const selection = Array.isArray(query.section)
    ? query.section[0]
    : query.section;
  const board = buildEditionScoreboard(db, id, Number(selection) || 1);
  if (!board) notFound();
  return <EditionScoreboard board={board} final={selection === "final"} />;
}
