import type { PersonalBestPrecision } from "./athlete-facts.ts";

/** Shared normalized mark grammar; no prose, rounding, estimates or distance conversion. */
export function parsePerformanceTime(mark: string): { timeMilliseconds: number; precision: PersonalBestPrecision } {
  const parts = /^(\d+):([0-5]\d)(?::([0-5]\d))?(?:\.(\d{2}))?$/.exec(mark.trim());
  if (!parts) throw new Error("Expected M:SS or H:MM:SS, optionally .cc");
  const [, first, second, third, hundredths] = parts;
  const seconds = third === undefined
    ? Number(first) * 60 + Number(second)
    : Number(first) * 3600 + Number(second) * 60 + Number(third);
  const timeMilliseconds = seconds * 1000 + (hundredths === undefined ? 0 : Number(hundredths) * 10);
  if (!Number.isSafeInteger(timeMilliseconds) || timeMilliseconds <= 0) throw new RangeError("Invalid positive performance time");
  return { timeMilliseconds, precision: hundredths === undefined ? "second" : "centisecond" };
}
