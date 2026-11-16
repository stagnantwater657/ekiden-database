import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { validateResearchBatch, type ResearchBatch, type ResearchContext } from "./research.ts";

/** Read-only, deterministic directory scan; no Git history or web access required. */
export function validateResearchDirectory(directory: string, context: ResearchContext, legacyHashes?: Readonly<Record<string, string>>): ResearchBatch[] {
  const seen = new Set<string>();
  return readdirSync(directory).filter((file) => file.endsWith(".json")).sort().map((file) => {
    let raw: unknown;
    let contents: string;
    try { contents = readFileSync(join(directory, file), "utf8"); raw = JSON.parse(contents); }
    catch { throw new Error(`Research ${file}: unreadable or invalid JSON`); }
    let batch: ResearchBatch;
    try { batch = validateResearchBatch(raw, context); }
    catch (error) { throw new Error(`${file}: ${error instanceof Error ? error.message : "invalid batch"}`); }
    if (batch.schemaVersion === 1 && legacyHashes && legacyHashes[file] !== createHash("sha256").update(contents).digest("hex"))
      throw new Error(`Research ${file}: new or modified logs require schemaVersion 2; legacy snapshot mismatch`);
    if (seen.has(batch.batchId)) throw new Error(`Research ${file}: duplicate batchId`);
    seen.add(batch.batchId);
    if (file !== `${batch.batchId}.json`) throw new Error(`Research ${file}: filename must match batchId`);
    return batch;
  });
}
