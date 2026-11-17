import legacyHashes from "../data/research/legacy-v1.json" with { type: "json" };
import { researchAuditSummary } from "../lib/research-audit.ts";
import { fileURLToPath } from "node:url";
import { createResearchContext } from "../lib/research-context.ts";
import { validateResearchDirectory } from "../lib/research-files.ts";

import { readCompletionPlans } from "../lib/research-completion-files.ts";

const completionMode=process.argv[2]==="--completion";
if ((!completionMode && process.argv.length !== 2) || (completionMode && process.argv.length !== 4)) throw new Error("Usage: research:validate or research:complete -- <batchId> (read-only)");
const batches = validateResearchDirectory(fileURLToPath(new URL("../data/research/batches/", import.meta.url)), createResearchContext(), legacyHashes);
console.log(`Research audit: ${batches.length} batch(es), ${batches.reduce((n, b) => n + b.records.length, 0)} record(s) valid.`);
console.log("Offline structure/reference checks only; independent review must verify visits, evidence and latest PBs. Legacy facts are not required to have retroactive logs.");

for (const batch of batches) for (const record of batch.records)
  console.log(`${batch.batchId} / ${record.athleteId} / ${record.field}: ${researchAuditSummary(record)}`);

const plans=readCompletionPlans(fileURLToPath(new URL("../data/research/completion/",import.meta.url)),batches);
for (const {plan,report} of plans) {
  console.log(`${plan.batchId}: completion ${report.complete ? "ready for independent review" : "INCOMPLETE"}; ${report.findings.length} finding(s)`);
  for (const f of report.findings) console.log(`  ${f.subject}: ${f.code}: ${f.detail}`);
}
for (const batch of batches) if (!plans.some(({plan})=>plan.batchId===batch.batchId))
  console.log(`${batch.batchId}: completion NOT ASSESSED (legacy compatibility, not a completion pass)`);
if (completionMode) {
  const assessment=plans.find(({plan})=>plan.batchId===process.argv[3]);
  if (!assessment?.report.complete) process.exitCode=1;
  if (!assessment) console.error("No completion plan for requested batch; research completion is unassessed");
}
