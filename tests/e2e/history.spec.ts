import { test, expect } from "@playwright/test";
import { database } from "../../data/index";
const athleteId = "athlete-aj24-01-5";
const sharedRows = database.results.filter((row) => row.athleteId === athleteId);
const season2025 = new Set(database.entries.filter((entry) =>
  database.editions.some((edition) => edition.id === entry.editionId && edition.seasonYear === 2025),
).map((entry) => entry.id));
const seasonRows = sharedRows.filter((row) => season2025.has(row.entryId));
const selectionEntries = new Set(database.entries.filter((entry) => entry.teamId === "team-japan-selection").map((entry) => entry.id));
const selectionRows = database.results.filter((row) => selectionEntries.has(row.entryId));

test("2025 edition → shared athlete → both years → selection team, including mobile", async ({
  page,
}) => {
  await page.goto("/editions/all-japan-2025");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "第 57 届",
  );
  await expect(page.getByRole("status")).toHaveText("共 216 条成绩");
  await page.getByLabel("选手姓名").fill("野中");
  await page.getByRole("button", { name: "应用筛选" }).click();
  await page.getByRole("link", { name: "野中 恒亨", exact: true }).click();
  await expect(page).toHaveURL(/athletes\/athlete-aj24-01-5/);
  await expect(page.getByRole("status")).toHaveText(`共 ${sharedRows.length} 条成绩`);
  await expect(page.locator("tr[data-result-id]")).toHaveCount(sharedRows.length);
  // The original verified identity still points to both original records.
  const originalRows = sharedRows.filter((row) => row.id.startsWith("aj24-") || row.id.startsWith("aj25-"));
  expect(originalRows).toHaveLength(2);
  for (const row of originalRows) await expect(page.locator(`tr[data-result-id="${row.id}"]`)).toBeVisible();
  await expect(page.locator("table")).toContainText("2024");
  await expect(page.locator("table")).toContainText("2025");
  await expect(page.locator("table")).toContainText("33:11");
  await page
    .getByRole("combobox", { name: "赛季", exact: true })
    .selectOption("2025");
  await page.getByRole("button", { name: "应用筛选" }).click();
  await expect(page).toHaveURL(/season=2025/);
  await page.reload();
  await expect(page.getByRole("status")).toHaveText(`共 ${seasonRows.length} 条成绩`);
  await page.goBack();
  await expect(page.getByRole("status")).toHaveText(`共 ${sharedRows.length} 条成绩`);
  await page.goForward();
  await expect(page.getByRole("status")).toHaveText(`共 ${seasonRows.length} 条成绩`);
  await page.goto(
    "/results?team=team-japan-selection&season=2025&view=university",
  );
  await page
    .getByRole("link", { name: "日本学連選抜", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/teams\/team-japan-selection/);
  await expect(page.getByRole("status")).toHaveText(`共 ${selectionRows.length} 条成绩`);
  await expect(page.locator("table")).toContainText("参考成绩");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "应用筛选" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto("/results?race=all-japan&season=2025&view=university");
  await expect(page.locator("tr[data-result-id]").first()).toContainText(
    "駒澤大",
  );
  await expect(
    page.getByRole("complementary", { name: "数据范围与来源" }),
  ).toContainText("2025");
});

test("new race cards → editions → one athlete across all three races on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [raceId, name] of [["izumo", "出云"], ["hakone", "箱根"]] as const) {
    await page.goto("/");
    await page.getByRole("link", { name: `${name}赛事入口`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/races/${raceId}$`));
    const edition = database.editions.filter((entry) => entry.raceId === raceId).sort((a, b) => b.year - a.year)[0];
    expect(edition).toBeTruthy();
    await page.getByRole("link", { name: new RegExp(`${edition.year} · 第 ${edition.number} 届`) }).click();
    const entries = new Set(database.entries.filter((entry) => entry.editionId === edition.id).map((entry) => entry.id));
    await expect(page.getByRole("status")).toHaveText(`共 ${database.results.filter((row) => entries.has(row.entryId)).length} 条成绩`);
    await expect(page.getByRole("button", { name: "应用筛选" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.goto("/editions/izumo-2025?q=黒田");
  await page.getByRole("link", { name: "黒田 朝日", exact: true }).click();
  await expect(page).toHaveURL(/athletes\/athlete-aj24-03-4/);
  const rows = database.results.filter((row) => row.athleteId === "athlete-aj24-03-4");
  const editionIds = new Set(rows.map((row) => database.entries.find((entry) => entry.id === row.entryId)!.editionId));
  expect(new Set(database.editions.filter((edition) => editionIds.has(edition.id)).map((edition) => edition.raceId))).toEqual(new Set(["all-japan", "izumo", "hakone"]));
  await expect(page.getByRole("status")).toHaveText(`共 ${rows.length} 条成绩`);
  const context = page.getByRole("complementary", { name: "查询上下文" });
  for (const race of database.races) await expect(context).toContainText(race.name);
  await context.getByRole("link", { name: /2026 · 第 102 届/ }).click();
  await expect(page).toHaveURL(/editions\/hakone-2026/);
  await expect(page.getByRole("status")).toHaveText("共 210 条成绩");
});

test('2024 completion → reference selection team → shared athlete → same-season Hakone', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/editions/all-japan-2024?team=team-japan-selection');
  await expect(page.getByRole('status')).toHaveText('共 8 条成绩');
  await expect(page.locator('tbody')).toContainText('片川 祐大');
  await expect(page.locator('tbody')).not.toContainText('综合 26');
  await page.getByRole('link',{name:'日本学連選抜',exact:true}).first().click();
  await expect(page).toHaveURL(/teams\/team-japan-selection/);
  await page.getByLabel('选手姓名').fill('片川');
  await page.getByRole('button',{name:'应用筛选'}).click();
  await page.getByRole('link',{name:'片川 祐大',exact:true}).click();
  await expect(page).toHaveURL(/athletes\/athlete-hk25-21-1/);
  await expect(page.getByRole('status')).toHaveText('共 2 条成绩');
  const context=page.getByRole('complementary',{name:'查询上下文'});
  await expect(context).toContainText('第 56 届');await expect(context).toContainText('第 101 届');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
