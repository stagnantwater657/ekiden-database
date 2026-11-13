import type { Athlete, IdentityDecision } from "./model.ts";
// Normalization finds review candidates only. It is never an identity proof.
export function normalizeName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/\s/g, "")
    .replaceAll("髙", "高")
    .replaceAll("﨑", "崎")
    .replaceAll("澤", "沢")
    .replaceAll("邊", "辺")
    .replaceAll("邉", "辺")
    .toLocaleLowerCase("ja")
    .normalize("NFC");
}
export function identityCandidates(
  name: string,
  athletes: Athlete[],
): string[] {
  const key = normalizeName(name);
  return athletes
    .filter((a) =>
      [a.name, ...(a.aliases ?? [])].some(
        (alias) => normalizeName(alias) === key,
      ),
    )
    .map((a) => a.id)
    .sort();
}
export function validateIdentity(
  decision: IdentityDecision,
  athletes: Athlete[],
  sourceIds: Set<string>,
): void {
  if (!["legacy", "confirmed", "new", "needs-review"].includes(decision.status))
    throw new Error("Invalid identity status");
  if (!athletes.some((a) => a.id === decision.athleteId))
    throw new Error("Unknown identity target");
  if (!decision.reason.trim() || !decision.observedName.trim())
    throw new Error("Missing identity rationale");
  if (decision.candidateIds.some((id) => !athletes.some((a) => a.id === id)))
    throw new Error("Unknown identity candidate");
  if (decision.evidenceSourceIds.some((id) => !sourceIds.has(id)))
    throw new Error("Unknown identity evidence");
  if (
    decision.status === "confirmed" &&
    new Set(decision.evidenceSourceIds).size < 2
  )
    throw new Error("Cross-edition identity requires corroborating sources");
  if (
    decision.status === "needs-review" &&
    decision.candidateIds.includes(decision.athleteId)
  )
    throw new Error("Unconfirmed identity must remain separate");
}
