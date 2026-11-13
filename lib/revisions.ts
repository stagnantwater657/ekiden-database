import { createHash } from "node:crypto";
import { mergeRegistry, validateImport } from "./importer.ts";
import type { EditionBundle, Registry, Source } from "./model.ts";

const registryKeys = ["sources", "races", "universities", "athletes", "teams"] as const;
const batchKeys = ["sources", "entries", "results", "identities"] as const;

export interface RevisionChanges {
  entryTotals: {
    entryId: string;
    totalTimeSeconds: number;
    totalTimeSourceId: string;
  }[];
  additions: Pick<EditionBundle, "sources" | "entries" | "results" | "identities"> & {
    registry: Registry;
  };
}
export interface RevisionMetadata {
  id: string;
  editionId: string;
  reason: string;
  createdAt: string;
}
export interface EditionRevision extends RevisionMetadata, RevisionChanges {
  schemaVersion: 1;
  beforeSha256: string;
  afterSha256: string;
  beforeRegistrySha256: string;
  afterRegistrySha256: string;
}

// Canonical here means JSON.stringify of the parsed, order-preserving JSON object.
// This deliberately detects array/object reordering as well as factual edits.
export function revisionHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function keys(value: object, allowed: readonly string[], label: string) {
  if (!value || Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    allowed.some((key) => !(key in value)))
    throw new Error(`Invalid revision ${label} fields`);
}

function validateShape(revision: EditionRevision) {
  keys(revision, ["schemaVersion", "id", "editionId", "reason", "createdAt",
    "beforeSha256", "afterSha256", "beforeRegistrySha256", "afterRegistrySha256",
    "entryTotals", "additions"], "artifact");
  if (revision.schemaVersion !== 1 || !/^[-a-z0-9]+$/.test(revision.id) ||
    !/^[-a-z0-9]+$/.test(revision.editionId) || !revision.reason.trim() ||
    !Number.isFinite(Date.parse(revision.createdAt)) ||
    [revision.beforeSha256, revision.afterSha256,
      revision.beforeRegistrySha256, revision.afterRegistrySha256]
      .some((hash) => !/^[a-f0-9]{64}$/.test(hash)))
    throw new Error("Invalid revision metadata or SHA256");
  keys(revision.additions, [...batchKeys, "registry"], "additions");
  keys(revision.additions.registry, registryKeys, "registry additions");
  for (const values of [revision.entryTotals,
    ...batchKeys.map((key) => revision.additions[key]),
    ...registryKeys.map((key) => revision.additions.registry[key])])
    if (!Array.isArray(values)) throw new Error("Revision additions must be arrays");
  const totals = new Set<string>();
  for (const total of revision.entryTotals) {
    keys(total, ["entryId", "totalTimeSeconds", "totalTimeSourceId"], "entry total");
    if (!total.entryId || totals.has(total.entryId) ||
      !Number.isSafeInteger(total.totalTimeSeconds) || total.totalTimeSeconds <= 0 ||
      !total.totalTimeSourceId)
      throw new Error("Invalid or duplicate revision entry total");
    totals.add(total.entryId);
  }
  if (revision.beforeSha256 === revision.afterSha256)
    throw new Error("Revision must change the registered edition");
}

function reviewed(source: Source | undefined): boolean {
  return !!source?.usage?.basis.trim() && !!source.usage.policyUrl &&
    Number.isFinite(Date.parse(source.usage.reviewedAt)) && !!source.revision?.trim();
}

function validateNewEvidence(registry: Registry, batches: EditionBundle[], revision: EditionRevision) {
  const sources = [...registry.sources, ...batches.flatMap((batch) => batch.sources)];
  for (const source of [...revision.additions.sources, ...revision.additions.registry.sources])
    if (!reviewed(source)) throw new Error("Revision requires source-use review and adopted revision");
  for (const result of revision.additions.results) {
    if (!result.status || !result.locator?.trim() ||
      !reviewed(sources.find((source) => source.id === result.sourceId)))
      throw new Error("New revision results require status, location and reviewed source");
  }
  for (const decision of revision.additions.identities)
    if (decision.status === "legacy" || !decision.evidenceSourceIds.length)
      throw new Error("New revision identities require non-legacy evidence");
  for (const total of revision.entryTotals)
    if (!reviewed(sources.find((source) => source.id === total.totalTimeSourceId)))
      throw new Error("Revised total requires a reviewed source");
}

function transform(
  registry: Registry,
  batch: EditionBundle,
  revision: RevisionChanges,
  direction: "apply" | "rollback",
) {
  const next = structuredClone(batch);
  for (const total of revision.entryTotals) {
    const entry = next.entries.find((entry) => entry.id === total.entryId);
    if (!entry) throw new Error(`Unknown revised entry: ${total.entryId}`);
    if (direction === "apply") {
      if (entry.totalTimeSeconds !== null || entry.totalTimeSourceId !== null)
        throw new Error("Revision can only fill missing entry totals");
      entry.totalTimeSeconds = total.totalTimeSeconds;
      entry.totalTimeSourceId = total.totalTimeSourceId;
    } else {
      if (entry.totalTimeSeconds !== total.totalTimeSeconds ||
        entry.totalTimeSourceId !== total.totalTimeSourceId)
        throw new Error("Rollback total no longer matches revision");
      entry.totalTimeSeconds = null;
      entry.totalTimeSourceId = null;
    }
  }
  for (const key of batchKeys) {
    const target = next[key] as unknown as Record<string, unknown>[];
    const additions = revision.additions[key] as unknown as Record<string, unknown>[];
    const idKey = key === "identities" ? "recordId" : "id";
    for (const addition of additions) {
      const index = target.findIndex((item) => item[idKey] === addition[idKey]);
      if (direction === "apply") {
        if (index !== -1) throw new Error(`Revision cannot replace existing ${key}`);
        target.push(structuredClone(addition));
      } else {
        if (index === -1 || revisionHash(target[index]) !== revisionHash(addition))
          throw new Error(`Rollback ${key} no longer matches revision`);
        target.splice(index, 1);
      }
    }
  }
  const nextRegistry = structuredClone(registry);
  for (const key of registryKeys) {
    const target = nextRegistry[key] as { id: string }[];
    for (const addition of revision.additions.registry[key]) {
      const index = target.findIndex((item) => item.id === addition.id);
      if (direction === "apply") {
        if (index !== -1) throw new Error("Revision registry additions must have new IDs");
      } else {
        if (index === -1 || revisionHash(target[index]) !== revisionHash(addition))
          throw new Error("Rollback registry entity no longer matches revision");
        target.splice(index, 1);
      }
    }
  }
  return {
    registry: direction === "apply" ? mergeRegistry(nextRegistry, revision.additions.registry) : nextRegistry,
    batch: next,
  };
}

/** Creates the reviewable delta; publication still requires previewRevision validation. */
export function makeRevision(
  registry: Registry,
  batches: EditionBundle[],
  metadata: RevisionMetadata,
  changes: RevisionChanges,
): EditionRevision {
  const before = batches.find((batch) => batch.edition.id === metadata.editionId);
  if (!before) throw new Error("Revision requires an existing registered edition");
  const after = transform(registry, before, changes, "apply");
  const revision: EditionRevision = {
    schemaVersion: 1,
    ...metadata,
    beforeSha256: revisionHash(before),
    afterSha256: revisionHash(after.batch),
    beforeRegistrySha256: revisionHash(registry),
    afterRegistrySha256: revisionHash(after.registry),
    ...changes,
  };
  previewRevision(registry, batches, revision);
  return revision;
}

/** Neither input is mutated; no existing result, rank, identity or source can be edited. */
export function previewRevision(
  registry: Registry,
  batches: EditionBundle[],
  revision: EditionRevision,
  direction: "apply" | "rollback" = "apply",
) {
  validateShape(revision);
  const batch = batches.find((batch) => batch.edition.id === revision.editionId);
  if (!batch || batches.filter((b) => b.edition.id === revision.editionId).length !== 1)
    throw new Error("Revision requires one existing registered edition");
  const currentBatchHash = revisionHash(batch);
  const currentRegistryHash = revisionHash(registry);
  const isBefore = currentBatchHash === revision.beforeSha256 &&
    currentRegistryHash === revision.beforeRegistrySha256;
  const isAfter = currentBatchHash === revision.afterSha256 &&
    currentRegistryHash === revision.afterRegistrySha256;
  if (!isBefore && !isAfter) throw new Error("Revision base/post-state SHA256 mismatch; refuse drift or partial application");
  // Reconstruct both states, even on repeated application, so the stored delta
  // itself is verified rather than trusting only its after-hash.
  const before = isBefore ? { registry, batch } : transform(registry, batch, revision, "rollback");
  if (revisionHash(before.batch) !== revision.beforeSha256 ||
    revisionHash(before.registry) !== revision.beforeRegistrySha256)
    throw new Error("Revision reconstructed base SHA256 mismatch");
  const after = transform(before.registry, before.batch, revision, "apply");
  if (revisionHash(after.batch) !== revision.afterSha256 ||
    revisionHash(after.registry) !== revision.afterRegistrySha256)
    throw new Error("Revision candidate SHA256 mismatch");
  const replace = (candidate: EditionBundle) =>
    batches.map((item) => item.edition.id === revision.editionId ? candidate : item);
  const afterBatches = replace(after.batch);
  validateNewEvidence(after.registry, afterBatches, revision);
  // Validate every edition in both directions, without submitting the changed
  // duplicate to ordinary import or relaxing its same-ID conflict protection.
  for (const [candidateRegistry, candidateBatches] of [
    [before.registry, replace(before.batch)], [after.registry, afterBatches],
  ] as const)
    for (const candidate of candidateBatches)
      validateImport(candidateRegistry, candidateBatches, candidate);
  const target = direction === "apply" ? after : before;
  const oldResults = after.batch.results.filter((result) =>
    before.batch.results.some((old) => old.id === result.id));
  return {
    registry: target.registry,
    batches: replace(target.batch),
    report: {
      revisionId: revision.id,
      editionId: revision.editionId,
      direction,
      changed: direction === "apply" ? isBefore : isAfter,
      beforeSha256: revision.beforeSha256,
      afterSha256: revision.afterSha256,
      beforeRegistrySha256: revision.beforeRegistrySha256,
      afterRegistrySha256: revision.afterRegistrySha256,
      originalResults: {
        count: before.batch.results.length,
        beforeSha256: revisionHash(before.batch.results),
        afterSha256: revisionHash(oldResults),
      },
      entryTotals: revision.entryTotals.map((total) => ({
        entryId: total.entryId,
        before: { totalTimeSeconds: null, totalTimeSourceId: null },
        after: { totalTimeSeconds: total.totalTimeSeconds, totalTimeSourceId: total.totalTimeSourceId },
      })),
      added: Object.fromEntries(batchKeys.map((key) => [key,
        revision.additions[key].map((item) => "id" in item ? item.id : item.recordId)])),
      addedRegistry: Object.fromEntries(registryKeys.map((key) =>
        [key, revision.additions.registry[key].map((item) => item.id)])),
    },
  };
}
