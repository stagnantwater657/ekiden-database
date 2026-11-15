import { test, expect } from "@playwright/test";
import { database } from "../../data/index";

test("non-winning new records and record ties survive athlete navigation with their actual sources", async ({ page }) => {
  await page.goto("/editions/all-japan-2026?section=2");
  const row = page.locator('tr[data-result-id="aj26-result-01-2"]');
  await expect(row.locator(".result-badge--record")).toHaveText("区間新");
  await expect(row.locator(".result-badge--award")).toHaveCount(0);
  await expect(page.locator(".scoreboard-table .result-badge--award")).toHaveCount(2);
  const result = database.results.find((r) => r.id === "aj26-result-01-2")!;
  await row.locator(`a[href="/athletes/${result.athleteId}"]`).click();
  await expect(page.locator('tr[data-result-id="aj26-result-01-2"] .result-badge--record')).toHaveText("区間新");
  await page.goto("/editions/izumo-2026?section=3");
  await expect(page.locator('tr[data-result-id="iz26-result-08-3"] .result-badge--tie')).toHaveText("区間タイ");
  await expect(page.locator('tr[data-result-id="iz26-result-08-3"] .result-badge--record')).toHaveCount(0);
  const winner = database.results.find((r) => r.id === "iz26-result-13-3")!;
  await page.locator(`tr[data-result-id="${winner.id}"] a[href="/athletes/${winner.athleteId}"]`).click();
  await page.locator('details[aria-label="档案资料来源"] summary').click();
  await expect(page.locator('a[href="https://www.rikujyokyogi.co.jp/archives/219067"]')).toBeVisible();
});

test("current course records retain co-holders, university and edition links on mobile", async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  await page.goto("/races/all-japan");
  const table = page.getByRole("region", { name:"区间路线与官方纪录" });
  const second = table.locator("tbody tr").filter({ hasText: "増子 陽太" });
  const coholder = table.locator("tbody tr").filter({ hasText: "楠岡 由浩" });
  await expect(second).toContainText("30:51");
  await expect(second).toContainText("増子 陽太");
  await expect(coholder).toContainText("楠岡 由浩");
  await expect(second.locator('a[href="/universities/waseda"]')).toHaveCount(1);
  await expect(coholder.locator('a[href="/universities/teikyo"]')).toHaveCount(1);
  await expect(second.locator('a[href="/editions/all-japan-2026"]')).toHaveCount(1);
  await expect(coholder.locator('a[href="/editions/all-japan-2026"]')).toHaveCount(1);
  await expect(second.locator("th")).toHaveAttribute("rowspan", "2");
  await expect(table.locator("thead th")).toHaveText(["区间", "距离", "区间纪录", "纪录保持者", "大学", "年份"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await coholder.getByRole("link",{name:"楠岡 由浩",exact:true}).click();
  await expect(page.getByRole("heading",{level:1})).toContainText("楠岡");
  await page.goto("/races/izumo");
  await expect(page.getByRole("region",{name:"区间路线与官方纪录"})).toContainText("22:56");
  await page.goto("/races/hakone");
  await expect(page.locator("main")).toContainText("第93回");
  await expect(page.getByRole("region",{name:"区间路线与官方纪录"})).toContainText("1:07:16");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("official Hakone checkpoint standings replace the former gap and keep revised/disqualified entries intact", async ({page}) => {
  await page.goto("/editions/hakone-2026?section=5");
  await expect(page.locator("main")).toContainText("官方累计成绩");
  await expect(page.locator('tr[data-result-id="hk26-result-01-5"]')).toContainText("5:18:08");
  await page.getByRole("navigation",{name:"区间导航"}).getByRole("link",{name:"6区",exact:true}).click();
  await expect(page.locator("main")).toContainText("官方累计成绩");
  await expect(page.locator('tr[data-result-id="hk26-result-01-6"]')).toContainText("6:15:23");
  await page.reload();
  await expect(page.locator("main")).toContainText("官方累计成绩");
  await expect(page.locator('tr[data-result-id="hk26-result-01-6"]')).toContainText("6:15:23");
  await page.goto("/editions/izumo-2023?section=5");
  await expect(page.locator('tr[data-result-id="iz23-result-03-5"] .result-badge--award')).toHaveCount(0);
  await expect(page.locator('tr[data-result-id="iz23-result-10-5"] .result-badge')).toHaveCount(0);
  await expect(page.locator("main")).toContainText("补授");
});

test("section overview shows the record in force before the race, never the one set during it", async ({ page }) => {
  await page.goto("/editions/hakone-2026?section=2");
  const overview = page.getByRole("region", { name: "本区间成绩概览" });
  const recordBlock = overview.locator("div").filter({
    has: page.getByRole("heading", { name: "区间纪录", exact: true }),
  });
  await expect(recordBlock).toContainText("1:05:31");
  await expect(recordBlock).toContainText("エティーリ");
  await expect(recordBlock).toContainText("2025 第101回");
  // キムタイ's 1:05:09 broke it that day; it must stay a badge, not the record block.
  await expect(recordBlock).not.toContainText("1:05:09");
  await expect(
    page.locator('tr[data-result-id="hk26-result-07-2"] .result-badge--record'),
  ).toHaveText("区間新");
  await page.goto("/editions/all-japan-2026?section=2");
  const shared = page.getByRole("region", { name: "本区间成绩概览" });
  await expect(shared).toContainText("31:01");
  await expect(shared).toContainText("佐藤 圭汰");
  await expect(shared).toContainText("楠岡 由浩");
  await expect(shared).toContainText("共同纪录保持者");
  await page.goto("/editions/hakone-2024?section=5");
  await expect(page.getByRole("region", { name: "本区间成绩概览" })).toContainText("1:10:04");
});
