# 历史赛事数据导入（schemaVersion 2）

## 数据边界

`data/registry/entities.json` 维护稳定的 Race、University、Athlete、Team 及共享 Source。`data/editions/<id>.json` 各自保存 Edition、Section、Entry、SectionResult、本批 Source 与身份决策。`data/manifest.json` 登记已发布届次；生成的 `data/index.ts` 统一汇总，异步 Repository 接口不变。原 `data/all-japan-2024.json` 仅为不可变回归快照，不再是运行时数据库。

- Edition：实际举办年份 `year`、日期 `date`（两日赛另存 `endDate`）、赛季 `seasonYear` 独立。箱根赛季=举办年−1；出云/全日本=举办年。11届规划在 `data/import-plan.json`，11届均已导入，规划不会制造公开届次或成绩。无第103回箱根成绩。
- Team 与 University 分离：正式大学队关联大学；学联/海外选拔队没有虚构的 universityId。Entry 关联当届队伍，保存独立的官方综合排名、总用时、状态与各自来源。
- SectionResult 关联 Entry、Section、Athlete、Source，保留官方区间顺位；当次年级、代表大学、参与名单来源属于当次出场，不写到永久 Athlete。支持 `finished/reference/unranked/disqualified/did-not-finish/did-not-start/unknown`，无排名用null，不用0或数组位置代替。
- Athlete 是稳定身份：姓名归一化/别名仅找候选，不能证明身份。`IdentityDecision` 保存每条出场的观测姓名、处理结论、候选ID、证据来源和说明；只有独立核验后才复用旧ID。未知保持独立并列审核清单。毕业不删除历史成绩。

公开旧路由与 query 继续可用；新增 `/teams/[id]`、`season`、`team`。大学详情仍为 `/universities/[id]`。既有区间/大学视图、手动排序、分页保持同一 Repository 行为；跨届不会混排区间。来源栏显示当前查询涉及的成绩、排名、总用时和年级来源，以及采用版本。

## 新一届的操作步骤

1. 在独立分支核查发布渠道的使用条件，记录链接、采集日、覆盖范围、采用版本、页码定位。只建立自己的事实表；不得把页面/PDF存进仓库。明确禁止自动提取时不要抓取，单独标记人工处理部分。
2. 从最终成绩录入真实实际出场选手、区间距离/时间/官方顺位、队伍总时间/官方综合顺位。核对区间明细与总表，不能用累计通过顺位代替区间顺位，排名资格按当届官方结果确定：选拔队可以是正式排名或参考资格，不能仅凭队伍类型推定。
3. 用 `identityCandidates` 查找别名候选，逐人核查独立身份材料。新增实体用新稳定ID；旧注册实体不可覆写。身份不确定时新建独立ID，决策为 `needs-review`。补齐 `reason` 与 `evidenceSourceIds`，严禁仅凭同名确认。
4. 准备本地候选 JSON：`{ "registry": {"sources":[],"races":[],"universities":[],"athletes":[],"teams":[]}, "batch": <EditionBundle> }`。registry只放新增/相同实体，本批来源放batch.sources；每条新成绩必须有status和locator。本批完整正式完赛队必须有官方排名/总时间。
5. 先验证、再写入（命令离线，不下载任何网站）：

   ```sh
   npm run data:import -- --input /tmp/candidate.json
   npm run data:import -- --input /tmp/candidate.json --write
   node --experimental-strip-types scripts/data-import.ts > data/reports/validation.json
   ```

   导入前验证所有关联和完整阵容，验证通过才写文件，manifest最后更新。文件替换逐个原子执行，不是跨文件事务；中断后检查git diff并重跑，只有完整通过检查的提交才发布。同一届内容相同重复导入不会增加实体；同ID不同内容直接报错，不静默覆盖。既有届次补录使用[受控修订流程](data-revisions.md)，先审核带前后哈希的差异；普通导入同ID冲突保护不变。
6. 对既有批次复现导入：

   ```sh
   node --experimental-strip-types scripts/data-import.ts --export all-japan-2025 > /tmp/reimport.json
   npm run data:import -- --input /tmp/reimport.json
   ```

   export携带完整registry，方便离线复验；不得将原始官方文件作为导入附件。检查实际输出报告中的队数、出场人数、官方排名数、跨届复用数、审核清单和结果hash。新数据的事实核验表须与逐区间来源复核，不能靠由同一错误数据计算出的测试证明正确。
7. 运行 `npm run data:validate`、`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`、`npm run test:e2e` 和既有 Docker/CI 检查。新增一届的实数断言与至少一个真实跨届导航用例；不要通过改变2024回归快照让测试通过。原CI和部署授权机制不变。
8. PR说明覆盖、来源版本、校验、复用数量与审核项。常规增量每PR一届、最多两届；本次依用户授权分三批提交九届、汇总为一个PR。不自动合并或部署。

Entry可选`rankingEligibility`明确当届正式/参考资格（旧记录维持原默认）；`stages`保存箱根往路/复路区间范围、官方时间及来源，独立阶段名次未核实则null。各阶段也校验区间用时合计，不能用相互抵消的误差满足总计。

## 当前覆盖及真实例子

覆盖11届/2,030条记录，详见[逐届验收统计](batch-import-report.md)。第56回已补齐至27队/216条、27个总用时；第57回维持27队/216条。原第一阶段25队/200条及两届60名共同选手的测试基线仍保留，新增12个跨届身份关联另作完整性回归验证。野中恒亨的同一个 `/athletes/athlete-aj24-01-5` 页面可查2024年5区35:35（区间1）与2025年3区33:11（区间1）；两年國學院最终出场名单分别为2年和3年。

计划11届均已导入。现有131项身份审核保持原样；本次新增16条出场均有完整姓名、原属大学、年级依据，没有新增待审核身份。后续仍须按实际核验资料处理，不能根据计划自动生成结果。

## 后续 PostgreSQL 迁移

各JSON实体对应独立表，现有字符串ID直接作主键，保留所有外键；Source及使用/版本信息独立保存，identity decisions与候选/证据可拆为关系表。为 `(edition_id,team_id)`、`(entry_id,section_id)`、`(edition_id,athlete_id)` 建唯一约束；排名nullable、状态独立。导入事务先暂存及核验再提交，revision审计单独保存，不重新编号旧ID。实现同一异步catalog/search接口和URL编解码，复用现有筛选/排序契约及回归测试；本阶段没有引入数据库服务。

## 身份统计口径

报告用两个去重人数替代含义模糊的旧字段：

- `crossEditionAthletes`：本届选手中，与其他已收录届次共享稳定 athleteId 的人数；不区分先后。
- `reusedFromEarlierEditions`：本届选手中，在实际比赛日期严格早于本届的赛事已出现的稳定 athleteId 人数。同日比赛不算更早；不使用赛季、文件顺序或导入时间。

当前全库第56回分别为183/140，第57回为174/137，由实际数据计算。原第一阶段两届测试子集仍为60/0和60/60。以后补录更早届次会正常改变后一个指标；同一选手出现多届仍只计一人。待审核候选没有合并ID，不作为共享或复用身份统计。
