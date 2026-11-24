import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { database } from "../data/index.ts";
import { presentationSources } from "../data/presentation/index.ts";
import { athleteProfileSupplements, validateAthleteProfiles } from "../lib/athlete-facts.ts";
import { validateDatabase } from "../lib/repository.ts";
import { previewPbCsv } from "../lib/pb-preview.ts";
import { writePbReview } from "../lib/pb-preview-report.ts";

const usage = "Usage: npm run pb:preview -- --input results.csv --as-of YYYY-MM-DD --out NEW_DIRECTORY (dry-run only)";
try {
  const args = process.argv.slice(2), options = new Map<string, string>();
  if (args.length !== 6) throw new Error(usage);
  for (let i = 0; i < args.length; i += 2) {
    if (!["--input", "--as-of", "--out"].includes(args[i]) || options.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(usage);
    options.set(args[i], args[i + 1]);
  }
  const input = resolve(options.get("--input")!);
  const bytes = readFileSync(input);
  // Strict decoding, not silent replacement of malformed legacy encodings.
  const csv = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  validateDatabase(database);
  validateAthleteProfiles(database);
  const report = previewPbCsv(csv, { database, profiles: athleteProfileSupplements, sources: [...database.sources, ...presentationSources] }, options.get("--as-of")!);
  const output = { ...report, inputFile: { path: input, sha256: createHash("sha256").update(bytes).digest("hex") },
    baselineSha256: createHash("sha256").update(JSON.stringify({ database, profiles: athleteProfileSupplements, sources: presentationSources })).digest("hex") };
  writePbReview(output, options.get("--out")!);
  console.log(JSON.stringify({ mode: report.mode, asOf: report.asOf, summary: report.summary, outputDirectory: resolve(options.get("--out")!) }, null, 2));
  console.log("Reports created; all rows need human review. No production writes or evidence verification.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "PB preview failed");
  process.exitCode = 1;
}
