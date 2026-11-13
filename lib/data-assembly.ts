import type { Database, EditionBundle, Registry } from "./model.ts";
export function assembleDatabase(
  registry: Registry,
  batches: EditionBundle[],
): Database {
  const byEdition = new Map<string, EditionBundle>();
  for (const batch of batches) {
    if (batch.schemaVersion !== 2)
      throw new Error("Unsupported import version");
    const old = byEdition.get(batch.edition.id);
    if (old && JSON.stringify(old) !== JSON.stringify(batch))
      throw new Error("Conflicting edition import");
    byEdition.set(batch.edition.id, batch);
  }
  const unique = [...byEdition.values()].sort((a, b) =>
    a.edition.id.localeCompare(b.edition.id),
  );
  return {
    ...registry,
    schemaVersion: 2,
    sources: [...registry.sources, ...unique.flatMap((b) => b.sources)],
    editions: unique.map((b) => b.edition),
    sections: unique.flatMap((b) => b.sections),
    entries: unique.flatMap((b) => b.entries),
    results: unique.flatMap((b) => b.results),
    identities: unique.flatMap((b) => b.identities),
  };
}
