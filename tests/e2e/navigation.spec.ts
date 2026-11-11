import { test, expect } from "@playwright/test";
test("home → race → edition → athlete → university → results", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "全日本赛事入口", exact: true }).click();
  await page.getByRole("link", { name: /2024 · 第 56 届/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("2024");
  await page.getByLabel("选手姓名").fill("嘉数");
  await page.getByRole("button", { name: "应用筛选" }).click();
  await expect(page.getByRole("status")).toHaveText("共 1 条成绩");
  await page.getByRole("link", { name: "嘉数 純平", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("嘉数 純平");
  await page.getByRole("link", { name: "國學院大", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("共 8 条成绩");
  await page.getByRole("link", { name: "6区 · 12.8 km" }).click();
  await expect(page.getByRole("status")).toHaveText("共 25 条成绩");
  await expect(page).toHaveURL(/section=6/);
  await page
    .getByRole("link", { name: "全日本大学駅伝", exact: true })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "第 56 届",
  );
});
test("GET filters, sort, pagination, reload, sharing and back/forward", async ({
  page,
}) => {
  await page.goto("/results");
  await page
    .getByRole("combobox", { name: "每页", exact: true })
    .selectOption("10");
  await page.getByRole("button", { name: "应用筛选" }).click();
  await page.getByRole("link", { name: "下一页", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await page.reload();
  await expect(
    page.getByRole("navigation", { name: "成绩分页" }),
  ).toContainText("第 2 / 20 页");
  await page
    .getByRole("columnheader", { name: /成绩/ })
    .getByRole("link")
    .click();
  await expect(page).toHaveURL(/sort=time/);
  await expect(
    page.getByRole("columnheader", { name: /成绩/ }),
  ).toHaveAttribute("aria-sort", "ascending");
  await page.goBack();
  await expect(page).toHaveURL(/page=2/);
  await page.goForward();
  await expect(page).toHaveURL(/sort=time/);
  const shared = page.url();
  await page.goto("/");
  await page.goto(shared);
  await expect(
    page.getByRole("combobox", { name: "排序", exact: true }),
  ).toHaveValue("time");
  await page
    .getByRole("combobox", { name: "大学", exact: true })
    .selectOption("kokugakuin");
  await page
    .getByRole("combobox", { name: "区间", exact: true })
    .selectOption("6");
  await page.getByRole("button", { name: "应用筛选" }).click();
  await expect(page.getByRole("status")).toHaveText("共 1 条成绩");
  await expect(page.locator("tbody")).toContainText("山本 歩夢");
});
test("empty filters, invalid IDs and mobile table", async ({ page }) => {
  await page.goto("/results?q=不存在的选手");
  await expect(
    page.getByText("筛选无结果，请调整条件或重置筛选。"),
  ).toBeVisible();
  await page.getByRole("link", { name: "重置筛选" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(25);
  await page.goto("/athletes/unknown");
  await expect(page.getByRole("heading", { name: "暂无此档案" })).toBeVisible();
  await page.getByRole("link", { name: "返回区间成绩查询" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "应用筛选" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
