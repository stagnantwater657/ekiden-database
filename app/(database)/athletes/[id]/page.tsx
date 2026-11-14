import { notFound } from "next/navigation";
import { AthleteProfile } from "../../../../components/athlete-profile";
import { athleteArchive } from "../../../../lib/profiles";
import { getRepository } from "../../../../lib/repository";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = athleteArchive(await getRepository().catalog(), id);
  if (!profile) notFound();
  return <AthleteProfile profile={profile} />;
}
