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
    const stageKinds = new Set<string>();
    for (const stage of entry.stages ?? []) {
      const sections = candidate.sections.filter(
        (s) => s.number >= stage.firstSection && s.number <= stage.lastSection,
      );
      const stageRows = rows.filter((r) => sections.some((s) => s.id === r.sectionId));
      if (!["outbound", "return"].includes(stage.kind) || stageKinds.has(stage.kind) ||
        !Number.isSafeInteger(stage.firstSection) || !Number.isSafeInteger(stage.lastSection) ||
        stage.firstSection < 1 || stage.lastSection < stage.firstSection ||
        sections.length !== stage.lastSection - stage.firstSection + 1 ||
        stageRows.length !== sections.length || !stage.locator ||
        !db.sources.some((s) => s.id === stage.sourceId) ||
        !Number.isSafeInteger(stage.timeSeconds) || stage.timeSeconds <= 0 ||
        (stage.rank !== null && (!Number.isSafeInteger(stage.rank) || stage.rank <= 0 || entry.status !== "finished")))
        throw new Error("Invalid official stage result");
      stageKinds.add(stage.kind);
      if (stageRows.some((r) => r.timeSeconds === null) ||
        stageRows.reduce((sum, r) => sum + r.timeSeconds!, 0) !== stage.timeSeconds)
        throw new Error("Official stage time mismatch");
    }
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
  const edition = db.editions.find((e) => e.id === editionId);
  if (!edition) throw new Error(`Unknown report edition: ${editionId}`);
  // Actual race dates, never import order, season/year labels or array positions.
  // Same-day editions are not earlier; unknown identities have independent IDs.
  const earlierEditions = new Set(
    db.editions
      .filter((e) => Date.parse(e.date) < Date.parse(edition.date))
      .map((e) => e.id),
  );
  const earlierEntries = new Set(
    db.entries.filter((e) => earlierEditions.has(e.editionId)).map((e) => e.id),
  );
  const earlierAthletes = new Set(
    db.results
      .filter((r) => earlierEntries.has(r.entryId))
      .map((r) => r.athleteId),
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
    crossEditionAthletes: new Set(
      rows
        .filter((r) => otherAthletes.has(r.athleteId))
        .map((r) => r.athleteId),
    ).size,
    reusedFromEarlierEditions: new Set(
      rows
        .filter((r) => earlierAthletes.has(r.athleteId))
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
