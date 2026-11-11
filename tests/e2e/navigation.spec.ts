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
    .getByRole("link", {
      name: "全日本大学駅伝 · 2024 · 第 56 届",
      exact: true,
    })
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

test("five columns, query context, view switch resets page and sort, sources follow results", async ({
  page,
}) => {
  await page.goto("/results?pageSize=10&page=2&sort=time&direction=desc");
  await expect(
    page.getByText("正在跨区间按用时排序：不同区间距离不可直接比较。"),
  ).toBeVisible();
  await expect(page.locator("thead th")).toHaveText([
    "区间 ↕",
    "区间顺位 ↕",
    "大学 ↕",
    "选手 ↕",
    "成绩 ↓",
  ]);
  await expect(page.locator("table")).not.toContainText("官方 ↗");
  await expect(
    page.getByRole("complementary", { name: "查询上下文" }),
  ).toContainText("全日本大学駅伝 · 2024 · 第 56 届");
  await expect(
    page.getByRole("complementary", { name: "查询上下文" }),
  ).toContainText("2024-11-03");
  await page.getByRole("link", { name: "大学视图", exact: true }).click();
  await expect(page).toHaveURL(/view=university/);
  await expect(page).toHaveURL(/sort=default/);
  await expect(page).toHaveURL(/page=1/);
  const rows = page.locator("tr[data-result-id]");
  await expect(rows.first()).toContainText("國學院大");
  await expect(rows.first()).toContainText("综合 1");
  await expect(rows.nth(7)).toContainText("8区");
  await expect(rows.nth(8)).toContainText("駒澤大");
  await page.reload();
  await expect(
    page.getByRole("link", { name: "大学视图", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "下一页", exact: true }).click();
  await page.getByRole("link", { name: "区间视图", exact: true }).click();
  await expect(page).toHaveURL(/page=1/);
  await expect(rows.first()).toContainText("平島 龍斗");
  await expect(rows.first().locator("td").nth(1)).toHaveText("1");
  await page.goBack();
  await expect(page).toHaveURL(/view=university/);
  await expect(page).toHaveURL(/page=2/);
  await page.goForward();
  await expect(page).toHaveURL(/view=section/);
  const source = page.getByRole("complementary", { name: "数据范围与来源" });
  await expect(source.getByRole("link")).toHaveCount(2);
  await expect(source).toContainText("采集时间");
  await expect(source).toContainText("两支公开");
  await page.goto("/results?year=2023");
  await expect(source.getByRole("link")).toHaveCount(0);
  await expect(source).toContainText("当前查询无成绩");
});

test("manual ordering and filtering reset page while retaining view and entity scope", async ({
  page,
}) => {
  await page.goto("/universities/kokugakuin?view=university&page=9");
  await page
    .getByRole("columnheader", { name: /成绩/ })
    .getByRole("link")
    .click();
  await expect(page).toHaveURL(/page=1/);
  await expect(page).toHaveURL(/view=university/);
  await expect(page.getByRole("status")).toHaveText("共 8 条成绩");
  await page
    .getByRole("combobox", { name: "区间", exact: true })
    .selectOption("6");
  await page.getByRole("button", { name: "应用筛选" }).click();
  await expect(page).toHaveURL(/view=university/);
  expect(new URL(page.url()).searchParams.get("page")).toBeNull();
  await expect(page.getByRole("status")).toHaveText("共 1 条成绩");
  await expect(
    page.getByRole("complementary", { name: "查询上下文" }),
  ).toContainText("区间：6区");
  await expect(
    page.getByRole("complementary", { name: "查询上下文" }),
  ).toContainText("大学：國學院大");
});
