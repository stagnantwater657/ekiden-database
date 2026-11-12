import { test, expect } from "@playwright/test";
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
  await expect(page.getByRole("status")).toHaveText("共 2 条成绩");
  await expect(page.locator("tr[data-result-id]")).toHaveCount(2);
  await expect(page.locator("table")).toContainText("2024");
  await expect(page.locator("table")).toContainText("2025");
  await expect(page.locator("table")).toContainText("33:11");
  await page
    .getByRole("combobox", { name: "赛季", exact: true })
    .selectOption("2025");
  await page.getByRole("button", { name: "应用筛选" }).click();
  await expect(page).toHaveURL(/season=2025/);
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("共 1 条成绩");
  await page.goBack();
  await expect(page.getByRole("status")).toHaveText("共 2 条成绩");
  await page.goForward();
  await expect(page.getByRole("status")).toHaveText("共 1 条成绩");
  await page.goto(
    "/results?team=team-japan-selection&season=2025&view=university",
  );
  await page
    .getByRole("link", { name: "日本学連選抜", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/teams\/team-japan-selection/);
  await expect(page.getByRole("status")).toHaveText("共 8 条成绩");
  await expect(page.locator("table")).toContainText("参考成绩");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "应用筛选" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto("/results?season=2025&view=university");
  await expect(page.locator("tr[data-result-id]").first()).toContainText(
    "駒澤大",
  );
  await expect(
    page.getByRole("complementary", { name: "数据范围与来源" }),
  ).toContainText("2025");
});
