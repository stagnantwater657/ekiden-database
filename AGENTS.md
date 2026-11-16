# Ekiden Database：AI 协作入口

适用于 Codex、DSH 及其他助手。先检查分支、最新 main 与工作区；保留用户未提交修改。按任务边界创建独立 PR，不自动合并或部署，不修改 SSH、sudoers、BuildKit、部署授权机制。

## 资料研究前必读

涉及出生日期、出身高中、所属经历、5000m/10000m/半马 PB、三大驿传历史成绩、区间纪录、奖项或统计时，先读：

1. [研究手册](docs/research/athlete-research-playbook.md)与[具体来源目录](docs/research/source-catalog.md)。
2. [日志契约](docs/research/audit-log.md)、[回归案例](docs/research/regression-cases.md)、[持续改进流程](docs/research/lessons-learned.md)。
3. 选手资料：[生产数据契约](docs/athlete-pb-phase1.md)；历史赛事：[导入流程](docs/historical-data-import.md)及[受控修订](docs/data-revisions.md)；纪录、累计与奖项：[认定口径](docs/official-records-completion.md)。

## 不可省略的原则

- 不编造无来源事实，不从其他距离或驿传区间推算 PB；正式比赛不要求必须被 World Athletics 收录。
- 搜索失败不证明没有成绩；访问首页不等于检索整个网站。优先核验有赛事、日期与成绩的一手资料。
- 区分当前 PB 与历史 PB、正式结果与参考成绩、当届所属与永久身份；不能仅凭同名合并选手。
- 遵守具体来源的访问与使用条件，不绕过限制，不推断已经取得授权。
- 不自行放宽来源或验证标准。规则变更提交独立评审，不由执行者自批生效。

## 每次研究的交付

读规则 → 分层检索（发现、反向检索、最终核验）→ 如实记录关键词、具体来源与结果 → 验证 → 报告缺口、错误与改进建议。日志只记录实际执行的步骤，不补造旧任务访问历史。

新增/修改事实须附 `data/research/batches/` 日志；旧数据不要求一次性补录。运行 `npm run research:validate`、`npm run data:validate` 及任务要求的测试。CI 只能检查结构和部分一致性，访问真实性、身份归属、最新 PB 和证据充分性仍须独立复核。交接可用[启动模板](docs/research/task-template.md)。
