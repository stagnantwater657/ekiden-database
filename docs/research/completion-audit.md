# Research completion audit（增量提案，待独立评审）

解决“结构正确但漏查就退出”，不改变已确认事实的证据门槛。PR #19 `22acc4f` 的报告列25字段，v2 JSON却只有15条 verified；8 candidate、1 conflict、1 not-found只留在文字报告。原校验器支持这些状态，但没有任务范围清单，无法发现根本没记入日志的字段；强校验集中在已采用 PB，未确认字段的退出缺少可执行约束。大学无个人PB总表被误解为大学来源 blocked；实际年度结果本来就可以满足大学来源类别。测试手写上下文遗漏 meets 是另一个独立问题。

## 两种检查，不能互相代替

1. `npm run research:validate`：原v1/v2结构、证据、候选/用时/届次一致性仍全部执行；验证新增完成度声明，显示 INCOMPLETE 或 NOT ASSESSED，不把诚实未完成的日志拒之门外。若声明 readyForReview=true但有遗漏，则失败。
2. `npm run research:complete -- <batchId>`：结束该研究批次前的退出检查。无范围清单或任一范围内字段不完整，退出1；充分检索后仍candidate/conflict/not-found可以通过。这个“通过”只表示已声明步骤满足离线约束，不表示证据为真、PB最新或独立审核通过。

CI通过不等于研究完成。兼容旧日志的CI可能成功，同时某批次的退出检查失败；PR必须同时报告两个结果，不能只贴绿色CI。执行者可以保存未完成工作，不得宣称完成或自行缩减已授权的研究范围来消除告警。

## 范围清单：不迁移旧日志、不重复保存候选

新增 `data/research/completion/<batchId>.json`，结构见[真实小样本](../../data/research/completion/2026-11-17-completion-demo.json)：

- `batchId`：已有v2批次；文件名匹配。
- `readyForReview`：显式声明已满足检索退出要求；未做完为false。独立复核不是这个布尔值。
- `scopeNote`：批准的选手、字段、截止日期和排除范围；不是“已搜全网”。
- `subjects`：每个计划字段列 athleteId、field、scope（原结构四项）、steps、nextActions。该批所有日志也必须在清单中；完整 tuple 一一对应，不能只记录verified。清单可先列尚未开展字段，审计会报missing-record，不得补造搜索。

候选仍在 records[].candidates；实际访问及检索在 searches；未通过原因在 unresolved 和 audit.limitations；需要时用 performances 记日期/赛事与采用比较，未知日期不强造performance。新增nextActions是可执行后续动作。四种主要状态使用同一个结构与完成度审计；not-found不可藏候选，conflict不可采用final，现有约束不变。

这是任务范围自述与日志的匹配，不是Git生产diff自动覆盖分析。独立审核仍需对照用户批准范围和生产事实清单，防止清单本身遗漏。

## 步骤与适用性

每步：`{kind,status,searchIndexes,alternativeSearchIndexes,reason}`。索引为本记录searches的零起始位置；不复制查询、不把建议词写成已执行。每个kind最多一项，可引用多次查询、多个日期与多个来源。

| kind | 目的及要求 |
| --- | --- |
| exact-value / alternate-value | 已知PB逐候选检查“姓名+完整值”“姓名+不同写法”；query必须真实包含注册姓名（忽略空格）及相应值。接受标准时间首段及日文分秒、引号格式；不是模糊相似名字匹配。每个已知候选都查，不允许用N/A忽略已知值。 |
| event-year | 姓名+项目+相关年份。项目接受5000m/10000m及メートル、半马/ハーフ/half-marathon。年份是否正确及覆盖足够由审核者确认。 |
| university-ranking / university-results | 分别检查大学历代表与历年结果。无PB总表不代表整个大学没有资料；从年度结果、旧年份/域名与正式附件继续查。 |
| employer-profile / employer-results | 截止日期已毕业或所属未知者查当前所属档案与比赛结果；在校历史时点不要求未来雇主。个人职业跑者可解释雇主不适用，但需实际发现证据，继续查本人/赛事资料。 |
| organizer-results | 赛事主办方或正式成绩PDF；已由明确大学一手结果完整支持时可说明原件尚未取得、该路径不再追加的理由与实际证据，不强迫所有网站都可访问。 |
| personal-profile / federation-results / database / media | 分别记录个人、田联、数据库、媒体路径。补充路径按线索添加，不为数量凑访问。R22有地方陆协榜，必须纳入实际计划，不可只查WA。 |

PB默认评估前三类检索及大学两入口、主办方；毕业/所属未知再评估雇主两入口。无候选不要求精确值和不同格式反查，但仍评估适用来源及年份。传记字段评估本人/大学/雇主，允许一份完整官方简介足够、不需要无关比赛；不用PB更新流程。

- searched：有实际执行查询。命中来源的类别路径须读到该类别的具体页面；搜索摘要不能冒充已读。真实无命中查询可以记录完成，不证明没有成绩。
- blocked：有具体unavailable URL、实际错误（放在finding/reason），并关联**另一次已执行**替代检索。不可只写“访问失败”；替代同样全失败则仍不充分。旧页404可查允许访问的其他年份/正式新域名，不绕过限制。
- not-applicable：具体原因；默认必评估路径还须关联发现证据。已知值不能免除反查。没有PB表可基于实际导航解释ranking不适用，results仍查。核心身份/项目冲突不能用N/A放行。
- not-started：诚实保存未做步骤，必报INCOMPLETE。省略默认步骤同样告警，不因status=candidate就跳过。

该方案不实现自然语言理解：理由、页面实际内容、查询是否完整仍须独立复核。伪写query/分类、隐藏候选、错误豁免不会因增加字段而自动变真。

## 来源分类与独立性

v2 searches[].sources[]可增加`category`：athlete（本人/个人）、university、employer、competition（主办方）、federation、database、media。按发布者分类，不按页面里提到哪所大学。完成度路径的已读来源必须有类别；旧日志未分类显示unclassified，不自动猜测。大学年度结果仍属university，不必有个人PB表。

旧audit.coverage的五项（official合并赛事/田联）保留以免破坏v2。新访问的细分类与实际查询直接关联；不强迫七类都访问。原originKey谱系检查不变：学校榜与同校报告、GMO多个域名新闻、第三方转载不能机械累计独立来源。一个官方页面可支持值、日期、赛事；不强制两个独立来源。

## 赛事上下文与兼容

CLI及使用真实注册实体的测试统一调用 `createResearchContext()`，自动注入已校验meets。v2遗漏meets明确报配置错误，不再误报某个有效metadataId未知；合成测试可显式提供专用目录。已匹配ID或精确官方URL的届数仍不允许null/pending降级；未知赛事仍允许诚实pending。目录内容本轮未扩展。

v1冻结哈希、原v2 JSON与证据规则不改；旧v2不必补category或完成清单，不把老访问假装符合新规范。新建/续查任务写新的v2日志及清单，保留旧记录；没有清单明确NOT ASSESSED，退出检查失败。纯传记和未确认日期可继续留候选。研究日志不是生产资料，本轮没有生产事实变更。

## 给DSH的执行要求

1. 开始时按授权名单和字段声明全部scope，不只列最后成功的字段；禁止启动未授权候选16–20。
2. 已知值先做精确/异格式反查；优先进入大学历代表及具体年份结果。毕业者核实当前所属与结果；无表≠blocked，404≠不存在。
3. 只记录实际搜索、读取、失败及替代；未知字段留null，所有未确认字段仍写v2记录、原因和下一步。不得因校验报错把已知届数改pending。
4. 将发现的更快成绩纳入比较，后来的慢成绩不是PB更新；同源转载不计独立证据。
5. 分别运行research:validate与research:complete；后者未通过可交付进度，不得宣称研究完成。PR列所有生产事实到batchId/athleteId/field/scope、未覆盖项、未确认项及独立复核状态。
6. 通过离线检查后由ChatGPT/维护者重新联网独立复核。此提案尚待审核，不授权数据导入、合并或部署。
