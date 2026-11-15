import { editionPresentations, presentationSources } from "../data/presentation/index.ts";
import type { Database, Source } from "./model.ts";
import type { EditionPresentation, HonorFact } from "./presentation-model.ts";
export { editionPresentations, presentationSources };
export function allSources(db: Database): Source[] {
  return [...db.sources, ...presentationSources];
}
export function honorFacts(resultId: string): HonorFact[] {
  return editionPresentations.flatMap((edition) => edition.honors.filter((fact) => fact.resultId === resultId));
}
/** Validate supplement facts against immutable results; never manufacture facts. */
export function validatePresentation(db: Database, bundles: EditionPresentation[] = editionPresentations, extraSources: Source[] = presentationSources): void {
  const fail = (message: string): never => { throw new Error(`Presentation: ${message}`); };
  const sources = new Map([...db.sources, ...extraSources].map((source) => [source.id, source]));
  if (sources.size !== db.sources.length + extraSources.length) fail("duplicate source ID");
  for (const source of extraSources) {
    if (!/^https?:\/\//.test(source.url) || !source.title || !source.coverage || !source.locator || !source.revision || !/^\d{4}-\d{2}-\d{2}/.test(source.collectedAt) || !source.usage || !/^https?:\/\//.test(source.usage.policyUrl) || !source.usage.reviewedAt || !source.usage.basis) fail("incomplete source metadata/policy review");
  }
  const entries = new Map(db.entries.map((entry) => [entry.id, entry]));
  const sections = new Map(db.sections.map((section) => [section.id, section]));
  const results = new Map(db.results.map((result) => [result.id, result]));
  const editionIds = new Set<string>();
  const factIds = new Set<string>();
  for (const bundle of bundles) {
    if (editionIds.has(bundle.editionId)) fail("duplicate edition supplement");
    editionIds.add(bundle.editionId);
    if (!db.editions.some((edition) => edition.id === bundle.editionId) || !sources.has(bundle.sourceId)) fail("unknown edition/source");
    if (bundle.cumulativeRankingBasis !== "official-overall-elapsed" || !bundle.revision || !/^\d{4}-\d{2}-\d{2}$/.test(bundle.reviewedAt)) fail("missing version/ranking basis/review date");
    const seen = new Set<string>();
    const ranks = new Map<string, {time: number; rank: number}[]>();
    for (const point of bundle.cumulative) {
      const result = results.get(point.resultId);
      const entry = result && entries.get(result.entryId);
      const section = result && sections.get(result.sectionId);
      if (!result || !entry || !section || entry.editionId !== bundle.editionId || section.editionId !== bundle.editionId || entry.id !== point.entryId) fail(`invalid cumulative relationship ${point.resultId}`);
      if (seen.has(point.resultId)) fail("duplicate cumulative point");
      seen.add(point.resultId);
      if (!sources.has(point.sourceId) || !point.locator || !point.revision) fail("missing cumulative provenance");
      if (!Number.isSafeInteger(point.timeSeconds) || point.timeSeconds <= 0 || (point.rank !== null && (!Number.isSafeInteger(point.rank) || point.rank < 1))) fail("invalid cumulative time/rank");
      if (!["finished", "reference", "did-not-finish"].includes(entry!.status) || (result!.status && !["finished", "reference"].includes(result!.status))) fail("cumulative for invalid result status");
      if (point.rank !== null && (entry!.rankingEligibility === "reference" || entry!.status === "reference")) fail("reference result has official cumulative rank");
      if (entry!.status === "did-not-finish") {
        if (point.rankingScope !== "checkpoint-before-withdrawal" || db.results.some((row) => row.entryId === entry!.id && sections.get(row.sectionId)!.number <= section!.number && (row.status === "did-not-finish" || row.timeSeconds === null))) fail("invalid pre-withdrawal point");
      } else if (point.rankingScope) fail("unexpected pre-withdrawal scope");
      const finalSection = Math.max(...db.sections.filter((leg) => leg.editionId === bundle.editionId).map((leg) => leg.number));
      if (section!.number === finalSection && (point.timeSeconds !== entry!.totalTimeSeconds || point.rank !== entry!.finalRank)) fail("inconsistent official final time/rank");
      // Compare to section elapsed times, never to on-road clocks. Hakone archive
      // contains documented official rounding differences; only its explicitly
      // sourced stage/final times are checked here, never inferred arrival ranks.
      const race = db.editions.find((edition) => edition.id === bundle.editionId)!.raceId;
      if (race !== "hakone") {
        const preceding = db.results.filter((row) => row.entryId === entry!.id && sections.get(row.sectionId)!.number <= section!.number);
        if (preceding.length !== section!.number || preceding.some((row) => row.timeSeconds === null) || preceding.reduce((sum, row) => sum + row.timeSeconds!, 0) !== point.timeSeconds) fail(`inconsistent cumulative time ${point.resultId}`);
      } else {
        const last = Math.max(...db.sections.filter((s) => s.editionId === bundle.editionId).map((s) => s.number));
        const stage = entry!.stages?.find((s) => s.firstSection === 1 && s.lastSection === section!.number);
        if (section!.number === last && (point.timeSeconds !== entry!.totalTimeSeconds || point.rank !== entry!.finalRank)) fail("inconsistent official Hakone final");
        if (stage && point.timeSeconds !== stage.timeSeconds) fail("inconsistent official Hakone outbound");
      }
      if (point.rank !== null) ranks.set(section!.id, [...(ranks.get(section!.id) ?? []), {time: point.timeSeconds, rank: point.rank}]);
    }
    for (const rows of ranks.values()) {
      rows.sort((a, b) => a.rank - b.rank);
      for (let i = 1; i < rows.length; i++) if (rows[i].time < rows[i - 1].time) fail("cumulative time/rank conflict");
      // Same printed second with different official ranks is valid.
    }
    for (const fact of bundle.honors) {
      const result = results.get(fact.resultId);
      const entry = result && entries.get(result.entryId);
      if (!result || !entry || entry.editionId !== bundle.editionId) fail("invalid honor relationship");
      if (!["section-award", "section-record", "section-record-tie"].includes(fact.type) || fact.id !== `${fact.resultId}/${fact.type}` || factIds.has(fact.id)) fail("invalid/duplicate honor ID");
      factIds.add(fact.id);
      if (!sources.has(fact.sourceId) || !fact.locator || !fact.revision || !result!.timeSeconds) fail("missing honor evidence/time");
      if (entry!.status === "disqualified" || result!.status === "disqualified" || result!.status === "did-not-finish") fail("honor for invalidated result");
      if (fact.type === "section-award" && result!.rank !== 1) fail("award inconsistent with official section rank");
      if (fact.type === "section-record-tie" && bundle.honors.some((other) => other.resultId === fact.resultId && other.type === "section-record")) fail("new/tie conflict");
    }
  }
}
