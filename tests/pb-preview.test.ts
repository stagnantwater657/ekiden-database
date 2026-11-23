import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parsePbCsv, pbCsvColumns, type PbCsvInput } from "../lib/pb-csv.ts";
import { previewPbCsv, type PbPreviewContext } from "../lib/pb-preview.ts";
import { renderPbReview, writePbReview } from "../lib/pb-preview-report.ts";
import { parsePerformanceTime } from "../lib/performance-time.ts";

const source = { id: "synthetic-source", title: "SYNTHETIC, never fetched", url: "https://synthetic-pb-fixture.org/results?id=3", collectedAt: "2026-11-20", locator: "synthetic only", coverage: "synthetic" };
function context(): PbPreviewContext {
  return { sources: [source], database: { schemaVersion: 2, sources: [source], races: [], sections: [],
    athletes: [
      { id: "synthetic-a", name: "試験 高一", birthDate: null, sourceId: source.id },
      { id: "synthetic-b", name: "試験 高一", birthDate: null, sourceId: source.id },
      { id: "synthetic-c", name: "別名 試験", aliases: ["別名テスト"], birthDate: null, sourceId: source.id },
    ],
    universities: [{ id: "uni-a", name: "試験甲大", sourceId: source.id }, { id: "uni-b", name: "試験乙大", sourceId: source.id }],
    teams: [{ id: "team-a", name: "試験甲大学", universityId: "uni-a", kind: "university", sourceId: source.id }],
    editions: [{ id: "synthetic-edition", date: "2024-01-01", raceId: "synthetic-race", year: 2024, seasonYear: 2023, number: 1, officialName: "synthetic meet", distanceKm: 1, sourceId: source.id }],
    entries: ["a", "b", "c"].map((id) => ({ id: `entry-${id}`, editionId: "synthetic-edition", teamId: "team-a", universityId: id === "b" ? "uni-b" : "uni-a", finalRank: null, finalRankSourceId: null, totalTimeSeconds: null, totalTimeSourceId: null, status: "unknown", sourceId: source.id })),
    results: ["a", "b", "c"].map((id) => ({ id: `result-${id}`, athleteId: `synthetic-${id}`, entryId: `entry-${id}`, sectionId: "section-1", timeSeconds: null, rank: null, sourceId: source.id })), identities: [] },
    profiles: [{ athleteId: "synthetic-a", reviewedAt: "2026-11-20", personalBests: [{ event: "10000m", timeMilliseconds: 1700020, precision: "centisecond", achievedOn: "2025-05-20", meet: "SYNTHETIC old meet", sourceId: source.id, locator: "synthetic row", revision: "synthetic" }] }] };
}
const row: PbCsvInput = { athleteId: "synthetic-a", name: "試験高一", university: "試験甲大", event: "10000m", time: "28:07.63", date: "2026-05-21", meet: "SYNTHETIC meet", sourceUrl: source.url };
const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
const csv = (items: Partial<PbCsvInput>[] = [{}]) => pbCsvColumns.join(",") + "\n" + items.map((v) => pbCsvColumns.map((k) => quote(({ ...row, ...v })[k])).join(",")).join("\n") + "\n";
const preview = (items: Partial<PbCsvInput>[] = [{}], ctx = context(), asOf = "2026-11-20") => previewPbCsv(csv(items), ctx, asOf);

test("compare faster, slower, same-time and a missing PB without changing the context", () => {
  const ctx = context(), before = structuredClone(ctx);
  const report = preview([{}, { time: "29:00.12" }, { time: "28:20.02" }, { event: "5000m", time: "14:00.00" }], ctx);
  assert.deepEqual(report.rows.map((r) => r.comparison), ["faster-candidate", "slower", "same-time", "new-candidate"]);
  assert.deepEqual(ctx, before); assert.equal(report.summary.matched, 4);
  assert.ok(report.rows.every((r) => r.needsManualReview)); assert.equal(report.mode, "dry-run");
});

test("normalized time grammar preserves second/centisecond precision, including .00 and half marathon", () => {
  for (const [text, ms, precision] of [["28:07.63", 1687630, "centisecond"], ["1:00:13", 3613000, "second"], ["60:13.00", 3613000, "centisecond"], [" 13:00 ", 780000, "second"]] as const)
    assert.deepEqual(parsePerformanceTime(text), { timeMilliseconds: ms, precision });
  const r = preview([{ event: "half-marathon", time: "60:13.00" }]).rows[0];
  assert.equal(r.performance.time, "1:00:13.00"); assert.equal(r.performance.precision, "centisecond");
  for (const time of ["28:60", "1:60:01", "28.07.63", "28:07.6", "-1:00", "0:00", "13:00; meet", "9007199254740991:00", "", "Infinity"])
    assert.ok(preview([{ time }]).rows[0].statuses.includes("invalid"), time);
});

test("ISO dates reject nonexistent days, future dates and unsupported event; missing dates are evidence gaps", () => {
  for (const date of ["2025-02-29", "2026-13-01", "2026/05/21", "2026-11-21"])
    assert.ok(preview([{ date }]).rows[0].statuses.includes("invalid"), date);
  const missing = preview([{ date: "", sourceUrl: "", meet: "" }]).rows[0];
  assert.equal(missing.comparison, "faster-candidate"); assert.ok(missing.statuses.includes("needs-evidence"));
  assert.deepEqual(missing.evidenceGaps, ["missing-date", "missing-meet", "missing-source-url"]);
  assert.ok(preview([{ event: "10km" }]).rows[0].statuses.includes("invalid"));
  assert.throws(() => preview([], context(), "2026-02-30"), /calendar/);
  assert.equal(preview([{ date: "2026-11-20" }]).rows[0].comparison, "faster-candidate");
});

test("same-name athletes are resolved by ID and university, never name-only or invalid-ID fallback", () => {
  const a = preview().rows[0], b = preview([{ athleteId: "synthetic-b", university: "試験乙大学" }]).rows[0];
  assert.equal(a.matchedAthleteId, "synthetic-a"); assert.equal(b.matchedAthleteId, "synthetic-b");
  assert.equal(b.comparison, "new-candidate");
  const noId = preview([{ athleteId: "" }]).rows[0];
  assert.equal(noId.matchedAthleteId, null); assert.deepEqual(noId.identity.candidateIds, ["synthetic-a", "synthetic-b"]);
  assert.equal(noId.comparison, null); assert.ok(noId.statuses.includes("needs-evidence"));
  assert.ok(preview([{ athleteId: "unknown" }]).rows[0].statuses.includes("identity-conflict"));
});

test("ID conflicts with name or a registered university block comparison; missing auxiliary identity is explicit", () => {
  for (const data of [{ name: "違う選手" }, { university: "試験乙大" }]) {
    const r = preview([data]).rows[0]; assert.ok(r.statuses.includes("identity-conflict")); assert.equal(r.comparison, null);
  }
  for (const data of [{ name: "" }, { university: "" }, { university: "SYNTHETIC corporate team" }]) {
    const r = preview([data]).rows[0]; assert.ok(r.statuses.includes("needs-evidence")); assert.equal(r.matchedAthleteId, null);
  }
});

test("space normalization and registered aliases work; unregistered kanji variants require review", () => {
  assert.equal(preview([{ name: "試験　 高一", university: "試験甲大学" }]).summary.matched, 1);
  const variant = preview([{ name: "試験髙一" }]).rows[0];
  assert.equal(variant.identity.status, "needs-review"); assert.equal(variant.comparison, null);
  const ctx = context(); ctx.database.athletes[0].aliases = ["試験髙一"];
  assert.equal(preview([{ name: "試験髙一" }], ctx).summary.matched, 1);
  assert.equal(preview([{ athleteId: "synthetic-c", name: "別名テスト" }]).summary.matched, 1);
});

test("unresolved registry identity, transfers and future-only affiliations cannot be silently accepted", () => {
  const ctx = context();ctx.database.identities.push({ recordId: "r", athleteId: "synthetic-a", observedName: row.name, status: "needs-review", candidateIds: [], evidenceSourceIds: [], reason: "synthetic unresolved" });
  assert.equal(preview([{}], ctx).summary.matched, 0);
  const transfer = context();transfer.database.results.push({ ...transfer.database.results[0], id: "transfer", representingUniversityId: "uni-b" });
  assert.equal(preview([{}], transfer).summary.matched, 0);
  assert.equal(preview([{ date: "2023-01-01" }]).summary.matched, 0);
});

test("same time on a different date/meet is not a duplicate; matching date+label+precision is", () => {
  const report = preview([{ time: "28:20.02" }, { time: "28:20.02", date: "2025-05-20", meet: "SYNTHETIC old meet" }]);
  assert.equal(report.rows[0].sameMeet, false); assert.equal(report.rows[0].duplicateOf.existingPb, false);
  assert.equal(report.rows[1].sameMeet, true); assert.equal(report.rows[1].duplicateOf.existingPb, true); assert.equal(report.summary.duplicates, 1);
  assert.equal(preview([{ time: "28:20.02", date: "" }]).rows[0].sameMeet, null);
});

test("input duplicates remain visible; alternate sources do not multiply performance counts silently", () => {
  const r = preview([{}, {}, { sourceUrl: "https://synthetic-pb-fixture.org/another" }]);
  assert.equal(r.rows.length, 3); assert.equal(r.summary.duplicates, 2);
  assert.deepEqual(r.rows[2].duplicateOf.inputRows, [1, 2]);
  const incomplete = preview([{ athleteId: "", date: "", time: "bad" }, { athleteId: "", date: "", time: "bad" }]);
  assert.equal(incomplete.summary.duplicates, 1);assert.equal(incomplete.summary.invalid, 2);
});

test("same athlete/event/date/meet with different marks flags every row; never silently selects the fastest", () => {
  const r = preview([{}, { time: "27:59.99" }, { event: "5000m", time: "13:40.00" }]);
  assert.equal(r.summary.multipleResults, 2); assert.equal(r.rows.length, 3);
  assert.ok(r.rows.slice(0, 2).every((v) => v.statuses.includes("needs-evidence")));
  assert.equal(r.rows[2].statuses.includes("multiple-results"), false);
  const oldMeet = preview([{ date: "2025-05-20", meet: "SYNTHETIC old meet" }]);
  assert.ok(oldMeet.rows[0].statuses.includes("multiple-results"));
});

test("future baseline, indoor PB and verified absence are not silently reinterpreted", () => {
  const ctx = context();ctx.profiles[0].personalBests[0].achievedOn = "2026-11-21";
  const r = preview([{}], ctx).rows[0]; assert.equal(r.comparison, null);assert.ok(r.statuses.includes("needs-evidence"));
  ctx.profiles[0].personalBests[0].achievedOn = "2025-05-20";ctx.profiles[0].personalBests[0].indoor = true;
  assert.ok(preview([{}], ctx).rows[0].evidenceGaps.some((v) => v.includes("indoor")));
  ctx.profiles[0].absentEvents = [{ event: "half-marathon", note: "SYNTHETIC verified absence" }];
  assert.ok(preview([{ event: "half-marathon", time: "1:03:00" }], ctx).rows[0].evidenceGaps.some((v) => v.includes("verified-absence")));
});

test("source URL check accepts result query parameters, rejects placeholders/credentials without fetching", () => {
  assert.deepEqual(preview().rows[0].source.registeredSourceIds, [source.id]);
  for (const sourceUrl of ["https://example.org/result", "file:///tmp/result", "https://synthetic-pb-fixture.org/?sig=secret", "broken"])
    assert.ok(preview([{ sourceUrl }]).rows[0].evidenceGaps.includes("invalid-public-source-url"));
  assert.equal(preview([{ sourceUrl: source.url + "#row4" }]).rows[0].source.canonicalUrl, source.url);
});

test("CSV supports BOM, CRLF, reordered headers, quoted commas, escaped quotes and multiline meet", () => {
  const value = 'SYNTHETIC, "final"\nmeet';
  const parsed = parsePbCsv("\uFEFF" + csv([{ meet: value }]).replaceAll("\n", "\r\n"));
  assert.equal(parsed.length, 1); assert.equal(parsed[0].input.meet, value);assert.equal(parsed[0].line, 2);
  const headers = [...pbCsvColumns].reverse();
  assert.deepEqual(parsePbCsv(headers.join(",") + "\n" + headers.map((k) => quote(row[k])).join(","))[0].input, row);
  assert.equal(parsePbCsv(pbCsvColumns.join(",") + "\n").length, 0);
});

test("malformed CSV does not shift columns or drop broken records", () => {
  for (const data of ["", csv().replace("athleteId,name", "name,name"), csv() + '"unclosed', csv() + "a,b\n", csv() + '""\n', csv() + 'abc"def\n', csv() + '"abc"x\n', csv().replace("athleteId", "unknown")])
    assert.throws(() => parsePbCsv(data), /CSV/);
});

test("Markdown treats input as text and output directory cannot be overwritten", () => {
  const report = preview([{ meet: '<script>x</script>|[click](https://evil.invalid)\nrow' }]);
  const markdown = renderPbReview(report);
  assert.doesNotMatch(markdown, /<script>/);assert.match(markdown, /&lt;script&gt;/);assert.match(markdown, /&#124;/);
  const dir = mkdtempSync(join(tmpdir(), "pb-preview-report-")), out = join(dir, "review");
  try {
    writePbReview(report, out);const before = readFileSync(join(out, "review.json"));
    assert.throws(() => writePbReview(preview(), out), /EEXIST/);
    assert.deepEqual(readFileSync(join(out, "review.json")), before);
    assert.equal(JSON.parse(before.toString()).rows[0].needsManualReview, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const hash = (s: Buffer) => createHash("sha256").update(s).digest("hex");
function dataHashes(path = resolve("data")): Record<string, string> {
  return Object.fromEntries(readdirSync(path, { withFileTypes: true }).flatMap((d): [string, string][] => {
    const target = join(path, d.name); return d.isDirectory() ? Object.entries(dataHashes(target)) : [[target, hash(readFileSync(target))]];
  }));
}
test("real CLI is dry-run only, reports invalid rows, rejects --write and leaves ALL production data unchanged", () => {
  const dir = mkdtempSync(join(tmpdir(), "pb-preview-cli-")), input = join(dir, "input.csv"), out = join(dir, "review");
  const before = dataHashes();
  const run = (args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", "scripts/pb-csv-preview.ts", ...args], { encoding: "utf8" });
  try {
    // Synthetic IDs deliberately remain unknown to the production registry; no fixture injection into CLI.
    writeFileSync(input, csv([{}, { time: "bad" }]));
    const args = ["--input", input, "--as-of", "2026-11-20", "--out", out];
    const result = run(args);assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(join(out, "review.json"), "utf8"));
    assert.equal(report.summary.inputRecords, 2);assert.equal(report.summary.identityConflicts, 2);assert.equal(report.summary.invalid, 1);
    assert.equal(report.inputFile.sha256, hash(readFileSync(input)));assert.equal(report.baselineSha256.length, 64);
    assert.equal(run(args).status, 1);assert.equal(run([...args, "--write"]).status, 1);
    const badInput = join(dir, "bad.csv");writeFileSync(badInput, "malformed");
    assert.equal(run(["--input", badInput, "--as-of", "2026-11-20", "--out", join(dir, "bad-review")]).status, 1);
    assert.deepEqual(dataHashes(), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
