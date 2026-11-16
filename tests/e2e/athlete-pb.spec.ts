import { test, expect } from "@playwright/test";

const firstBatch = [
  "athlete-aj25-02-7", // 佐藤 圭汰
  "athlete-aj24-03-4", // 黒田 朝日
  "athlete-aj24-02-3", // 伊藤 蒼唯
  "athlete-aj24-05-2", // 山口 智規
  "athlete-aj24-12-1", // 溜池 一太
];

test("selected athletes have independent PB slots and retain their race history", async ({ page }) => {
  for (const id of firstBatch) {
    await page.goto(`/athletes/${id}`);
    const section = page.locator("section").filter({ has: page.getByRole("heading", { name: /个人最佳/ }) });
    await expect(section.getByRole("heading", { name: "5000m", exact: true })).toBeVisible();
    await expect(section.getByRole("heading", { name: "10000m", exact: true })).toBeVisible();
    await expect(section.getByRole("heading", { name: "半程马拉松", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /三大驿传战绩/ })).toBeVisible();
    await expect(section).toContainText("不使用驿传区间用时推算");
  }
});

test("PB cards stay legible at phone width without horizontal page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/athletes/athlete-aj24-03-4");
  await expect(page.getByRole("heading", { name: /个人最佳/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("published first-batch PBs render mark, date, meet and source link", async ({ page }) => {
  await page.goto("/athletes/athlete-aj24-05-2");
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: /个人最佳/ }) });
  await expect(section).toContainText("13:16.38");
  await expect(section).toContainText("2026-04-11");
  await expect(section).toContainText("金栗記念");
  await expect(section.locator('a[href="https://www.rikujyokyogi.co.jp/archives/204717"]')).toBeVisible();
  await page.goto("/athletes/athlete-aj24-12-1");
  const half = page.locator("section").filter({ has: page.getByRole("heading", { name: /个人最佳/ }) });
  await expect(half).toContainText("1:00:13");
  await expect(half).toContainText("東京レガシーハーフ");
  await page.goto("/athletes/athlete-aj25-02-7");
  await expect(page.locator("section").filter({ has: page.getByRole("heading", { name: /个人最佳/ }) })).toContainText("27:28.50");
});

test("PB cells separate a confirmed absence from an unfound record, and indoor marks get a tag", async ({ page }) => {
  await page.goto("/athletes/athlete-aj25-02-7");
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: /个人最佳/ }) });
  await expect(section).toContainText("13:09.45");
  await expect(section.getByText("室内", { exact: true })).toBeVisible();
  const half = section.getByRole("heading", { name: "半程马拉松", exact: true }).locator("..");
  await expect(half).toContainText("暂无正式成绩");
  await expect(half).not.toContainText("尚未收录");
  await page.goto("/athletes/athlete-aj24-01-2");
  const empty = page.locator("section").filter({ has: page.getByRole("heading", { name: /个人最佳/ }) });
  const emptyFive = empty.getByRole("heading", { name: "5000m", exact: true }).locator("..");
  await expect(emptyFive).toContainText("尚未收录");
  await expect(emptyFive).not.toContainText("暂无正式成绩");
});
