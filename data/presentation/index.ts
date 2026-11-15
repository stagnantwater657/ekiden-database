import hk2024 from "./editions/hakone-2024.json" with { type: "json" };
import hk2025 from "./editions/hakone-2025.json" with { type: "json" };
import hk2026 from "./editions/hakone-2026.json" with { type: "json" };
import iz2023 from "./editions/izumo-2023.json" with { type: "json" };
import iz2024 from "./editions/izumo-2024.json" with { type: "json" };
import iz2025 from "./editions/izumo-2025.json" with { type: "json" };
import iz2026 from "./editions/izumo-2026.json" with { type: "json" };
import extraSources from "./sources.json" with { type: "json" };
import aj2024 from "./all-japan-2024.json" with { type: "json" };
import aj2023 from "./editions/all-japan-2023.json" with { type: "json" };
import aj2025 from "./editions/all-japan-2025.json" with { type: "json" };
import aj2026 from "./editions/all-japan-2026.json" with { type: "json" };
import type { EditionPresentation, HonorType } from "../../lib/presentation-model.ts";
import type { Source } from "../../lib/model.ts";
// Keep the previously verified AJ2024 supplement intact. Normalize its legacy
// shape at the boundary; no edition-specific branches in Repository/scoreboard.
const legacy: EditionPresentation = {
  editionId: aj2024.editionId,
  reviewedAt: aj2024.reviewedAt,
  revision: aj2024.revision,
  sourceId: aj2024.sourceId,
  cumulativeRankingBasis: "official-overall-elapsed",
  cumulative: aj2024.cumulative.map((point) => ({
    ...point,
    entryId: point.resultId.replace(/-s\d+$/, ""),
    sourceId: aj2024.sourceId,
    revision: aj2024.revision,
  })),
  honors: aj2024.honors.flatMap((honor) =>
    (["section-award", "section-record"] as HonorType[])
      .filter((type) => type === "section-award" ? honor.sectionAward : honor.sectionRecord)
      .map((type) => ({
        id: `${honor.resultId}/${type}`, resultId: honor.resultId, type,
        sourceId: aj2024.sourceId, locator: honor.locator, revision: aj2024.revision,
      })),
  ),
  notes: [],
};
export const editionPresentations = [aj2023, legacy, aj2025, aj2026, iz2023, iz2024, iz2025, iz2026, hk2024, hk2025, hk2026] as EditionPresentation[];
export const presentationSources = extraSources as Source[];
