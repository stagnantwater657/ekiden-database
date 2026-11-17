import legacyHashes from "../data/research/legacy-v1.json" with { type: "json" };
import { researchAuditSummary } from "../lib/research-audit.ts";
import { fileURLToPath } from "node:url";
import { createResearchContext } from "../lib/research-context.ts";
import { validateResearchDirectory } from "../lib/research-files.ts";

import { readResearchAuthorization } from "../lib/research-authorization.ts";
import { readCompletionPlans } from "../lib/research-completion-files.ts";

const completionMode=process.argv[2]==="--completion";
const withAuthorization=completionMode && process.argv.length===8 && process.argv[4]==="--authorization" && process.argv[6]==="--authorization-sha256";
if ((!completionMode && process.argv.length !== 2) || (completionMode && process.argv.length !== 4 && !withAuthorization))
  throw new Error("Usage: research:validate or research:complete -- <batchId> [--authorization <owner-scope.json> --authorization-sha256 <owner-provided-digest>] (read-only)");
const authorization=withAuthorization ? readResearchAuthorization(process.argv[5],process.argv[7]) : undefined;
if (authorization && authorization.batchId!==process.argv[3]) throw new Error("Authorization does not match requested batch");
if (authorization) console.log(`Authorization SHA-256 (expected input; independently confirm task-owner approval): ${process.argv[7]}; authority/reference authenticity requires independent review`);
const batches = validateResearchDirectory(fileURLToPath(new URL("../data/research/batches/", import.meta.url)), createResearchContext(), legacyHashes);
console.log(`Research audit: ${batches.length} batch(es), ${batches.reduce((n, b) => n + b.records.length, 0)} record(s) valid.`);
console.log("Offline structure/reference checks only; independent review must verify visits, evidence and latest PBs. Legacy facts are not required to have retroactive logs.");

for (const batch of batches) for (const record of batch.records)
  console.log(`${batch.batchId} / ${record.athleteId} / ${record.field}: ${researchAuditSummary(record)}`);

const plans=readCompletionPlans(fileURLToPath(new URL("../data/research/completion/",import.meta.url)),batches,authorization);
for (const {plan,report} of plans) {
  console.log(`${plan.batchId}: steps ${report.stepsComplete ? "COMPLETE" : "INCOMPLETE"}; declaration ${report.readyForReview ? "READY FOR REVIEW" : "NOT SUBMITTED"}; authorization ${report.authorizationComplete ? "MATCHED" : "NOT ASSESSED / MISMATCH"}; exit ${report.exitAllowed ? "ALLOWED (independent evidence review still required)" : "DENIED"}`);
  for (const f of [...report.findings,...report.authorizationFindings]) console.log(`  ${f.subject}: ${f.code}: ${f.detail}`);
  for (const f of report.manualChecks) console.log(`  MANUAL CHECK REQUIRED ${f.subject}: ${f.code}: ${f.detail}`);
}
for (const batch of batches) if (!plans.some(({plan})=>plan.batchId===batch.batchId))
  console.log(`${batch.batchId}: completion NOT ASSESSED (legacy compatibility, not a completion pass)`);
if (completionMode) {
  const assessment=plans.find(({plan})=>plan.batchId===process.argv[3]);
  if (!assessment?.report.exitAllowed) process.exitCode=1;
  if (!assessment) console.error("No completion plan for requested batch; research completion is unassessed");
}
