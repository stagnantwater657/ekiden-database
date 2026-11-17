# DSH / Codex 可复用启动模板

将以下文本中的方括号替换为具体任务，不预填任何“已检索”结论：

> 仓库 stagnantwater657/ekiden-database。先检查最新 main、目标分支和未提交修改，读取根 AGENTS.md、research Playbook、来源目录、v2 日志契约及适用数据契约。研究范围：[稳定 athleteId、字段、历史届次/路线、PB截止日期]；允许修改：[文件/分支]；不修改：[保护的数据/其他PR]。
>
> 执行大学→毕业后实业团→赛事官方/地方陆协→可靠数据库→专业媒体的适用分层检索。每字段完成候选发现、精确值反查、身份/赛事/日期/精度/更新核验。只记录真实执行的关键词、具体栏目、访问结果和定位；遇到限制不绕过。把 candidate、not-found、conflict 与 verified-absent 分开。
>
> 保存本轮真实批次日志，正式采用的事实绑定 Source ID；不自动生成旧访问记录。用适用回归案例检验检索过程，运行 research:validate、data:validate、npm test、typecheck、lint、build、test:e2e。PR 报告新增事实、缺口、错误、规则建议、日志覆盖与独立复核状态，不把 CI 当作证据充分性或最新 PB 的证明。不自动合并或部署。

## PR #19 的后续接入步骤

1. 本规范经评审合并后，由 PR #19 执行者在 `feat/athlete-pb-batch2` 整合 main；本 PR 不代为操作。
2. 对 PR #19 尚未合并的新增/修改事实逐项对照生产 diff，建立本轮日志。既有 PR #18 不要求全量补查。
3. 按适用的 R1–R23 实际重新核查，尤其第77回届数、毕业后PB更新、半马正式距离；使用真实核验日期，不把本 PR 提供的链接清单当自己的访问日志。
4. 补完事实所需 Source 登记及定位；未能解决的保留 candidate/not-found/conflict。事实/Source修改仍属于 PR #19，不能为降低工作量放松证据门槛。
5. 运行完整检查，补齐批次复盘与日志覆盖清单，交独立复核者评审后再由维护者决定合并；执行者不自批。

## DSH 的 v2 操作步骤（待框架独立评审后使用）

1. 不改旧 v1 日志，本轮不执行候选16–20；明确获得下一批任务后才开始。先读 audit-v2.md，列出 athleteId、字段、截至日期及历史/当前口径。
2. 候选发现时记录原始值和取得日。每次实际查询即时记 searches，不复制 fixture 或其他执行者的访问声明。
3. 登记具体 Source；在 audit.evidence 为每份来源独立写 role、支持字段、定位、检查状态、原始内容谱系。未检查写 unverified，不把来源存在当已核验。
4. 填五类 coverage、毕业状态与当前所属；在校实业团填不适用及理由。对 PB 填候选 event（举办日、比赛日、项目/距离、届数）及 performances；已知目录用 metadataId 并保持确认届数；只有未匹配已登记赛事的未知届数可用 pending/null。
5. 追查原候选之后至目标截止日的资料，pbUpdate.checks 引用实际查询和证据；大学/适用实业团都需后续检查。记录更快候选，解释最终采用或排除，受阻与未完成路径如实保留。
6. 每个新/修改生产事实在 PR 清单对应 batchId、athleteId、field、scope。单一谱系、转载、主办方原件缺失和独立复核状态逐项报告。
7. 用 schemaVersion=2 保存所有状态的新日志及 completion 范围清单，分别运行 research:validate、research:complete -- <batchId> 和完整校验。CLI 的 legacy/单源/coverage 提示不是批准；交独立审核，不自行合并/部署。

## 检索完成度增量（待本轮独立评审）

新增任务按[completion audit契约](completion-audit.md)列全部授权字段，未确认字段也保存v2日志及下一步。运行 `npm run research:complete -- <batchId>`；结构校验/CI通过不能代替退出检查或独立证据复核。大学无个人PB表时继续查历代表及年度结果；毕业后查当前所属。CLI和真实实体测试使用 `createResearchContext()`，不得以pending替代已知届次。旧日志无须追造历史，明确未评估。
