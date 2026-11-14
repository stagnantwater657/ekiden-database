import aj2024 from "../data/presentation/all-japan-2024.json" with { type: "json" };
import type {
  Database,
  Edition,
  Entry,
  Race,
  ResultRow,
  Section,
  Source,
  Team,
  University,
} from "./model.ts";

export type CumulativeMode = "official" | "calculated" | "unavailable";
export interface CumulativeResult {
  timeSeconds: number | null;
  rank: number | null;
  movement: number | null;
  gapSeconds: number | null;
  mode: CumulativeMode;
  sourceId: string | null;
  locator: string | null;
}
export interface ScoreboardRow extends ResultRow {
  cumulative: CumulativeResult;
}
export interface FinalStanding {
  entry: Entry;
  team: Team;
  university: University | null;
  gapSeconds: number | null;
}
export interface EditionScoreboard {
  edition: Edition;
  race: Race;
  sections: Section[];
  section: Section;
  rows: ScoreboardRow[];
  finalRows: FinalStanding[];
  specialRows: FinalStanding[];
  cumulativeMode: CumulativeMode;
  cumulativeLabel: string;
  sources: Source[];
  notes: string[];
}
export interface ResultHonors {
  sectionAward: boolean;
  sectionRecord: boolean;
  sourceId: string;
  locator: string;
}

// Explicit award/record evidence, never the minimum time in the site's partial history.
const honors = new Map(
  aj2024.honors.map((honor) => [
    honor.resultId,
    {
      sectionAward: honor.sectionAward,
      sectionRecord: honor.sectionRecord,
      sourceId: aj2024.sourceId,
      locator: honor.locator,
    },
  ]),
);
export function getResultHonors(resultId: string): ResultHonors | null {
  return honors.get(resultId) ?? null;
}

export function rankMovement(
  previous: number | null,
  current: number | null,
): number | null {
  return previous === null || current === null ? null : previous - current;
}
export function formatGap(seconds: number | null): string {
  if (seconds === null || !Number.isSafeInteger(seconds) || seconds < 0)
    return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const tail = `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return `+${hours ? `${hours}:` : ""}${tail}`;
}
function eligible(entry: Entry, team: Team): boolean {
  return (
    (entry.rankingEligibility ??
      (team.kind === "university" ? "official" : "reference")) === "official"
  );
}
const blankCumulative = (): CumulativeResult => ({
  timeSeconds: null,
  rank: null,
  movement: null,
  gapSeconds: null,
  mode: "unavailable",
  sourceId: null,
  locator: null,
});
function compareNullable(a: number | null, b: number | null): number {
  return a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b;
}

/**
 * Read-only presentation projection. Official AJ2024 points retain the printed
 * cumulative rank (not the individual section rank or a recalculated tie rank).
 * Ordinary complete all-Japan/Izumo editions can show a separately labelled sum;
 * Hakone's staggered starts and editions with missing/disqualified/DNF formal
 * teams are deliberately excluded from this derivation.
 */
export function buildEditionScoreboard(
  db: Database,
  editionId: string,
  sectionNumber = 1,
): EditionScoreboard | null {
  const edition = db.editions.find((item) => item.id === editionId);
  if (!edition) return null;
  const race = db.races.find((item) => item.id === edition.raceId)!;
  const sections = db.sections
    .filter((item) => item.editionId === editionId)
    .sort((a, b) => a.number - b.number);
  const section =
    sections.find((item) => item.number === sectionNumber) ?? sections[0];
  if (!section) return null;
  const entries = db.entries.filter((entry) => entry.editionId === editionId);
  const entryMap = new Map(entries.map((entry) => [entry.id, entry]));
  const teams = new Map(db.teams.map((item) => [item.id, item]));
  const universities = new Map(db.universities.map((item) => [item.id, item]));
  const athletes = new Map(db.athletes.map((item) => [item.id, item]));
  const sourceMap = new Map(db.sources.map((item) => [item.id, item]));
  const sectionMap = new Map(sections.map((item) => [item.id, item]));
  const results = db.results.filter((result) => entryMap.has(result.entryId));
  const resultBySlot = new Map(
    results.map((result) => [`${result.entryId}/${result.sectionId}`, result]),
  );
  const officialEntries = entries.filter((entry) =>
    eligible(entry, teams.get(entry.teamId)!),
  );
  const hasOfficial =
    editionId === aj2024.editionId && sourceMap.has(aj2024.sourceId);
  const canCalculate =
    !hasOfficial &&
    ["all-japan", "izumo"].includes(race.id) &&
    officialEntries.length > 0 &&
    officialEntries.every(
      (entry) =>
        entry.status === "finished" &&
        entry.finalRank !== null &&
        entry.totalTimeSeconds !== null &&
        sections.every((leg) => {
          const result = resultBySlot.get(`${entry.id}/${leg.id}`);
          return (
            result &&
            (!result.status || result.status === "finished") &&
            result.timeSeconds !== null
          );
        }) &&
        sections.reduce(
          (sum, leg) =>
            sum + resultBySlot.get(`${entry.id}/${leg.id}`)!.timeSeconds!,
          0,
        ) === entry.totalTimeSeconds,
    );
  const cumulativeMode: CumulativeMode = hasOfficial
    ? "official"
    : canCalculate
      ? "calculated"
      : "unavailable";
  const cumulative = new Map<string, CumulativeResult>();

  if (hasOfficial) {
    const points = new Map(
      aj2024.cumulative.map((point) => [point.resultId, point]),
    );
    for (const leg of sections) {
      const legResults = results.filter(
        (result) => result.sectionId === leg.id,
      );
      const leader = legResults
        .map((result) => points.get(result.id))
        .find((point) => point?.rank === 1);
      for (const result of legResults) {
        const entry = entryMap.get(result.entryId)!;
        const point = points.get(result.id);
        if (
          !point ||
          !["finished", "reference"].includes(entry.status) ||
          (result.status && !["finished", "reference"].includes(result.status))
        )
          continue;
        const previousSection = sections.find(
          (previous) => previous.number === leg.number - 1,
        );
        const previousResult =
          previousSection &&
          resultBySlot.get(`${entry.id}/${previousSection.id}`);
        const previous = previousResult
          ? points.get(previousResult.id)
          : undefined;
        const ranked =
          eligible(entry, teams.get(entry.teamId)!) &&
          entry.status === "finished";
        cumulative.set(result.id, {
          timeSeconds: point.timeSeconds,
          rank: ranked ? point.rank : null,
          movement: ranked
            ? rankMovement(previous?.rank ?? null, point.rank)
            : null,
          gapSeconds:
            ranked && point.rank !== null && leader
              ? point.timeSeconds - leader.timeSeconds
              : null,
          mode: "official",
          sourceId: aj2024.sourceId,
          locator: point.locator,
        });
      }
    }
  } else if (canCalculate) {
    const totals = new Map<string, number>();
    const previousRanks = new Map<string, number>();
    for (const leg of sections) {
      for (const entry of officialEntries) {
        const result = resultBySlot.get(`${entry.id}/${leg.id}`)!;
        totals.set(entry.id, (totals.get(entry.id) ?? 0) + result.timeSeconds!);
      }
      const ordered = [...officialEntries].sort(
        (a, b) =>
          totals.get(a.id)! - totals.get(b.id)! || a.id.localeCompare(b.id),
      );
      const leadingTime = totals.get(ordered[0].id)!;
      // Competition ranking for equal displayed seconds; explicitly not an official passing order.
      let previousTime: number | null = null;
      let currentRank = 0;
      ordered.forEach((entry, index) => {
        const timeSeconds = totals.get(entry.id)!;
        if (timeSeconds !== previousTime) currentRank = index + 1;
        previousTime = timeSeconds;
        const result = resultBySlot.get(`${entry.id}/${leg.id}`)!;
        cumulative.set(result.id, {
          timeSeconds,
          rank: currentRank,
          movement: rankMovement(
            previousRanks.get(entry.id) ?? null,
            currentRank,
          ),
          gapSeconds: timeSeconds - leadingTime,
          mode: "calculated",
          sourceId: null,
          locator: null,
        });
        previousRanks.set(entry.id, currentRank);
      });
    }
  }
  const rows: ScoreboardRow[] = results
    .filter((result) => result.sectionId === section.id)
    .map((result) => {
      const entry = entryMap.get(result.entryId)!;
      return {
        ...result,
        entry,
        race,
        edition,
        section: sectionMap.get(result.sectionId)!,
        university: entry.universityId
          ? universities.get(entry.universityId)!
          : null,
        team: teams.get(entry.teamId)!,
        athlete: athletes.get(result.athleteId)!,
        source: sourceMap.get(result.sourceId)!,
        cumulative: cumulative.get(result.id) ?? blankCumulative(),
      };
    })
    .sort(
      (a, b) =>
        compareNullable(a.rank, b.rank) ||
        compareNullable(a.timeSeconds, b.timeSeconds) ||
        a.id.localeCompare(b.id),
    );
  const formal = entries.filter(
    (entry) =>
      eligible(entry, teams.get(entry.teamId)!) &&
      entry.status === "finished" &&
      entry.finalRank !== null,
  );
  const champion = formal.find((entry) => entry.finalRank === 1);
  const finalRows = formal
    .map(
      (entry): FinalStanding => ({
        entry,
        team: teams.get(entry.teamId)!,
        university: entry.universityId
          ? universities.get(entry.universityId)!
          : null,
        gapSeconds:
          champion?.totalTimeSeconds !== null &&
          champion?.totalTimeSeconds !== undefined &&
          entry.totalTimeSeconds !== null
            ? entry.totalTimeSeconds - champion.totalTimeSeconds
            : null,
      }),
    )
    .sort(
      (a, b) =>
        compareNullable(a.entry.finalRank, b.entry.finalRank) ||
        a.entry.id.localeCompare(b.entry.id),
    );
  const formalIds = new Set(formal.map((entry) => entry.id));
  const specialRows = entries
    .filter((entry) => !formalIds.has(entry.id))
    .map(
      (entry): FinalStanding => ({
        entry,
        team: teams.get(entry.teamId)!,
        university: entry.universityId
          ? universities.get(entry.universityId)!
          : null,
        gapSeconds: null,
      }),
    )
    .sort((a, b) => a.entry.id.localeCompare(b.entry.id));
  const sourceIds = new Set([
    edition.sourceId,
    ...results.flatMap((result) => [
      result.sourceId,
      result.participationSourceId,
    ]),
    ...entries.flatMap((entry) => [
      entry.sourceId,
      entry.finalRankSourceId,
      entry.totalTimeSourceId,
      ...(entry.stages ?? []).map((stage) => stage.sourceId),
    ]),
    ...(hasOfficial ? [aj2024.sourceId] : []),
  ]);
  return {
    edition,
    race,
    sections,
    section,
    rows,
    finalRows,
    specialRows,
    cumulativeMode,
    cumulativeLabel: hasOfficial
      ? "官方累计成绩"
      : canCalculate
        ? "按区间用时计算"
        : "累计成绩尚待核验",
    sources: db.sources.filter((source) => sourceIds.has(source.id)),
    notes: [
      ...(hasOfficial
        ? [
            "累计时间与综合顺位采用第56回官方成绩表第2页；顺位变化和领先差由这些官方累计值计算。参考队保留官方累计用时，不赋予综合顺位。",
          ]
        : []),
      ...(canCalculate
        ? [
            "累计时间为完整区间用时之和；计算顺位仅比较正式队伍，显示秒数相同按并列处理，不是官方通過順位。参考队不参与计算。",
          ]
        : []),
      ...(cumulativeMode === "unavailable"
        ? [
            race.id === "hakone"
              ? "箱根包含往返路与繰り上げスタート等计时口径；未核验官方逐区间累计资料前不推算累计顺位或时间。"
              : "本届存在特殊结果状态或累计核验资料不全，暂不推算累计顺位与时间。",
          ]
        : []),
      "区間賞与区間新仅显示已逐项核验的官方认定；本轮覆盖2024年第56回全日本，其余届次未标记不代表没有获奖或纪录。",
    ],
  };
}
