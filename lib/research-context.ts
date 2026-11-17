import meets from "../data/research/meets.json" with { type: "json" };
import { database } from "../data/index.ts";
import { presentationSources } from "../data/presentation/index.ts";
import { validateResearchMeets } from "./research-audit.ts";
import type { ResearchContext } from "./research.ts";

/** Shared production context for CLI and tests; synthetic tests may explicitly replace entities. */
export function createResearchContext(overrides: Partial<ResearchContext> = {}): ResearchContext {
  return {
    athletes: database.athletes,
    editions: database.editions,
    sources: [...database.sources, ...presentationSources],
    uncertainAthleteIds: database.identities.filter((i) => i.status === "needs-review").map((i) => i.athleteId),
    ...overrides,
    meets: validateResearchMeets(overrides.meets ?? meets),
  };
}
