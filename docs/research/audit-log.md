# 研究日志契约 v1

类型及唯一运行时验证器在 [lib/research.ts](../../lib/research.ts)。每批一个 UTF-8 JSON，路径 `data/research/batches/<batchId>.json`；不生成日志、不爬网站、不导入生产资料。执行 `npm run research:validate`，脚本只读扫描所有批次；没有历史日志不构成失败。批次 ID 全局唯一，文件名须与 ID 一致。

## 字段

| 层级 | 必填内容 |
| --- | --- |
| 批次 | schemaVersion=1、batchId（小写字母数字和连字符）、researcher（实际执行者）、reviewedAt（YYYY-MM-DD）、非空 records |
| 研究对象 | athleteId、athleteName（注册名或已登记别名）、field、scope（明确如截至日期/赛事届次/区间/路线版本）、pbScope（PB 为 current/historical，其他为 null） |
| 当前结论 | status、candidates、final、identityEvidence（身份佐证或尚缺证据）、unresolved（未解决项）、reviewedAt |
| candidates | value（保留原始精度及必要上下文的文字）、sourceUrl、locator；允许空数组，不是生产 PB 类型 |
| searches | 非空步骤数组；每步 stage=discovery/reverse/verification、query（实际关键词或明确的站内导航操作）、checkedAt、outcome=found/not-found/inaccessible/conflict、sources、result |
| sources（步骤内） | url、section（栏目/页码/行）、access=read/search-snippet/unavailable、finding（实际观察）；无命中可 sources=[]，不能凭首页声称全站已查 |
| final | 未核实一律 null；已核实为 value、非空去重 sourceIds、locator、revision。Source ID 必须存在于数据库或 presentation 来源目录；其 URL 须在日志中有 read 记录，只有搜索摘要不够 |
| updateCheck | checked 布尔、asOf（检查到的截止日期，未查为 null）、summary（更新检索范围或未查原因）；已核实 PB 必须检查更新，历史 PB 截止其历史范围 |

field 枚举：birthDate、highSchool、affiliation、5000m、10000m、half-marathon、race-result、section-record、award、statistic。赛事研究按涉及的稳定 athleteId 记记录，scope 写明届次/区间/路线/统计口径；纯赛事级无选手任务另附该导入流程的核验报告，不杜撰 athleteId。

状态：verified（已核实）、verified-absent（有直接依据的无正式 PB）、candidate、not-found、conflict。已核实必须有三个阶段、身份证据说明、最终来源定位/版本且无未解决项；待审核身份禁止标已核实。candidate/conflict 须有候选，not-found 不得藏起已知候选。未核实须有未解决原因，不能带 final。已核实值必须出现在候选中；无正式成绩例外，但须有肯定证据说明。

同批次每个 `(athleteId, field, scope)` 只留一个当前结论；相互冲突值合入一条 conflict 及其候选。跨批次保留真实历史判断，以评审认定的后续批次更新，不能仅以文件顺序覆盖生产事实。scope 不得通过改写文字规避冲突检查。

日期必须为真实日历日期，步骤时间不晚于记录核查、记录不晚于批次核查，更新截止不晚于核查。允许 HTTP/HTTPS 公开来源链接，不接受占位域名、本地地址、URL 凭证或明显令牌参数。拒绝未知字段，避免误放 headers、Cookie、token 或网页整页内容；仍须提交前人工检查脱敏，不保证检测所有敏感字符串。

## 示例与使用

- [实际有效示例](../../data/research/batches/2026-11-16-kudo-reverse-audit.json)：本 PR 为研究规范复查工藤 10000m 的真实步骤，**candidate**；未进行全面最新 PB 研究，也没有修改 PR #19 或新增生产 Source，故 final=null。不能复制其步骤并声称自己重查过。
- [测试有效样例](../../tests/fixtures/research/valid.json)是上例的测试副本；[无效样例](../../tests/fixtures/research/invalid-cases.json)列出对首条记录的覆盖值及预期拒绝原因，由 Node 测试组合为完整无效批次。均不导入正式资料。
- 新建日志时逐项填实际观察，不提供预填“已访问”的批量生成器。中断时可以提交 candidate/not-found/conflict 和实际已执行阶段，不能补造三阶段记录。
- 数据审核通过不代表已合并发布：verified 是执行者结论，PR 独立评审仍必须完成，且不自动合并。

## 自动化边界和向后兼容

CI 的 check 增加只读 `research:validate`。检查 JSON、必填/类型/枚举/日历、注册 ID/姓名、最终来源存在且对应读取 URL、候选引用、定位、状态、重复结论和基本日期次序。**不验证网页内容、访问真实性、来源充分性、PB 时间文字语义或世界范围最新性**；正式 PB 继续由既有 athlete-facts 校验器检查毫秒精度、日期、项目和生产来源。

本轮不做 Git diff 推断“哪些字段必须有日志”，也不新增覆盖基线快照或线上抓取。新/修改事实必须附日志由 PR 审核要求落实；CI 结构通过不能证明日志已覆盖全部改动。审核者逐项对照生产 diff 与日志，若未覆盖就不批准。旧 PB、旧 Source、旧赛事无需一次性回补；不得追造旧访问日期。

PR #19 接入：待本规范合并后，由其负责者在自己的分支整合 main；逐项列出尚未合并的新增/修改事实，重新实际执行必要步骤并按真实日期写日志；注册实际采用 Source；对应八个回归案例复查；运行全部检查；补充独立评审与缺口报告。本 PR 不改其分支、数据或历史。
