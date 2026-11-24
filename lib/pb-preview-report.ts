import { formatPersonalBest } from "./athlete-facts.ts";
import type { PbPreviewReport } from "./pb-preview.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// All input is text: no active HTML, links or table syntax in generated review Markdown.
const cell = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/\|/g, "&#124;").replace(/\r?\n/g, "<br>").replace(/[\\`*_\[\]]/g, "\\$&");
const labels = { "new-candidate": "新增候选", "faster-candidate": "更快候选", "same-time": "同成绩", slower: "更慢",
  "identity-conflict": "身份冲突", invalid: "无效", "needs-evidence": "待补证据", duplicate: "重复", "multiple-results": "同场多成绩" };
export function renderPbReview(report: PbPreviewReport): string {
  const { summary: s } = report;
  const lines = ["# PB CSV 人工审核报告", "", `模式：dry-run；研究截止日：${report.asOf}。全部记录待人工审核，未写入生产数据。`, "",
    `输入 ${s.inputRecords}；匹配 ${s.matched}；更快 ${s.faster}；新增候选 ${s.newCandidates}；同成绩 ${s.sameTime}；更慢 ${s.slower}；重复 ${s.duplicates}；身份冲突 ${s.identityConflicts}；无效 ${s.invalid}；待补证据 ${s.needsEvidence}；同场多成绩 ${s.multipleResults}。`,
    "", "状态可重叠，统计不相加；匹配只代表注册 ID 与历史姓名/大学关系相符。", "",
    "| 行 | 选手 | 项目 | 现有成绩 | 输入成绩 | 判断 |", "| --- | --- | --- | --- | --- | --- |"];
  for (const r of report.rows) lines.push(`| ${r.row} | ${cell(r.input.name)} | ${cell(r.input.event)} | ${r.existingPb ? formatPersonalBest(r.existingPb) : "—"} | ${cell(r.performance.time)} | ${r.statuses.map((v) => labels[v]).join("、") || "待人工匹配"}；待核验 |`);
  lines.push("", "## 逐行定位与缺口", "");
  for (const r of report.rows) {
    const detail = [...r.errors, ...r.evidenceGaps, ...r.identity.reasons];
    lines.push(`- 行 ${r.row}（CSV 起始行 ${r.line}）：${cell(r.matchedAthleteId ?? "未确认身份")}；${cell(r.performance.achievedOn ?? "缺少有效日期")}；${cell(r.performance.meet || "缺赛事")}；来源 ${cell(r.source.inputUrl || "缺来源")}。`);
    if (detail.length) lines.push(`  缺口：${[...new Set(detail)].map(cell).join("；")}。`);
    if (r.duplicateOf.existingPb || r.duplicateOf.inputRows.length) lines.push(`  重复参照：${r.duplicateOf.existingPb ? "数据库 PB；" : ""}输入行 ${r.duplicateOf.inputRows.join(", ") || "无"}。`);
    if (r.relatedRows.length) lines.push(`  相关输入行：${r.relatedRows.join(", ")}，保留原行，不自动选最快值。`);
  }
  lines.push("", "## 审核边界", "", ...report.limitations.map((v) => `- ${v}`), "");
  return lines.join("\n");
}

/** Reserve a NEW directory exclusively. Never overwrite an existing path, including symlinks. */
export function writePbReview(report: PbPreviewReport, outputDirectory: string): void {
  const directory = resolve(outputDirectory);
  const json = JSON.stringify(report, null, 2) + "\n", markdown = renderPbReview(report);
  mkdirSync(directory); // Existing directory/file/symlink fails before either report is touched.
  // On disk/permission errors leave the partial new directory visible; never remove user files.
  writeFileSync(join(directory, "review.json"), json, { flag: "wx" });
  writeFileSync(join(directory, "review.md"), markdown, { flag: "wx" });
}
