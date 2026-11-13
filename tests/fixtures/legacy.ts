import legacy from "../../data/all-japan-2024.json" with { type: "json" };
import { batches } from "./phase-one.ts";
import { registry } from "../../data/index.ts";
import { assembleDatabase } from "../../lib/data-assembly.ts";
import type { EditionBundle } from "../../lib/model.ts";
export const dataset = assembleDatabase(
  {
    ...legacy,
    teams: registry.teams.filter((t) =>
      legacy.universities.some((u) => u.id === t.universityId),
    ),
  },
  [batches.find(batch => batch.edition.id === 'all-japan-2024') as EditionBundle],
);
