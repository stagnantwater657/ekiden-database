# v2 研究证据与更新检查契约

适用：本框架合并后新增或修改的研究日志。沿用 [v1 通用字段、来源访问与唯一性规则](audit-log.md)，批次 `schemaVersion: 2`，每条记录增加 `audit`。类型/校验在 [research-audit.ts](../../lib/research-audit.ts)，基础校验共用 [research-checks.ts](../../lib/research-checks.ts)，不接入网页抓取或生产页面。

## 为什么增加结构

v1 已检查稳定 ID、日期、来源 URL/定位、三阶段、状态、同批唯一性，PB 有 updateCheck 标记；但不能区分“实际追查了什么”和一个 true/摘要，也无法把多个来源逐一对应到值/比赛日/届次。v2 在已声明的资料范围内拒绝缺证据、错误引用和已知矛盾，**仍不证明声明真实、来源独立或已经找到全网最快成绩**。

## audit 字段

以下字段均显式填写，无适用内容用 null/空数组；不是自动生成的访问日志。

| 字段 | 结构与规则 |
| --- | --- |
| evidence | 每条 `{id,sourceId,role,supports,locator,revision,status,checkedAt,originKey,independenceNote}`。id 在记录内唯一；Source ID 必须存在；role=primary/event/cross-check/identity，分别为主事实、日期赛事、交叉验证、身份识别。每条证据自己的定位和版本只描述该 Source，不拼接其他网站。 |
| supports | 非空去重数组，枚举 value/achievedOn/meet/edition/distance/group/affiliation/identity/pb-update。表示本来源支持的具体字段；不是声明该来源支持所有字段。多份证据可支持同一字段，一份来源也可有多种支持。 |
| status / checkedAt | verified 必须有真实检查日，且匹配 searches 同日已 read 的该 Source URL。unverified 表示已登记来源但尚未核验，checkedAt 可 null；不能支持已采用事实。unknown Source 与未核验 Source 报错不同。 |
| originKey / independenceNote | 原始发布者/原始内容谱系的稳定标签及依据；转载/同一报告的镜像共用同一 key。不能凭不同域名给不同 key。未知独立性填 null 并解释。相同文档不得标不同谱系；不同文档是否独立须人工复核。 |
| adoptedEvidenceIds | 已采用结论的证据 ID；与 final.sourceIds 的集合严格一致。非已核实状态必须为空。v1 final.locator 留作简短索引；逐来源定位以 evidence 为准。 |
| coverage | 大学 university、实业团 employer、赛事/田联 official、数据库 database、媒体 media 五项各一次。每项 `{category,status,searchIndexes,reason}`；status 为 checked/not-checked/not-applicable/blocked。checked 关联有 read 的查询，blocked 关联 unavailable；后两种未检索/不适用不伪造查询索引。来源类别归属由研究者声明、独立审核者确认，不由域名猜测。 |
| limitations | 明确资料局限，例如未查数据库、独立主办方计时文件缺失、尚未确认赛事届数。与 unresolved 区分：未解决核心身份/值冲突必须保持 candidate/conflict；其他有效证据足以提交复核时，缺少额外原件可以是 limitations，不能声称已获得。 |
| affiliation | PB 必填 `{stage,organization,evidenceIds,reason}`，stage=student/graduated/unknown；已核实 PB 要有明确所属与 affiliation 证据。毕业选手必须说明 employer 实际检查：checked 需关联后续更新检查，blocked 需失败访问、局限和其他实际后续证据；在校选手 employer 明确 not-applicable，不编造雇主访问。所属以 scope 截止日期为准，历史 PB 不要求其未来雇主。非 PB 填 null。 |
| performances | PB 候选结构（下文）；非 PB 为 []。 |
| pbUpdate | PB 更新决策（下文）；出生日期/高中等非 PB 为 null，不套用 PB 专用流程。 |

coverage 只表达具体实际检查过的来源类别，不把访问一页当全站检索。单一来源可以提交，不强制四种 role 齐全或两份独立证据；CLI 会展示采用来源数、**声明的**谱系数、单源/独立性未知、每类覆盖和局限，审核者仍须确认充分性。

## PB 候选、更新范围与取舍

每条 performance：

- `id`、`value`：value 对应通用 candidates 中的同一候选文本。现有 v1/PR #19 使用“成绩; 日期; 赛事描述”，不是纯时间字符串；v1 保持原样。v2 performance 明确要求首段为标准化成绩，可为纯成绩，或用 ASCII 分号 `;` 接描述（如 `13:25.62; 2026-06-14; 比赛描述`）。只解析分号前首段，描述中的日期/时间不参与用时计算，不从任意散文中猜测成绩。正式 PB 需将所有候选纳入结构化决策，不能藏起更快候选。
- 首段接受 `M:SS` / `H:MM:SS`（second）以及对应的 `.cc` 两位百分秒形式（centisecond），首段两端空白可保留。秒及小时形式的分钟必须为00–59；可用59:30或1:03:45表示半马。整数毫秒须与文本精确相等，不舍入、不自动补删小数；即使 `.00` 也必须标 centisecond。日本式用时等其他写法需在新 v2 performance 首段显式标准化，原始来源写法保留在来源定位/查询观察中；不得批量改写 v1 日志。
- `timeMilliseconds`、`precision`、`achievedOn`：正整数毫秒，second/centisecond 保持原始精度，取得日不得晚于 scope.asOf。
- `evidenceIds`：eligible 候选必须有支持 value 的已核验主事实证据。
- `eligibility`=eligible/excluded/unconfirmed；`reason` 解释采用/排除/待核验依据。排除失格或不同计时口径须有实际证据，不能用标签忽略更快纪录。
- `event`：`metadataId`（可 null）、`name`、`edition`（整数或 null）、`startsOn`、`endsOn`、`competedOn`、`discipline`、`distanceMetres`、`editionStatus`（verified/pending）、`evidenceIds`。比赛日须在举办日期内且等于 achievedOn；项目与研究字段一致，半马距离为 21097.5m。eligible 要有日期、赛事、距离证据；已确认届数有 edition 证据，pending 必须 null 并注明局限，不按年份推算。

`pbUpdate`：

- `initialId`：最初发现的候选；没有候选时为 null。
- `selectedId`：最终采用候选；仅 verified PB 可填写。须与 final.value 相同且 eligibility=eligible。
- `checks`：每项 `{searchIndex,from,through,evidenceIds,outcome,note}`。searchIndex 是本记录 searches 的零起始索引；from/through 是实际检查的后续资料时间范围，不是访问时间。范围不得早于初始候选取得日或晚于截止/实际访问日。evidence 必须对应这一查询中已读来源并支持 pb-update；outcome 为 no-faster-found/faster-found/blocked。blocked 关联失败访问及 limitations，不算完成。
- `foundFaster`：与已录入 eligible 候选相对 initialId 的比较一致；不等于“全网不存在更快成绩”。尚未完成时可 null。
- `decision`：最终取舍理由，不得为空。无法完成的路径在 coverage、limitations 或 unresolved 中说明。

已核实 PB 要有延伸至 scope.asOf 的完成检查，大学（毕业者还包括实业团）不能只写未检索：checked 覆盖所引用的查询中必须至少有一条实际后续检查；blocked 必须有失败访问和局限，并由其他已核验来源完成后续检查。不得为凑两个来源伪造访问或独立证据。旧真成绩慢于已知 eligible 候选时禁止选旧值；更快候选仍 unconfirmed 时也禁止把旧值标 verified。程序会检查标准化用时文本与整数/精度的算术一致性，但无法证明检查范围真的查全或原始来源支持该成绩，亦不能判断排除理由是否可信——这些由独立复核检查。

`verified-absent` 仍须肯定的无正式成绩证据、三阶段、所属/更新检查；搜索无命中不能用该状态。日志不得为凑齐结构捏造事实，未确认日期/所属可保留 candidates 和未完成状态，不强行造 performance。

## 小型赛事身份目录

[meets.json](../../data/research/meets.json) 目前只登记第77回丸亀（2025-02-02）的身份元数据，不导入任何个人成绩，也不改变三大驿传 Schema。来源为 [JAAF 大会页](https://www.jaaf.or.jp/competition/detail/1910/)标题和開催日，2026-11-16 本轮实际读取；半马项目来自官方名称。检查页脚及[隐私政策](https://www.jaaf.or.jp/privacy/)：版权保留，隐私政策并非再利用授权；本次仅独立整理赛事名称、届数、日期、项目及定位，不复制正文/图片/版式，不声称获得书面许可，也未进行批量抓取。扩展目录时须重新检查具体使用条件。

metadataId 精确引用或证据 Source 的 URL 精确匹配目录时，校验名称、举办日期、项目和届数；一旦匹配登记元数据，edition 必须等于已知届数且 editionStatus 必须为 verified，不能以 pending/null 绕过（即使填写了局限也不允许）；不按名称近似合并，不按年份生成届数。未知 ID 报错；未通过 ID 或精确来源匹配的目录外赛事允许 metadataId=null、未知届数 pending/null，仍需具体证据与局限说明。目录很小，不能声明覆盖所有日本赛事。赛事元数据有自己的 URL、定位、版本和检查日，证据 Source 仍由生产数据 PR 登记，不能仅因为目录有某赛事就声称取得个人计时原件。

## 生产兼容与 v1 迁移

生产 `athlete-profiles.json` / `sources.json` / athlete-facts 及页面不改。主来源 sourceId 继续服务现有展示；多来源支持关系只在研究日志保存一次，PR 审核清单用 batchId / athleteId / field / scope 对应生产字段。生产主来源 locator 只能描述本来源；其他证明放在 evidence，不能继续拼进主来源定位。

v1 原验证器继续工作，但 CLI 标为 legacy，不能冒充已满足 v2。`legacy-v1.json` 冻结 main 的1份日志以及 PR #19 `2a5494d` 的3份既有日志原始字节 SHA-256。读取兼容 **不是事实批准**，不改 PR #19 或复制其日志到本分支。已检查该快照共4批36条可读。新增或修改日志的 CLI 默认要求 v2，不能降版本绕过；已登记 v1 有任何字节修改也会失败。

不要求一次性补查旧事实。旧日志不重写、不补造过去访问；未来更正/再采用事实时新增 v2 批次，真实填新的检查过程、截止日期和决定。若只是修正文档化的历史日志错误，另提受控兼容清单变更评审，不自动更新哈希来放行。框架代码无自动迁移/自动生成访问功能。

## 合成示例与验证

[完整 v2 fixture](../../tests/fixtures/research/v2.json) 包括独立的假选手、假赛事、假 Source 上下文和日志，全部标记 SYNTHETIC；供理解结构和离线单元测试，**不得复制为实际研究记录**。R9–R14 的真实事实在[回归文档](regression-cases.md)，离线测试使用不同数值，验证错误状态而不是匹配答案。

运行 `npm run research:validate`、`npm run data:validate`、`npm test`、typecheck、lint、build、test:e2e。CLI 只扫描真实 batches，不把测试 fixture 当完成研究。PR #21 的初版不含真实v2批次；本次检索完成度增量加入两项有限真实候选演示，详情见 round3-completion-review.md。它们不是生产事实批准，下一批 DSH 执行须等待独立评审。

## 检索完成度增量（待本轮独立评审）

新增任务按[completion audit契约](completion-audit.md)列全部授权字段，未确认字段也保存v2日志及下一步。运行 `npm run research:complete -- <batchId>`；结构校验/CI通过不能代替退出检查或独立证据复核。大学无个人PB表时继续查历代表及年度结果；毕业后查当前所属。CLI和真实实体测试使用 `createResearchContext()`，不得以pending替代已知届次。旧日志无须追造历史，明确未评估。
