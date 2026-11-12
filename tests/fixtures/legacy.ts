import legacy from "../../data/all-japan-2024.json" with { type: "json" };
import batch from "../../data/editions/all-japan-2024.json" with { type: "json" };
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
  [batch as EditionBundle],
);
