export function seasonYearFor(raceId: string, year: number): number {
  if (!Number.isInteger(year)) throw new Error("Invalid year");
  if (raceId === "hakone") return year - 1;
  if (raceId === "all-japan" || raceId === "izumo") return year;
  throw new Error("Unknown race season convention");
}
