# 既有届次的受控补录

普通 `data:import` 继续拒绝同 ID、不同内容的届次或实体。本次新增的 `data:revise` 只允许填充既有 Entry 的空总用时与来源，以及追加新 Source、Entry、SectionResult、IdentityDecision 和 Registry 实体。它不能改变既有成绩、排名、选手ID、身份决定、来源或赛事区间信息，不是通用覆盖工具。

修订文件 `data/revisions/all-japan-2024-completeness.json` 保存原因、日期、届次/Registry 的修订前后 SHA-256、25项总用时差异以及新增实体完整值。哈希为解析后保序 `JSON.stringify` 的 UTF-8 SHA-256，数组/对象顺序变化也会触发冲突。原200条成绩的前后哈希另存于 `data/reports/all-japan-2024-revision.json`。其余十届文件的原始字节哈希保存在 `data/revisions/all-japan-2024-preservation.json`，基线提交为合并PR #13的 `f016bcab41206f70e2bc7cd1e1e13bc7c7248784`。

先阅读事实核验账、身份审核账与差异，再在干净分支执行：

```sh
npm run data:revise -- --input data/revisions/all-japan-2024-completeness.json
npm run data:revise -- --input data/revisions/all-japan-2024-completeness.json --write
node --experimental-strip-types scripts/data-revise.ts --input data/revisions/all-japan-2024-completeness.json > data/reports/all-japan-2024-revision.json
node --experimental-strip-types scripts/data-import.ts > data/reports/validation.json
```

没有 `--write` 仅预览。再次应用相同修订会完整重建并验证前后状态，返回 `changed:false`，不重复追加选手或成绩。所有11届在前后两种状态都验证通过后才写入；AJ2024旧批次豁免不能让新增记录跳过来源、状态、定位和非legacy身份检查。

回滚同样先预览，需要写入时再显式加 `--write`：

```sh
npm run data:revise -- --input data/revisions/all-japan-2024-completeness.json --rollback
npm run data:revise -- --input data/revisions/all-japan-2024-completeness.json --rollback --write
```

回滚只接受完全匹配的修订后届次及Registry，恢复新增前状态；有后续修订或漂移则拒绝。回滚后需同步重新生成报告、撤销对应统计和辅助证据文件；完整撤销PR可用Git revert保留审计历史。不要在混有其他修改的工作区执行回滚。

文件替换分别原子执行，并非跨文件事务。写入中断产生的部分状态会被拒绝，不能自动猜测修复；从Git恢复这两个配套数据文件至已知前/后状态，再复验。Manifest和`data/index.ts`不变，因为届次早已登记。未来修订须重新创建带新基线哈希的独立差异；现有受控工具不支持删除/更改既有成绩，正式成绩更正需要另行明确设计与审查。
