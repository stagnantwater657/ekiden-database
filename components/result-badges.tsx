import { getResultHonors } from "../lib/scoreboard";
/** Honors are explicit official facts, never inferred from a database minimum. */
export function ResultBadges({ resultId }: { resultId: string }) {
  const honors = getResultHonors(resultId);
  if (!honors) return null;
  return (
    <span className="result-badges" title={`官方认定 · ${honors.locator}`}>
      {honors.sectionAward && (
        <span className="result-badge result-badge--award" lang="ja">
          区間賞
        </span>
      )}
      {honors.sectionRecord && (
        <span className="result-badge result-badge--record" lang="ja">
          区間新
        </span>
      )}
    </span>
  );
}
