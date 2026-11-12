import { createHash } from "node:crypto";
import type { Database, EditionBundle, Registry } from "./model.ts";
import { assembleDatabase } from "./data-assembly.ts";
import { validateDatabase } from "./repository.ts";
export function mergeRegistry(
  existing: Registry,
  additions: Registry,
): Registry {
  const output = structuredClone(existing);
  for (const key of [
    "sources",
    "races",
    "universities",
    "athletes",
    "teams",
  ] as const) {
    const target = output[key] as { id: string }[];
    for (const entity of additions[key]) {
      const found = target.find((e) => e.id === entity.id);
      if (found && JSON.stringify(found) !== JSON.stringify(entity))
        throw new Error(`Conflicting registered identity: ${entity.id}`);
      if (!found) target.push(entity);
    }
  }
  return output;
}
export function validateImport(
  registry: Registry,
  batches: EditionBundle[],
  candidate: EditionBundle,
) {
  if (
    candidate.sections.some((s) => s.editionId !== candidate.edition.id) ||
    candidate.entries.some((e) => e.editionId !== candidate.edition.id) ||
    candidate.results.some(
      (r) =>
        !candidate.entries.some((e) => e.id === r.entryId) ||
        !candidate.sections.some((s) => s.id === r.sectionId),
    )
  )
    throw new Error("Batch contains foreign edition records");
  if (candidate.edition.id !== "all-japan-2024") {
    const sources = [...registry.sources, ...candidate.sources];
    for (const source of candidate.sources) {
      if (
        !source.usage?.basis.trim() ||
        !source.usage.policyUrl ||
        !Number.isFinite(Date.parse(source.usage.reviewedAt)) ||
        !source.revision?.trim()
      )
        throw new Error(
          "New batch requires documented source-use review and adopted revision",
        );
    }
    if (
      candidate.results.some(
        (r) =>
          !r.status || !r.locator || !sources.some((s) => s.id === r.sourceId),
      )
    )
      throw new Error("New results require status and source location");
    if (candidate.identities.some((i) => i.status === "legacy"))
      throw new Error("New imports cannot use legacy identity decisions");
    if (
      candidate.entries.some(
        (e) =>
          e.status === "finished" &&
          (e.totalTimeSeconds === null || e.finalRank === null),
      )
    )
      throw new Error(
        "Finished official team requires verified total and rank",
      );
  }
  const db = assembleDatabase(registry, [...batches, candidate]);
  validateDatabase(db);
  for (const entry of candidate.entries) {
    const rows = candidate.results.filter((r) => r.entryId === entry.id);
    if (
      ["finished", "reference"].includes(entry.status) &&
      rows.length !== candidate.sections.length
    )
      throw new Error("Incomplete completed-team lineup");
    if (
      entry.totalTimeSeconds !== null &&
      rows.every((r) => r.timeSeconds !== null) &&
      rows.reduce((sum, r) => sum + r.timeSeconds!, 0) !==
        entry.totalTimeSeconds
    )
      throw new Error(`Team total mismatch: ${entry.id}`);
  }
  return db;
}
export function importReport(db: Database, editionId: string) {
  const entries = db.entries.filter((e) => e.editionId === editionId);
  const ids = new Set(entries.map((e) => e.id));
  const rows = db.results.filter((r) => ids.has(r.entryId));
  const decisions = db.identities.filter((i) =>
    rows.some((r) => r.id === i.recordId),
  );
  const otherAthletes = new Set(
    db.results.filter((r) => !ids.has(r.entryId)).map((r) => r.athleteId),
  );
  return {
    editionId,
    teams: entries.length,
    universityTeams: entries.filter(
      (e) => db.teams.find((t) => t.id === e.teamId)?.kind === "university",
    ).length,
    starts: rows.length,
    athletes: new Set(rows.map((r) => r.athleteId)).size,
    officialFinalRanks: entries.filter((e) => e.finalRank !== null).length,
    unrankedTeams: entries
      .filter((e) => e.finalRank === null)
      .map((e) => e.teamId),
    reusedAthletes: new Set(
      rows
        .filter((r) => otherAthletes.has(r.athleteId))
        .map((r) => r.athleteId),
    ).size,
    resultsSha256: createHash("sha256")
      .update(JSON.stringify(rows))
      .digest("hex"),
    review: decisions.filter((i) => i.status === "needs-review"),
    missingTeamTotals: entries
      .filter((e) => e.totalTimeSeconds === null)
      .map((e) => e.id),
  };
}
