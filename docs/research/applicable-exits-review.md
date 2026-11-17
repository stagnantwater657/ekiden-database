# Research Completion：适用性与真实受阻定向修复

核查日：2026-11-17。基线 main `b9720a0ac81b27c23c642b3e97555fb866e100fe`（PR #22已合并）。只改框架、测试及文档；不修改PR #19、生产资料、来源注册、旧日志、授权信息或部署配置。没有开展候选16–20，也没有重新联网验证25个字段的网页事实。

## 根因与修复边界

| 问题 | 原因 | 定向处理 |
| --- | --- | --- |
| 在校生雇主N/A | completion通用类别规则要求雇主类别已读资料，与v2在校生N/A冲突；且student标签没有明确生效时点 | 可选enrollment时点及实际入队日；注册Source、同日已读身份/所属证据与profile/announcement文档；毕业、已入队、依据缺失不豁免；所有PB显式评估两条雇主路径 |
| 主办方原件 | 原实现没有按PDF后缀限制，但blocked只接受unavailable；无法表达已查官方档案但无公开原件；searched也未区分结果页与简介 | 支持实际官方档案not-found与失败访问两种blocked；关联另一真实查询的结果证据及局限。HTML/官方计时页可作为结果；大学结果可作替代，不能冒充已执行主办方查询 |
| 毕业者更新 | publisher=employer不能区分简介与比赛结果 | documentType区分内容；employer-results需对应实际结果及through=asOf的pbUpdate；blocked替代也必须有更新检查，不能只引用旧大学PB |
| Windows EPERM | CLI隔离测试使用symlinkSync指向lib，Windows非特权环境可能拒绝 | 用cpSync复制lib及其data依赖，重建隔离日志目录；保留所有CLI正反断言，无跳过、无新增Windows特权需求 |

`verified/candidate/conflict/not-found`含义不变。真正not-found可通过结果资料的更新范围接受完成度评估，不必捏造不存在的值/日期。更快候选、赛事元数据、数值一致性、独立授权内容与SHA-256、readyForReview门槛保持。所有例外仍需人工判断网页真实性、身份、时间范围、相关性与证据充分性。

## 修改文件

- `lib/research-audit.ts`：校验可选enrollment的结构和截止日期，不改旧事实规则。
- `lib/research.ts`：v2访问可选documentType枚举，v1不变。
- `lib/research-completion-evidence.ts`：同一Source、同日read与文档分类的证据匹配；学生豁免、结果及更新检查。
- `lib/research-completion.ts`：适用性、真实受阻/无公开原件及显式雇主步骤，仍输出人工复核项。
- `lib/research-completion-files.ts`、`scripts/research-validate.ts`：使用同一个正式ResearchContext，避免只凭标签而不核对注册来源。
- `tests/research-completion.test.ts`：新增13项正反测试及无符号链接的CLI环境；既有授权/更快PB/R15–R23回归保留。
- 本文、`completion-audit.md`、`audit-v2.md`、`task-template.md`：契约、边界、只读回归与DSH操作。

## PR #19只读回归

锁定提交[`e422c7abed5a45aeed163e220df07694fbb4b5f4`](https://github.com/stagnantwater657/ekiden-database/commit/e422c7abed5a45aeed163e220df07694fbb4b5f4)，批次`2026-11-17-batch2-round3-repair`。通过git show读取batch、completion和该提交的Sources到临时文件，验证上下文仅在内存合入这些Sources；原25条日志、清单及其readyForReview均不修改。24 verified + 1 not-found结构校验通过；这不是新增网页事实认证。未提供独立授权文件，不能严格退出。

| 指标 | 修复前 | 修复后 |
| --- | ---: | ---: |
| 明确not-started的研究步骤 | 20 | 20 |
| 错误要求学生提供雇主类别来源的N/A发现 | 16 | 0 |
| 在校时点/身份依据不足（新诊断，不是已豁免） | 0 | 16 |
| 缺少结果文档证据分类（新诊断） | 0 | 1 |
| 漏列实业团适用性步骤（新诊断） | 0 | 2 |
| 所有阻断发现 | 36 | 39 |
| blocked中未触发该路径结构问题 | 11/11 | 11/11 |
| 人工复核条目 | 51 | 51 |
| stepsComplete | false | false |
| authorizationComplete | false（缺失） | false（缺失） |
| readyForReview | false | false |
| exitAllowed | false | false |

“blocked有效”仅指其路径未触发自动结构错误，不表示实际访问或替代证据已独立核实。51条人工项按步骤计数，不是51项事实；授权缺失单列，不纳入36/39条步骤发现。

具体未完成：

- 14条organizer-results未启动；6条employer-results未启动（吉田響、太田蒼生各3项PB）。保留，未自动转blocked。
- 小池莉希、山口竣平、吉岡大翔共8项PB的16条雇主N/A缺少新的时点证据。历史PB榜证明当年比赛所属，不能直接证明2026-11-17仍在校且没有适用雇主；部分引用是WA或高中历史榜，不能改分类来绕过。**修复类别矛盾不等于这16条现已获准豁免。**
- 吉田響半马的organizer-results已有searched，但旧访问没有明确results文档类型；需实际核对是否为最终成绩、身份与正式半马性质后记录，不能程序自动补标签。
- 山口竣平半马not-found漏列employer-profile与employer-results两项适用性评估；可在有依据时明确N/A，无需编造PB。

临时快照SHA-256（记录的是日志字节完整性，**不是授权摘要**）：

| 文件（均来自上述PR提交） | SHA-256 |
| --- | --- |
| data/research/batches/2026-11-17-batch2-round3-repair.json | d18910eb30c0bd9a1531bc40a391949b15e8c902f5f40b8b7f01e99d8f2a9f31 |
| data/research/completion/2026-11-17-batch2-round3-repair.json | 8af1764b0e190171da4096a34aa2896f7c5838e6532d538c494793bb6a014dc3 |
| data/presentation/sources.json | ec32e050fd29aa170fc883877557de281584af42c622e924e5281b513b29e8d9 |

复核方法：在临时目录对固定提交执行`git show <SHA>:<上述文件>`，不切换/改写PR #19分支。分别从基线和本修复的临时checkout导入`createResearchContext`、`validateResearchBatch`、`auditResearchCompletion`；将快照Sources按id合入内存上下文，先validateResearchBatch，再`auditResearchCompletion(plan,batch,undefined,context)`。第三参数undefined有意保留“无授权”；不得为复现生成授权。统计findings按code、manualChecks长度与四个布尔状态。重复调用不写文件，不改status或readyForReview。另在隔离临时副本中执行真实CLI，只装载上述25条日志/清单及对应Sources：research:validate退出0，research:complete（无授权）退出1，输出INCOMPLETE / NOT SUBMITTED / NOT ASSESSED / DENIED；原仓库日志未改。

## 测试与兼容性

新增13项测试涵盖：有证据学生N/A；毕业/已入队拒绝；缺身份、来源或时点拒绝；未来公告与错误截止日；主办方未查仍失败；HTML与田联结果；实际失败+替代；官方档案未找到原件；伪blocked/缺查询/局限/结果证据；not-found不造数值；跨日证据不能拼接；雇主简介不是结果且更新必须到截止日；受阻雇主更新不能靠旧PB替代。

既有R15–R23、已知更快成绩冲突、25项授权只交15项、缺授权、哈希变更、未声明送审、v1冻结和v2兼容回归保留。合成测试不代表网页事实已复核。可选新增信息不强迫旧v2迁移，旧完成度清单可能暴露更精确的证据缺口；readyForReview=false仍可保存进度。低层completion API需要先通过日志结构校验，正式CLI已按此顺序执行。

本地：research:validate（2批3条）、data:validate（11届2030条）、typecheck、lint、生产build均通过；Node 177/177、研究测试70/70（其中完成度38/38）、E2E 27/27，无跳过；另运行部署、传输诊断、源码部署/下载、bootstrap文档的离线Python测试。GitHub Actions最终结果见本PR描述。Windows原生运行尚未验证；Linux已执行复制隔离目录的同一CLI测试，未设置平台跳过。Linux CI不被描述为Windows实际通过。

## DSH补齐第三轮清单

1. 保留现有25项scope、24 verified/1 not-found、readyForReview=false。先取得任务方独立授权文件及固定SHA-256；本修复不提供/追造授权。没有授权可继续报告进度，不能声明退出通过。
2. 对3名在校生查实际截止日身份资料，定位姓名/大学/在校时段及雇主状态；存在未来入队公告时记录实际生效日。真实登记Source与同日read、category、documentType，关联identity+affiliation证据；有依据才填enrollment并用于两项N/A。不能把历史榜的类别改成简介，不能据旧比赛年级推断仍在校。
3. 对14项未执行的主办方检索实际搜索姓名、完整用时、日期/赛事，保存关键词、日期、具体地址和读取结果。HTML最终结果或官方计时平台可用，不必继续只找PDF。无法访问/官方档案无公开结果时，如实记录失败或not-found，执行独立替代查询，关联大学等一手结果证据和局限；不能批量把not-started改blocked。
4. 对吉田響的サンベルクス、太田蒼生的GMO，各自补3项employer-results。简介与比赛结果分开，检查毕业后的实际结果至scope.asOf；搜到更快值纳入候选比较。访问失败记录实业团实际目标及替代正式结果、pbUpdate范围和局限；旧大学PB不是毕业后更新。
5. 吉田半马读取RUNNET官方计时页面，区分简介/名单/最终成绩，确认正式半马距离和日期再标results及映射证据。山口半马补两项雇主适用性评估，not-found仍可保持，没有成绩就不造值/日期。
6. 对所有blocked和N/A保留人工审核项，说明具体剩余局限、身份/赛事/距离判断依据。执行research:validate，再带任务方授权文件及摘要运行research:complete；实际步骤、授权均满足后才由执行者明确声明送审，程序不自动设true。
7. 交付差异与未完成项目供ChatGPT独立联网复核；离线结构通过不代表证据充分或全网PB已查全。不得自行降低状态/改旧事实来消除告警，不启动16–20。
