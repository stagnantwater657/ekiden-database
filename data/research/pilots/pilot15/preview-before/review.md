# PB CSV 人工审核报告

模式：dry-run；研究截止日：2026-11-25。全部记录待人工审核，未写入生产数据。

输入 26；匹配 18；更快 0；新增候选 18；同成绩 0；更慢 0；重复 0；身份冲突 0；无效 0；待补证据 8；同场多成绩 0。

状态可重叠，统计不相加；匹配只代表注册 ID 与历史姓名/大学关系相符。

| 行 | 选手 | 项目 | 现有成绩 | 输入成绩 | 判断 |
| --- | --- | --- | --- | --- | --- |
| 1 | 飯田 翔大 | half-marathon | — | 1:03:18 | 待补证据；待核验 |
| 2 | 小河原 陽琉 | 10000m | — | 27:57.76 | 新增候选；待核验 |
| 3 | 山本 歩夢 | 5000m | — | 13:34.85 | 待补证据；待核验 |
| 4 | 山本 歩夢 | 10000m | — | 27:51.44 | 新增候选；待核验 |
| 5 | 山本 歩夢 | half-marathon | — | 1:00:43 | 待补证据；待核验 |
| 6 | 飯國 新太 | 5000m | — | 13:51.98 | 新增候选；待核验 |
| 7 | 飯國 新太 | half-marathon | — | 1:01:51 | 待补证据；待核验 |
| 8 | 尾熊 迅斗 | 5000m | — | 13:57.11 | 待补证据；待核验 |
| 9 | 尾熊 迅斗 | 10000m | — | 28:35.45 | 新增候选；待核验 |
| 10 | 尾熊 迅斗 | half-marathon | — | 1:01:46 | 待补证据；待核验 |
| 11 | 谷中 晴 | 5000m | — | 13:49.71 | 待补证据；待核验 |
| 12 | 谷中 晴 | 10000m | — | 28:34.14 | 新增候选；待核验 |
| 13 | 谷中 晴 | half-marathon | — | 1:00:57 | 新增候选；待核验 |
| 14 | 小山 翔也 | 5000m | — | 13:41.99 | 新增候选；待核验 |
| 15 | 小山 翔也 | 10000m | — | 29:24.72 | 新增候选；待核验 |
| 16 | 小山 翔也 | half-marathon | — | 1:02:38 | 待补证据；待核验 |
| 17 | 安原 海晴 | 5000m | — | 13:52.85 | 新增候选；待核验 |
| 18 | 安原 海晴 | 10000m | — | 28:42.95 | 新增候选；待核验 |
| 19 | 安原 海晴 | half-marathon | — | 1:01:45 | 新增候选；待核验 |
| 20 | 桜井 優我 | 5000m | — | 13:58.87 | 新增候选；待核验 |
| 21 | 桜井 優我 | 10000m | — | 28:18.15 | 新增候选；待核验 |
| 22 | 吉倉 ナヤブ直希 | 5000m | — | 13:37.61 | 新增候选；待核验 |
| 23 | 吉倉 ナヤブ直希 | 10000m | — | 28:13.07 | 新增候选；待核验 |
| 24 | 吉倉 ナヤブ直希 | half-marathon | — | 1:02:26 | 新增候选；待核验 |
| 25 | 堀野 正太 | half-marathon | — | 1:02:28 | 新增候选；待核验 |
| 26 | 鈴木 琉胤 | 5000m | — | 13:20.64 | 新增候选；待核验 |

## 逐行定位与缺口

- 行 1（CSV 起始行 2）：未确认身份；2025-02-23；第72回公認鹿島祐徳ロードレース大会；来源 https://aogaku-tf.com/results-2024.html。
  缺口：university-association-only-after-performance-cutoff。
- 行 2（CSV 起始行 3）：athlete-aj25-03-8；2026-11-22；Colantotte presents MARCH対抗戦2026；来源 https://aogaku-tf.com/results.html。
- 行 3（CSV 起始行 4）：未确认身份；2023-07-08；ホクレン・ディスタンスチャレンジ2023 網走大会；来源 https://www.kokugakuin.com/top10/426/。
  缺口：university-association-only-after-performance-cutoff。
- 行 4（CSV 起始行 5）：athlete-aj24-01-6；2025-11-29；第325回日本体育大学長距離競技会兼第19回NITTAIDAI Challenge Games；来源 https://www.asahi-kasei.com/jp/sports-event/track-field/member/yamamoto。
- 行 5（CSV 起始行 6）：未确认身份；2022-02-13；第50回全日本実業団ハーフマラソン大会；来源 https://yaaf.jp/records/R03/20220213.pdf。
  缺口：university-association-only-after-performance-cutoff。
- 行 6（CSV 起始行 7）：athlete-aj25-01-5；2026-04-12；第327回日本体育大学長距離競技会；来源 https://www.kokugakuin.com/result/4009/。
- 行 7（CSV 起始行 8）：未确认身份；2025-02-02；第28回日本学生ハーフマラソン選手権大会；来源 https://gold.jaic.org/kagawa/2024/2025marugamehalf/rel003.html。
  缺口：university-association-only-after-performance-cutoff。
- 行 8（CSV 起始行 9）：未确认身份；2025-06-01；道南ディスタンス2025；来源 https://www.kokugakuin.com/result/3194/。
  缺口：university-association-only-after-performance-cutoff。
- 行 9（CSV 起始行 10）：athlete-aj25-01-1；2025-11-15；第324回日本体育大学長距離競技会；来源 https://www.kokugakuin.com/result/3567/。
- 行 10（CSV 起始行 11）：未确认身份；2025-02-02；第28回日本学生ハーフマラソン選手権大会；来源 https://gold.jaic.org/kagawa/2024/2025marugamehalf/rel003.html。
  缺口：university-association-only-after-performance-cutoff。
- 行 11（CSV 起始行 12）：未确认身份；2024-10-14；第4回出雲市陸協記録会；来源 https://komazawa-ekiden.com/results/10-14%E6%9C%88%E7%AC%AC4%E5%9B%9E%E5%87%BA%E9%9B%B2%E5%B8%82%E9%99%B8%E5%8D%94%E8%A8%98%E9%8C%B2%E4%BC%9A/。
  缺口：university-association-only-after-performance-cutoff。
- 行 12（CSV 起始行 13）：athlete-aj24-02-4；2026-06-21；あおもりディスタンスチャレンジ2026；来源 https://komazawa-ekiden.com/results/6%E6%9C%8821%E6%97%A5%E6%97%A5%E9%9D%92%E6%A3%AE%E3%83%87%E3%82%A3%E3%82%B9%E3%82%BF%E3%83%B3%E3%82%B9%E3%83%81%E3%83%A3%E3%83%AC%E3%83%B3%E3%82%B82026/。
- 行 13（CSV 起始行 14）：athlete-aj24-02-4；2025-02-02；第28回日本学生ハーフマラソン選手権大会；来源 https://komazawa-ekiden.com/results/2%E6%9C%882%E6%97%A5%E6%97%A5%E7%AC%AC28%E5%9B%9E%E6%97%A5%E6%9C%AC%E5%AD%A6%E7%94%9F%E3%83%8F%E3%83%BC%E3%83%95%E3%83%9E%E3%83%A9%E3%82%BD%E3%83%B3%E9%81%B8%E6%89%8B%E6%A8%A9%E5%A4%A7%E4%BC%9A/。
- 行 14（CSV 起始行 15）：athlete-aj25-02-1；2025-06-01；第321回日本体育大学長距離競技会；来源 https://komazawa-ekiden.com/results/5%E6%9C%8831%E6%97%A5%E5%9C%9F%E7%AC%AC321%E5%9B%9E%E6%97%A5%E6%9C%AC%E4%BD%93%E8%82%B2%E5%A4%A7%E5%AD%A6%E9%95%B7%E8%B7%9D%E9%9B%A2%E7%AB%B6%E6%8A%80%E4%BC%9A/。
- 行 15（CSV 起始行 16）：athlete-aj25-02-1；2025-06-22；2025年度あおもりディスタンスチャレンジ記録会；来源 https://komazawa-ekiden.com/results/6%E6%9C%8822%E6%97%A5%E6%97%A52025%E5%B9%B4%E5%BA%A6-%E3%81%82%E3%81%8A%E3%82%82%E3%82%8A%E3%83%87%E3%82%A3%E3%82%B9%E3%82%BF%E3%83%B3%E3%82%B9%E3%83%81%E3%83%A3%E3%83%AC%E3%83%B3%E3%82%B8%E8%A8%98/。
- 行 16（CSV 起始行 17）：未确认身份；2024-11-17；第37回2024上尾シティハーフマラソン；来源 https://komazawa-ekiden.com/results/11%E6%9C%8817%E6%97%A5%E6%97%A5%E7%AC%AC37%E5%9B%9E2024%E4%B8%8A%E5%B0%BE%E3%82%B7%E3%83%86%E3%82%A3%E3%83%8F%E3%83%BC%E3%83%95%E3%83%9E%E3%83%A9%E3%82%BD%E3%83%B3/。
  缺口：university-association-only-after-performance-cutoff。
- 行 17（CSV 起始行 18）：athlete-aj24-02-6；2025-09-27；TOKAI DISTANCE CHALLENGE 第240回東海大学長距離競技会；来源 https://komazawa-ekiden.com/results/9%E6%9C%8827%E6%97%A5%E5%9C%9F%E3%83%BB28%E6%97%A5%E6%97%A5tokai-distance-challenge-%E7%AC%AC240%E5%9B%9E%E6%9D%B1%E6%B5%B7%E5%A4%A7%E5%AD%A6%E9%95%B7%E8%B7%9D%E9%9B%A2%E7%AB%B6%E6%8A%80%E4%BC%9A/。
- 行 18（CSV 起始行 19）：athlete-aj24-02-6；2026-07-12；関東学生網走夏季記録挑戦競技会；来源 https://komazawa-ekiden.com/results/7%E6%9C%8812%E6%97%A5%E6%97%A5%E9%96%A2%E6%9D%B1%E5%AD%A6%E7%94%9F%E7%B6%B2%E8%B5%B0%E5%A4%8F%E5%AD%A3%E8%A8%98%E9%8C%B2%E6%8C%91%E6%88%A6%E7%AB%B6%E6%8A%80%E4%BC%9A/。
- 行 19（CSV 起始行 20）：athlete-aj24-02-6；2026-02-01；第29回日本学生ハーフマラソン選手権大会；来源 https://komazawa-ekiden.com/results/2%E6%9C%881%E6%97%A5%E6%97%A5%E7%AC%AC29%E5%9B%9E%E6%97%A5%E6%9C%AC%E5%AD%A6%E7%94%9F%E3%83%8F%E3%83%BC%E3%83%95%E3%83%9E%E3%83%A9%E3%82%BD%E3%83%B3%E9%81%B8%E6%89%8B%E6%A8%A9%E5%A4%A7%E4%BC%9A/。
- 行 20（CSV 起始行 21）：athlete-aj24-06-6；2026-09-19；第2回中国実業団長距離記録会；来源 https://www.kraftia.co.jp/marathon/member/male/yuga\_sakurai.html。
- 行 21（CSV 起始行 22）：athlete-aj24-06-6；2026-11-21；27th NITTAIDAI Challenge Games；来源 https://www.kraftia.co.jp/marathon/result/2026/1121\_004752.html。
- 行 22（CSV 起始行 23）：athlete-aj25-05-4；2026-07-04；ホクレン・ディスタンスチャレンジ2026 千歳大会；来源 https://waseda-ac.jp/news/detail/926。
- 行 23（CSV 起始行 24）：athlete-aj25-05-4；2026-04-24；天皇賜盃第95回日本学生陸上競技対校選手権大会（10000m）；来源 https://waseda-ac.jp/competition/detail/816。
- 行 24（CSV 起始行 25）：athlete-aj25-05-4；2025-11-16；第38回2025上尾シティハーフマラソン；来源 https://waseda-ac.jp/competition/detail/740。
- 行 25（CSV 起始行 26）：athlete-aj25-05-3；2025-11-16；第38回2025上尾シティハーフマラソン；来源 https://waseda-ac.jp/competition/detail/740。
- 行 26（CSV 起始行 27）：athlete-aj25-05-2；2026-04-11；第34回金栗記念選抜陸上中長距離大会；来源 https://waseda-ac.jp/competition/detail/800。

## 审核边界

- Comparison only against the local published PB snapshot; never proof of current/latest PB or verified evidence.
- All rows require human review of identity, affiliation at meet, official distance, timing, indoor/outdoor, event identity and source/version.
- Name-only matches and unregistered kanji variants are suggestions, never automatic identity merges.
- Same meet means equal ISO date and whitespace-normalized meet label, not independently verified event identity.
- Sources are not fetched. Registered source IDs do not certify this row. No production data or research logs are written.
