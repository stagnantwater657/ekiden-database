# 第一期：可交叉检索的赛事数据库

本文记录第一阶段范围。第56回两支选拔队及27队总用时现已补齐；原200条成绩与25个综合排名未改。当前范围见[补录记录](all-japan-2024-completion.md)。

成绩表的五列布局、区间/大学视图、最终排名字段及当前排序契约见 [成绩查询阅读视图](results-views.md)。下文保留第一期结构说明。

## 已接入数据

2024-11-03 第 56 届全日本大学駅伝，25 所正式参赛大学 × 8 区间，共 200 条成绩、200 名选手。覆盖全部正式参赛大学，不含日本学连选拔、东海学连选拔两支公开队；因此区间顺位可能跳号，不能根据本库子集重排官方顺位。

- 原始来源：[主办方官方成绩 PDF](https://daigaku-ekiden.com/result/files/result_241103.pdf)，第 2 页，下排区间记录及方括号内区间顺位。
- 来源入口：[日本陸連大会页面](https://www.jaaf.or.jp/competition/detail/1888/)，其「リザルト」链接指向上述文件。
- 结构化批次现迁移至 `data/editions/all-japan-2024.json`，原 `data/all-japan-2024.json` 保留为回归快照；多届导入见 [历史数据导入](historical-data-import.md)。`sources[].collectedAt` 记录本次实际采集的 UTC 时间，而非赛事日期。来源记录另含覆盖范围及页码定位。
- 姓名和大学简称保留官方表写法；不从姓名自动猜读音、生日或历史身份，不建立无依据的 PB。出生日期为 `null`，界面显示 `—`。
- 用时转为整数秒。官方顺位独立存储；相同显示秒数不一定同顺位，例如 1 区存在官方细分顺位；7 区两条 50:07 均保留第 2 位。
- 单元测试将 25 校区间合计逐一与第 1 页官方总成绩对照，但不会将这一检查当作姓名或顺位校验的替代。

## 实体与数据访问

`lib/model.ts` 定义以下实体，均采用稳定字符串主键。ID 一经发布不可按数组顺序重新生成；当前选手 ID 虽带首批录入标记，仍为长期身份键，后续同人记录须经人工核验复用，不能仅按姓名合并。

| 实体 | 关系 / 说明 |
| --- | --- |
| Race | 赛事系列，例如全日本；独立于年份 |
| Edition | 属于 Race，含年、届数、举办日 |
| Section | 属于 Edition，含区间序号和距离；允许历届赛道变化 |
| University | 大学身份；当前名称沿用官方简称 |
| Athlete | 选手身份，不永久绑定大学 |
| Entry | 一所大学在一届赛事的参赛记录 |
| SectionResult | 关联 Entry、Section、Athlete；整数秒、官方顺位可为空 |
| Source | URL、实际采集时间、页码、覆盖范围；各实体含 sourceId |

`lib/repository.ts` 是独立文件适配器。页面只通过 `getRepository().catalog()` / `.search()` 访问数据，不直接导入 JSON。异步接口便于替换存储实现。初始化检查 ID、来源、外键、同届关联、重复出场与成绩值；失败交给页面错误边界，不静默展示损坏关联。

`lib/query.ts` 集中解析 URL：`race`、`edition`、`year`、`university`、`section`（区间序号）、`athlete`（身份 ID）、`q`（姓名子串）、`sort`、`direction`、`page`、`pageSize`。筛选按 AND 组合，姓名规范化 NFKC 并忽略空格。未知实体条件返回无结果，非法分页/排序恢复默认，过大页码展示末页。排序支持全部七列，空值始终最后，同值按 ID 保证稳定分页。可选每页 10 / 25 / 50 条。

## 页面路由

| 路由 | 用途 |
| --- | --- |
| `/` | 保留原视觉，新增真实业务入口 |
| `/races` | 已收录赛事列表 |
| `/races/[id]` | 赛事系列及届次列表 |
| `/editions/[id]` | 届次详情及固定当届的成绩检索 |
| `/results` | 完整交叉检索 |
| `/athletes` | 按姓名、大学、届次查找选手 |
| `/athletes/[id]` | 选手详情及其成绩，大学从参赛记录关联 |
| `/universities` | 已收录大学入口 |
| `/universities/[id]` | 大学详情及其历届成绩 |

所有成绩表共享筛选、排序、分页和数据来源组件。GET 表单与 Next Link 均将状态写入 URL，刷新、直接访问、分享和历史前进后退可恢复条件。变更筛选或排序重置分页；详情页的固定身份条件由服务端覆盖 URL，无法通过参数改成其他主体。表单按 URL 状态重新挂载，防止浏览器历史恢复后显示旧值。

共享 loading/error/not-found 提供加载中、加载失败重试、档案未收录状态；列表及成绩表提供暂无数据和筛选无结果提示。小屏表格在自身容器内横向滚动，筛选控件有标签，排序列有 aria-sort，分页有导航标签。

## 检查方式

```sh
npm ci --no-audit --no-fund
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
docker build -t ekiden-phase-one .
```

在已安装 Chromium 的开发环境可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`。云环境 Docker 可使用现有 `proxy_ca` secret 挂载证书，不修改 Dockerfile、安全策略或生产配置。

数据测试覆盖关联完整性、官方合计、筛选组合、空数据、空成绩、排序、并列、分页及 URL 解析；Playwright 在生产构建上测试首页到赛事/选手/大学的闭环、URL 分享/刷新/前进后退、空结果、无效 ID 及移动端。CI 保留原检查，追加 Chromium 导航测试。

## 下一阶段 PostgreSQL 迁移

1. 建立与上述实体一一对应的表，保留现有稳定 ID；为所有外键加约束。建立 `UNIQUE(race_id, year, number)`、`UNIQUE(edition_id, number)`（区间）、`UNIQUE(edition_id, university_id)`（参赛）、`UNIQUE(entry_id, section_id)` 及同届选手唯一出场约束。跨表同届一致性由事务和约束触发器确保。
2. 以一个事务导入来源、赛事、届次、区间、大学、选手、参赛记录、成绩；迁移前后对照行数、外键、各校用时总和和代表性查询。来源和采集批次不可覆盖，修正记录保留审计历史。
3. 为参赛届次/大学、成绩选手/区间建索引；逐步添加姓名检索规范化字段及 trigram 索引。将筛选、稳定排序和分页下推 SQL；排序字段用白名单映射，参数化过滤值。
4. 实现相同异步 Repository 契约，运行同一筛选契约测试；页面路由与 URL 参数保持兼容。数据增长后将 catalog 拆成轻量选项查询及实体按 ID 获取，避免加载完整成绩集。
5. 扩充年份及公开选拔队前增加 Team/Entry 类型，明确选拔队与原属大学的区别；不会把选拔队误建为大学。新增选手读音、PB 等只在独立来源核实后引入。

本期不包含账号、社区、发帖、预测或正式部署。
