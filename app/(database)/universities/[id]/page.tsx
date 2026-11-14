import { notFound } from "next/navigation";
import { UniversityProfile } from "../../../../components/university-profile";
import { universityArchive } from "../../../../lib/profiles";
import { getRepository } from "../../../../lib/repository";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = universityArchive(await getRepository().catalog(), id);
  if (!profile) notFound();
  return <UniversityProfile profile={profile} />;
}
