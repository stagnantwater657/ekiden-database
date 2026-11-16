import { fileURLToPath } from "node:url";
import { database } from "../data/index.ts";
import { presentationSources } from "../data/presentation/index.ts";
import { validateResearchDirectory } from "../lib/research-files.ts";

if (process.argv.length !== 2) throw new Error("Usage: npm run research:validate (read-only; no arguments)");
const batches = validateResearchDirectory(fileURLToPath(new URL("../data/research/batches/", import.meta.url)), {
  athletes: database.athletes,
  sources: [...database.sources, ...presentationSources],
  uncertainAthleteIds: database.identities.filter((i) => i.status === "needs-review").map((i) => i.athleteId),
});
console.log(`Research audit: ${batches.length} batch(es), ${batches.reduce((n, b) => n + b.records.length, 0)} record(s) valid.`);
console.log("Offline structure/reference checks only; independent review must verify visits, evidence and latest PBs. Legacy facts are not required to have retroactive logs.");
