# Research completion audit（增量提案，待独立评审）

解决“结构正确但漏查就退出”，不改变已确认事实的证据门槛。PR #19 `22acc4f` 的报告列25字段，v2 JSON却只有15条 verified；8 candidate、1 conflict、1 not-found只留在文字报告。原校验器支持这些状态，但没有任务范围清单，无法发现根本没记入日志的字段；强校验集中在已采用 PB，未确认字段的退出缺少可执行约束。大学无个人PB总表被误解为大学来源 blocked；实际年度结果本来就可以满足大学来源类别。测试手写上下文遗漏 meets 是另一个独立问题。

## 两种检查，不能互相代替

1. `npm run research:validate`：原v1/v2结构、证据、候选/用时/届次一致性全部保留；检查步骤声明并展示未完成/未送审/授权未评估。`readyForReview=false`可以保存进度，步骤完整但尚未声明送审也不报错。`readyForReview=true`却有步骤遗漏仍报错。普通校验不要求给旧日志补授权，不能因此声明已获准送审。
2. `npm run research:complete -- <batchId> --authorization <owner-scope.json> --authorization-sha256 <owner-provided-sha256>`：严格退出检查。必须同时满足步骤完整、执行者声明送审、独立授权集合与plan及records完全相符，才退出0。充分检索后的candidate/conflict/not-found仍可以送审；通过不等于证据为真或独立审核通过。缺少外部授权参数时仍可运行查看进度，但退出1。

返回值不再使用含义混杂的`complete`，而是：

| 状态 | 含义 |
| --- | --- |
| stepsComplete | 已记录范围内的步骤/字段检查是否无阻断问题 |
| readyForReview | 执行者在plan中明确声明送审；false输出NOT SUBMITTED，不被推断成true |
| authorizationComplete | 独立授权的全部tuple与plan、records完全匹配；未提供授权为false |
| exitAllowed | 上面三者全部true；输出明确独立证据复核仍待完成 |
| manualChecks | not-applicable及blocked的语义相关性、合理性待人工复核；不是事实校验通过 |

CI通过不等于研究完成。普通兼容CI可能成功而严格退出检查失败；PR必须分别报告。不得把自动检查通过称为已经向某个人或系统正式发送审查请求；本工具不发消息。

## 独立授权范围与信任边界

授权JSON由任务发起者/维护者在研究结果之外定义和审阅，不能由执行者从completion plan或已成功的records反向生成。文件位置不由plan选择；CLI通过独立参数接收文件，并以任务发起者在派工说明/评审中固定的SHA-256验证原始字节。CLI打印采用的摘要，交接/PR必须列出任务发起者提供的预期摘要及授权引用，以便独立对照。修改字段或用空格替换字节都会使原摘要校验失败；不得在失败后自行重算摘要来放行。

授权结构：`{schemaVersion:1,batchId,authorizedBy,reference,authorizedAt,assignments}`。

- reference为可审阅的公开派工/批准URL，authorizedAt为实际授权日，不能倒填。
- assignments中每组为`{athleteIds,fields,scope}`；组内展开完整的“选手×字段”笛卡尔积，scope沿用asOf/editionId/courseVersion/sectionNumber。多组可以给不同选手授权不同字段；不会机械补成五项。空集合、重复授权tuple、无效字段/日期/范围被拒绝。
- 每个授权tuple必须**分别**存在于plan.subjects和batch.records；两处同时少10项也会报各10项遗漏。记录或plan超出授权、改变截止日期/届次/路线也不能通过。
- `authorizedBy`与reference是来源声明，不是签名认证；SHA-256固定内容，不能认证授权人的身份。调用方必须从独立可信的派工/评审取得文件和预期摘要。若执行者可以同时篡改文件、命令参数及派工依据，离线工具无法阻止，独立审核必须比对。此PR不修改CI/分支权限，不声称实现防恶意操作者的授权服务。
- 程序API的第三参数同样是可信调用方提供的独立授权，不能传入从plan导出的对象来充当授权。正式CLI使用校验摘要的加载器。

本轮没有为任何历史批次新造授权文件；旧v1/v2保持可读，授权缺失显示NOT ASSESSED并拒绝严格退出。原两项示范继续保持旧日志和未提交状态。后续任务先取得明确的新授权再执行，不追造过去的批准。

## 范围清单：不迁移旧日志、不重复保存候选

新增 `data/research/completion/<batchId>.json`，结构见[真实小样本](../../data/research/completion/2026-11-17-completion-demo.json)：

- `batchId`：已有v2批次；文件名匹配。
- `readyForReview`：显式声明已满足检索退出要求；未做完为false。独立复核不是这个布尔值。
- `scopeNote`：执行者对选手、字段、截止日期和排除范围的说明（不构成授权）；不是“已搜全网”。
- `subjects`：每个计划字段列 athleteId、field、scope（原结构四项）、steps、nextActions。该批所有日志也必须在清单中；完整 tuple 一一对应，不能只记录verified。清单可先列尚未开展字段，审计会报missing-record，不得补造搜索。

候选仍在 records[].candidates；实际访问及检索在 searches；未通过原因在 unresolved 和 audit.limitations；需要时用 performances 记日期/赛事与采用比较，未知日期不强造performance。新增nextActions是可执行后续动作。四种主要状态使用同一个结构与完成度审计；not-found不可藏候选，conflict不可采用final，现有约束不变。

subjects是执行计划，不是授权源。严格退出还要与上述独立授权集合比较；普通校验无授权时不能认证完整性。本工具不进行Git生产diff覆盖分析。

## 步骤与适用性

每步：`{kind,status,searchIndexes,alternativeSearchIndexes,reason}`。索引为本记录searches的零起始位置；不复制查询、不把建议词写成已执行。每个kind最多一项，可引用多次查询、多个日期与多个来源。

| kind | 目的及要求 |
| --- | --- |
| exact-value / alternate-value | 已知PB逐候选检查“姓名+完整值”“姓名+不同写法”；query必须真实包含注册姓名（忽略空格）及相应值。接受标准时间首段及日文分秒、引号格式；不是模糊相似名字匹配。每个已知候选都查，不允许用N/A忽略已知值。 |
| event-year | 姓名+项目+相关年份。项目接受5000m/10000m及メートル、半马/ハーフ/half-marathon。年份是否正确及覆盖足够由审核者确认。 |
| university-ranking / university-results | 分别检查大学历代表与历年结果。无PB总表不代表整个大学没有资料；从年度结果、旧年份/域名与正式附件继续查。 |
| employer-profile / employer-results | 每项PB显式评估两个入口，不能靠省略表达N/A。毕业/所属未知者查实际所属档案与比赛结果；在校生可用下述有时点和身份依据的豁免，不要求不存在的雇主资料。 |
| organizer-results | 检索主办方/田联最终成绩，HTML、计时平台与PDF均可。未执行仍not-started；真实受阻或官方档案未找到公开原件可按下述规则blocked，大学年度结果可作为替代证据，不能反向冒充主办方访问。 |
| personal-profile / federation-results / database / media | 分别记录个人、田联、数据库、媒体路径。补充路径按线索添加，不为数量凑访问。R22有地方陆协榜，必须纳入实际计划，不可只查WA。 |

PB默认评估前三类检索及大学两入口、主办方和雇主两入口（在校生显式评估豁免）。无候选不要求精确值和不同格式反查，但仍评估适用来源及年份。传记字段评估本人/大学/雇主，允许一份完整官方简介足够、不需要无关比赛；不用PB更新流程。

- searched：有实际执行查询。命中来源的类别路径须读到该类别的具体页面；搜索摘要不能冒充已读。真实无命中查询可以记录完成，不证明没有成绩。
- blocked：有具体unavailable URL、实际错误（放在finding/reason），或确实读过的主办方/田联档案未找到公开原件（outcome=not-found、access=read）；对有发布者类别的路径，失败目标必须属于该类别，不得用个人官网404冒充主办方不可访问。关联**另一次已执行**替代检索。不可只写“访问失败”；替代同样全失败则仍不充分。旧页404可查允许访问的其他年份/正式新域名，不绕过限制。
- not-applicable：具体原因及实际发现证据；不可用全失败查询作为豁免证明。PB的类别路径需有该类别已读发现资料，不能用雇主页面证明大学没有历代表；在校生雇主豁免使用下述身份特例，不要求访问不存在的实业团。传记字段可由另一个类别的明确简介支持不必查赛事，程序显式保留人工相关性审查。已知值不能免除反查。没有PB表可基于实际导航解释ranking不适用，results仍查。核心身份/项目冲突不能用N/A放行。
- not-started：诚实保存未做步骤，必报INCOMPLETE。省略默认步骤同样告警，不因status=candidate就跳过。

所有not-applicable及blocked均输出MANUAL CHECK REQUIRED，附路径和实际查询索引。同类别查询也可能完全无关（如大学食堂页面），另一路径的替代查询也不自动与本项目相关；程序不能判断这种语义，测试明确保留该边界。退出0只允许提交独立审核，不是豁免/替代已获独立认定。该方案不实现自然语言理解：理由、页面实际内容、查询是否完整仍须独立复核。伪写query/分类、隐藏候选、错误豁免不会因增加字段而自动变真。

## 有依据的在校生豁免与受阻退出

以下是可选的v2增量，不升级schema、不批量迁移日志。不填写新信息的旧日志仍可结构校验；严格完成度不会猜测缺失信息。API第四参数传入与日志校验相同的`ResearchContext`（包含注册Sources），CLI已统一传入；缺上下文不能授予证据豁免。必须先运行`validateResearchBatch`，完成度API不能替代事实校验。

### 在校时点

`audit.affiliation`可增加`enrollment: {asOf, employerStartsOn}`。asOf必须等于scope.asOf，stage必须为student；employerStartsOn为已公告的实际入队日期，或有证据判断截止日无适用雇主时的null。**null不是“没有查过/不知道”**，身份或入队状态未知应保留缺口，不填写这一证明。正式入队日早于或等于截止日不能豁免；未来公告的发布日期不是入队日。即使仍在校，只要已实际进入实业团，也不能使用本豁免。

两项雇主N/A的searchIndexes须指向实际读过的身份资料：发布者为大学、实业团、田联或主办方，documentType为profile/announcement；对应已注册Source的verified evidence须同时支持identity和affiliation，并被affiliation.evidenceIds引用。同一次访问的URL、检查日、类别和文档类型必须匹配，不能拼接别日的简介与当日历史成绩榜。定位须具体支持**截止日仍在校、无当时适用雇主及公告生效日**。只写stage=student、引用旧PB榜或WA数值页不够。

机器检查结构、关联和日期比较，不理解公告内容。所有N/A继续列入人工审查，审核者确认入队时间、在校身份、同名身份与判断理由；不要把“声明verified”误认为程序已联网核实。没有这类依据时仍可readyForReview=false保存进度。

### 原件与替代证据

1. 保留原路径实际query、checkedAt、访问URL和finding；reason说明失败/官方档案中未找到公开原件的具体情况。仅写404或blocked而无引用查询不通过。not-started绝不自动重分类。
2. `alternativeSearchIndexes`引用另一项真实已执行查询，不能重复原查询。主办方未公开原件不是HTTP错误，不应伪造unavailable。
3. organizer-results的searched需要读到最终成绩；blocked需要替代最终成绩和audit.limitations。已知PB的证据须为已注册Source、同日read、documentType=results，发布者为university/employer/competition/federation，有primary value且覆盖achievedOn/meet/distance；不要求PDF后缀，也不要求两份独立来源。未确认身份/距离仍交事实校验及独立复核，不用completion覆盖。
4. 对真实not-found且无候选值，不要求捏造用时或取得日期。需实际结果资料与支持pb-update的证据、检查范围延伸至asOf；范围充分性人工审核，未找到不等于没有正式成绩。
5. 毕业者employer-profile与employer-results分别评估。后者searched需实业团结果资料；blocked可用其他官方/大学结果替代，但必须由该结果自己的pbUpdate.check（outcome非blocked，through=asOf）支持后续更新。仅有旧大学PB或雇主简介不能充当比赛结果。无法完成更新则继续不完整，保留局限与后续行动。
6. 能进入人工审核不代表PB已核实：已知更快候选、身份和日期冲突、授权缺失/哈希不符、readyForReview=false的门槛保持。授权文件与摘要仍必须由独立任务发起者提供。

`searches[].sources[].documentType`仅v2可选，枚举profile/results/ranking/announcement/navigation，表示实际文档内容而非文件格式。大学历代表可证明历史成绩，但不能仅因是官方站就当现时身份或完整赛后更新。新标签只能根据实际阅读填写，旧日志不自动添加。

## 来源分类与独立性

v2 searches[].sources[]可增加`category`：athlete（本人/个人）、university、employer、competition（主办方）、federation、database、media。按发布者分类，不按页面里提到哪所大学。完成度路径的已读来源必须有类别；旧日志未分类显示unclassified，不自动猜测。大学年度结果仍属university，不必有个人PB表。

旧audit.coverage的五项（official合并赛事/田联）保留以免破坏v2。新访问的细分类与实际查询直接关联；不强迫七类都访问。原originKey谱系检查不变：学校榜与同校报告、GMO多个域名新闻、第三方转载不能机械累计独立来源。一个官方页面可支持值、日期、赛事；不强制两个独立来源。

## 赛事上下文与兼容

CLI及使用真实注册实体的测试统一调用 `createResearchContext()`，自动注入已校验meets。v2遗漏meets明确报配置错误，不再误报某个有效metadataId未知；合成测试可显式提供专用目录。已匹配ID或精确官方URL的届数仍不允许null/pending降级；未知赛事仍允许诚实pending。目录内容本轮未扩展。

v1冻结哈希、原v2 JSON与证据规则不改；旧v2不必补category或完成清单，不把老访问假装符合新规范。新建/续查任务写新的v2日志及清单，保留旧记录；没有清单明确NOT ASSESSED，退出检查失败。纯传记和未确认日期可继续留候选。研究日志不是生产资料，本轮没有生产事实变更。

## 给DSH的执行要求

1. 开始时取得任务发起者独立审阅的授权文件与预期SHA-256，按授权名单和字段声明全部scope，不只列最后成功的字段；禁止启动未授权候选16–20。
2. 已知值先做精确/异格式反查；优先进入大学历代表及具体年份结果。毕业者核实当前所属与结果；无表≠blocked，404≠不存在。
3. 只记录实际搜索、读取、失败及替代；未知字段留null，所有未确认字段仍写v2记录、原因和下一步。不得因校验报错把已知届数改pending。
4. 将发现的更快成绩纳入比较，后来的慢成绩不是PB更新；同源转载不计独立证据。
5. 完成并明确送审时才设readyForReview=true；分别运行research:validate与带独立授权文件/预期摘要的research:complete；后者未通过可交付进度，不得宣称研究完成。PR列所有生产事实到batchId/athleteId/field/scope、未覆盖项、未确认项及独立复核状态。
6. 通过离线检查后由ChatGPT/维护者重新联网独立复核。此提案尚待审核，不授权数据导入、合并或部署。

本轮定向修复及PR #19只读回归见[验收与DSH补齐指南](applicable-exits-review.md)。
