# 研究日志通用契约与 v1 兼容

新建或修改日志使用 [v2 证据与更新检查契约](audit-v2.md)，下表保留通用字段及旧 v1 说明；v2 额外必填 audit。

类型及通用运行时验证器在 [lib/research.ts](../../lib/research.ts)。每批一个 UTF-8 JSON，路径 `data/research/batches/<batchId>.json`；不生成日志、不爬网站、不导入生产资料。执行 `npm run research:validate`，脚本只读扫描所有批次；没有历史日志不构成失败。批次 ID 全局唯一，文件名须与 ID 一致。

## 字段

| 层级 | 必填内容 |
| --- | --- |
| 批次 | schemaVersion=1（只读兼容）/2（新日志）、batchId（小写字母数字和连字符）、researcher（实际执行者）、reviewedAt（YYYY-MM-DD）、非空 records |
| 研究对象 | athleteId、athleteName（注册名或已登记别名）、field、scope（结构化对象，见下文）、pbScope（PB 为 current/historical，其他为 null） |
| 当前结论 | status、candidates、final、identityEvidence（身份佐证或尚缺证据）、unresolved（未解决项）、reviewedAt |
| candidates | value（保留原始精度及必要上下文的文字）、sourceUrl、locator；允许空数组，不是生产 PB 类型 |
| searches | 非空步骤数组；每步 stage=discovery/reverse/verification、query（实际关键词或明确的站内导航操作）、checkedAt、outcome=found/not-found/inaccessible/conflict、sources、result |
| sources（步骤内） | url、section（栏目/页码/行）、access=read/search-snippet/unavailable、finding（实际观察）；无命中可 sources=[]，不能凭首页声称全站已查 |
| final | 未核实一律 null；已核实为 value、非空去重 sourceIds、locator、revision。Source ID 必须存在于数据库或 presentation 来源目录；其 URL 须在日志中有 read 记录，只有搜索摘要不够 |
| updateCheck | checked 布尔、asOf（检查到的截止日期，未查为 null）、summary（更新检索范围或未查原因）；已核实 PB 必须检查更新，历史 PB 截止其历史范围 |

field 枚举：birthDate、highSchool、affiliation、5000m、10000m、half-marathon、race-result、section-record、award、statistic。赛事研究按涉及的稳定 athleteId 记记录，scope 使用稳定届次/区间/路线标识，统计口径在候选和来源定位中说明；纯赛事级无选手任务另附该导入流程的核验报告，不杜撰 athleteId。

状态：verified（已核实）、verified-absent（有直接依据的无正式 PB）、candidate、not-found、conflict。已核实必须有三个阶段、身份证据说明、最终来源定位/版本且无未解决项；待审核身份禁止标已核实。candidate/conflict 须有候选，not-found 不得藏起已知候选。未核实须有未解决原因，不能带 final。已核实值必须出现在候选中；无正式成绩例外，但须有肯定证据说明。

## 标准化范围与唯一性

`scope` 必填四项，不接受自由文本、额外标签或省略的 null：

```json
{"asOf":"2026-11-16","editionId":null,"courseVersion":null,"sectionNumber":null}
```

- `asOf` 是本条结论的目标截止日期（真实 YYYY-MM-DD），不是“已完成检索”的声明，不能晚于 reviewedAt。尚未检查更新时 updateCheck 仍为 false/null；检查完成后 updateCheck.asOf 必须与 scope.asOf 相同。
- PB 和个人资料的 editionId、courseVersion、sectionNumber 必须为 null。PB 历史时点用不同 asOf 分别记录；current/historical 只是说明，不参加判重，因此同一截止日期不能通过切换标签重复提交。
- race-result、section-record、award、statistic 的 editionId 必须是现有数据库稳定 ID。courseVersion 为 null 或规范的小写字母数字连字符 ID，区分不同路线，不接受大小写/空格别名；复用生产纪录已有的 courseVersion，新版本应由来源与独立评审确认，不能另起名称规避判重。sectionNumber 为 null 或正整数；section-record 必须明确路线版本及区间编号。
- 同批次唯一键为 `(athleteId, field, asOf, editionId, courseVersion, sectionNumber)`，按固定顺序比较，不受 JSON 属性顺序影响。同键即使结论相同也不能重复，相互冲突值合为一条 conflict 及其候选。不同截止日期、届次、路线版本或区间可分别记录。

此结构已随 PR #20 合并；旧真实样本及测试副本保留原截止日期、查询步骤、候选与结论，不伪造新的访问。自由文本旧写法明确拒绝，不静默猜测转换。没有历史日志的生产资料仍无需追补。跨批次保留真实历史判断，以评审认定的后续批次更新，不按文件顺序覆盖生产事实。路线 ID 与实际路线的对应关系仍需审核，离线检查不证明语义真实性。

日期必须为真实日历日期，步骤时间不晚于记录核查、记录不晚于批次核查，更新截止不晚于核查。允许 HTTP/HTTPS 公开来源链接，不接受占位域名、本地地址、URL 凭证或明显令牌参数。拒绝 Azure SAS 的 sig、腾讯 COS 的 q-signature/q-ak 等签名字段、AWS/GCS/OSS/COS 的签名/凭证/临时令牌参数、CloudFront 的 Signature/Key-Pair-Id/Policy，以及 access_token、refresh_token、auth_key 等。参数名由 URLSearchParams 解码后不区分大小写检查，重复参数中任一违规即失败；不回显凭证值。正常 id、year、raceId、numberCard、mobile、page、sort 等查询参数及 PDF 页码定位保留，不能删掉参数假装验证了另一份文档。拒绝未知字段，避免误放 headers、Cookie、token 或网页整页内容；仍须提交前人工检查脱敏，不保证检测所有敏感字符串。

## 示例与使用

- [实际有效示例](../../data/research/batches/2026-11-16-kudo-reverse-audit.json)：本 PR 为研究规范复查工藤 10000m 的真实步骤，**candidate**；未进行全面最新 PB 研究，也没有修改 PR #19 或新增生产 Source，故 final=null。不能复制其步骤并声称自己重查过。
- [测试有效样例](../../tests/fixtures/research/valid.json)是上例的测试副本；[无效样例](../../tests/fixtures/research/invalid-cases.json)列出对首条记录的覆盖值及预期拒绝原因，由 Node 测试组合为完整无效批次。均不导入正式资料。
- 新建日志时逐项填实际观察，不提供预填“已访问”的批量生成器。中断时可以提交 candidate/not-found/conflict 和实际已执行阶段，不能补造三阶段记录。
- 数据审核通过不代表已合并发布：verified 是执行者结论，PR 独立评审仍必须完成，且不自动合并。

## 自动化边界和向后兼容

CI 的 check 增加只读 `research:validate`。检查 JSON、必填/类型/枚举/日历、注册 ID/姓名、最终来源存在且对应读取 URL、候选引用、定位、状态、重复结论和基本日期次序。**不验证网页内容、访问真实性、来源充分性、PB 时间文字语义或世界范围最新性**；正式 PB 继续由既有 athlete-facts 校验器检查毫秒精度、日期、项目和生产来源。

v2 对既有 v1 日志使用精确快照兼容清单，新增/改动日志须升级（见 v2 迁移说明）；不要求旧生产事实追补。

本轮不做 Git diff 推断“哪些字段必须有日志”，也不新增覆盖基线快照或线上抓取。新/修改事实必须附日志由 PR 审核要求落实；CI 结构通过不能证明日志已覆盖全部改动。审核者逐项对照生产 diff 与日志，若未覆盖就不批准。旧 PB、旧 Source、旧赛事无需一次性回补；不得追造旧访问日期。

PR #19 接入：v1 规范已合并；v2 经评审合并后，由其负责者在自己的分支整合 main；逐项列出尚未合并的新增/修改事实，重新实际执行必要步骤并按真实日期写日志；注册实际采用 Source；对应八个回归案例复查；运行全部检查；补充独立评审与缺口报告。本 PR 不改其分支、数据或历史。

## PR 资料审核清单（逐事实填写）

没有生产事实变更时明确写“新增/修改生产事实 0，覆盖与独立事实复核不适用”，不能把未填写当作零。涉及事实变更时，在 PR 描述中复制此表；每个字段/成绩/奖项单独一行，不能只报选手总数。

| 生产文件及实体 ID | 新增/修改字段、旧值 → 新值 | 日志 batchId | athleteId | field | scope（截止/届次/路线/区间） | 日志覆盖 | 独立复核状态、复核者及证据/评审链接 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 已覆盖 / 未覆盖（原因） | 待复核 / 通过 / 有异议；实际复核者与链接 |

- [ ] 对照完整生产 diff，列出本次全部新增及修改的事实，包含来源修订、空缺状态和身份关系的变化。
- [ ] 每项事实能定位到 batchId、athleteId、field 及结构化 scope；纯赛事级无选手事实按适用导入契约提供报告，明确“不适用”的原因，不编造 athleteId。
- [ ] 单列所有尚未覆盖项和下一步；未覆盖不得标为已完成或批准发布。
- [ ] 独立复核者检查实际一手证据、身份、日期/届数/精度和更新范围，逐项标明状态；执行者不自批，尚无评审链接就写待复核。
- [ ] **CI 通过不等于证据复核通过**。日志结构通过也不证明覆盖完整；记录 CI 与独立复核两种结果，不互相替代。

本清单由执行者填写、独立复核者核对，不增加 Git diff 自动分析或自动批准机制。
