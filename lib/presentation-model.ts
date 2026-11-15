import type { Source } from "./model.ts";
export type HonorType = "section-award" | "section-record" | "section-record-tie";
export interface HonorFact {
  id: string;
  resultId: string;
  type: HonorType;
  sourceId: string;
  locator: string;
  revision: string;
}
export interface OfficialCumulativePoint {
  rankingScope?: "checkpoint-before-withdrawal";
  resultId: string;
  entryId: string;
  timeSeconds: number;
  rank: number | null;
  sourceId: string;
  locator: string;
  revision: string;
}
export interface EditionPresentation {
  editionId: string;
  reviewedAt: string;
  revision: string;
  sourceId: string;
  cumulativeRankingBasis: "official-overall-elapsed";
  cumulative: OfficialCumulativePoint[];
  honors: HonorFact[];
  notes: string[];
}
export interface PresentationData {
  editions: EditionPresentation[];
  sources: Source[];
}
