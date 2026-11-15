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
