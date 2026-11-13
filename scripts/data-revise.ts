import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { previewRevision } from "../lib/revisions.ts";
import type { EditionRevision } from "../lib/revisions.ts";
import type { EditionBundle, Registry } from "../lib/model.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args[0] !== "--input" || !args[1] || args.slice(2).some(arg => !["--write", "--rollback"].includes(arg)) ||
  new Set(args.slice(2)).size !== args.slice(2).length)
  throw new Error("Usage: data:revise -- --input revision.json [--rollback] [--write]");
const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const registry = read("data/registry/entities.json") as Registry;
const manifest = read("data/manifest.json") as string[];
if (!Array.isArray(manifest) || manifest.some(id => !/^[-a-z0-9]+$/.test(id)) || new Set(manifest).size !== manifest.length)
  throw new Error("Invalid edition manifest");
const batches = manifest.map(id => read(`data/editions/${id}.json`) as EditionBundle);
const revision = read(args[1]) as EditionRevision;
const result = previewRevision(registry, batches, revision, args.includes("--rollback") ? "rollback" : "apply");
if (args.includes("--write") && result.report.changed) {
  // Both states and every edition have been validated before touching either file.
  // Per-file atomic replacement, not a cross-file transaction. A partial state
  // is rejected on replay; restore the paired files from git after interruption.
  const files = [
    ["data/registry/entities.json", result.registry],
    [`data/editions/${revision.editionId}.json`, result.batches.find(b => b.edition.id === revision.editionId)],
  ] as const;
  for (const [path, value] of files) writeFileSync(resolve(root, path + ".tmp"), JSON.stringify(value, null, 2) + "\n");
  for (const [path] of files) renameSync(resolve(root, path + ".tmp"), resolve(root, path));
}
process.stdout.write(JSON.stringify(result.report, null, 2) + "\n");
