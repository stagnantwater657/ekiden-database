import meets from "../data/research/meets.json" with { type: "json" };
import legacyHashes from "../data/research/legacy-v1.json" with { type: "json" };
import { validateResearchMeets, researchAuditSummary } from "../lib/research-audit.ts";
import { fileURLToPath } from "node:url";
import { database } from "../data/index.ts";
import { presentationSources } from "../data/presentation/index.ts";
import { validateResearchDirectory } from "../lib/research-files.ts";

if (process.argv.length !== 2) throw new Error("Usage: npm run research:validate (read-only; no arguments)");
const batches = validateResearchDirectory(fileURLToPath(new URL("../data/research/batches/", import.meta.url)), {
  meets: validateResearchMeets(meets),
  athletes: database.athletes,
  editions: database.editions,
  sources: [...database.sources, ...presentationSources],
  uncertainAthleteIds: database.identities.filter((i) => i.status === "needs-review").map((i) => i.athleteId),
}, legacyHashes);
console.log(`Research audit: ${batches.length} batch(es), ${batches.reduce((n, b) => n + b.records.length, 0)} record(s) valid.`);
console.log("Offline structure/reference checks only; independent review must verify visits, evidence and latest PBs. Legacy facts are not required to have retroactive logs.");

for (const batch of batches) for (const record of batch.records)
  console.log(`${batch.batchId} / ${record.athleteId} / ${record.field}: ${researchAuditSummary(record)}`);
