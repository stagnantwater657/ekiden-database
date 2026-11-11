import { Card, Empty, Heading } from "../../../components/database";
import { getRepository } from "../../../lib/repository";
export default async function Page() {
  const db = await getRepository().catalog();
  return (
    <>
      <Heading eyebrow="UNIVERSITY INDEX">大学档案</Heading>
      <div className="mt-8 grid gap-5 sm:grid-cols-3">
        {db.universities.map((u) => (
          <Card key={u.id} href={`/universities/${u.id}`}>
            <h2 className="text-xl font-bold">{u.name}</h2>
          </Card>
        ))}
      </div>
      {!db.universities.length && <Empty />}
    </>
  );
}
