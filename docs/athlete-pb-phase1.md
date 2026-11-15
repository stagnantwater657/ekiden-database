# PR #18 · 选手档案与个人最佳成绩（第一阶段）

本阶段只建立可信资料的接入能力，不改动 11 届赛事的原始成绩、身份决策和奖项数据。不以驿传区间成绩推算个人最佳，也不把公路 10 km 当成场地 10000 m。

## 首批用户指定的五位选手

| 选手 | 稳定 athleteId |
| --- | --- |
| 佐藤 圭汰 | `athlete-aj25-02-7` |
| 黒田 朝日 | `athlete-aj24-03-4` |
| 伊藤 蒼唯 | `athlete-aj24-02-3` |
| 山口 智規 | `athlete-aj24-05-2` |
| 溜池 一太 | `athlete-aj24-12-1` |

这些 ID 在现有注册表中已存在；但仍须依据大学、赛事、年龄等独立资料确认外部 PB 归属，不能单纯根据同名匹配。身份有 `needs-review` 决策的选手暂不导入个人资料。

## 资料交付契约

DSH 将已核实的事实补充到 `data/presentation/athlete-profiles.json` 的 `profiles` 数组中。文件中的 `schemaVersion` 保持 `1`。每条个人资料须有：

- `athleteId`：仓库已有稳定 ID；`reviewedAt`：核验日期 `YYYY-MM-DD`。
- `personalBests`：只收录已验证项目，未验证项目**不创建记录**。
- 每项 PB 的 `event` 仅允许 `5000m`、`10000m`、`half-marathon`；每位选手每项最多一条。
- `timeMilliseconds`：整数毫秒，须保留原始精度；`precision`：来源印刷到整秒时填 `second`，精确到百分秒时填 `centisecond`（毫秒值必须是 10 的倍数）。
- `achievedOn`：创造成绩日期；`meet`：实际赛事名称；`sourceId`、`locator`、`revision`：成绩来源及页面、行或表格定位。
- 可选 `birthDate` 与 `highSchool` 均为 `{value,sourceId,locator,revision}`，无可靠来源则完全省略。

发现新的官方来源时，在 `data/presentation/sources.json` 增加完整的 `Source`，包含 URL、覆盖范围、来源定位、版本、采集时间和使用条件核查信息（`usage`）。不要上传整份受版权保护的 PDF，不要强行合并同名选手，也不要用仅标注 SB 的成绩冒充 PB。

当前发布数据中的 `profiles` 为空，**五位选手只是待研究名单，尚无任何经过核验的个人 PB**。单元测试里的虚构成绩只用于验证格式，不属于发布数据。

## 交接与验收

1. Codex 维护类型、时间格式、页面展示、来源链接和数据校验。
2. DSH 先核查上表五位，再扩展至最多 30 位候选；每位交付姓名、大学/身份佐证、各项目的已确认事实与来源，明确未查证项目。
3. Codex 对事实做代码接入、单元测试和 Playwright 页面验证。区间成绩、大学历史和现有身份数据不得被自动改写。
4. 运行 `npm run data:validate`、`npm test`、`npm run typecheck`、`npm run lint`、`npm run build`、`npm run test:e2e`，确认 PB 缺失态、精度、来源、赛事日期与移动端均正常。
5. 在 PR 中汇报调查人数、各项目已核验数、缺失数、身份待审核数与来源。PR 不自动合并，不触发部署。
