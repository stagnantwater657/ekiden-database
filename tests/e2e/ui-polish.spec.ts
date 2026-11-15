import { test, expect } from "@playwright/test";

test("scoreboard header sorting survives refresh and section navigation, with signed movement and nulls last", async ({ page }) => {
  await page.goto("/editions/all-japan-2024?section=2");
  const table = page.getByRole("region", { name:"区间成绩表", exact:true });
  const rank = table.getByRole("columnheader", { name:/区间顺位/ });
  const cumulative = table.getByRole("columnheader", { name:/累计用时/ });
  const movement = table.getByRole("columnheader", { name:/顺位变化/ });
  const rowIds = () => table.locator("tbody tr").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-result-id")));
  await expect(rank).toHaveAttribute("aria-sort", "ascending");
  await expect(table.getByRole("columnheader", {name:"综合顺位",exact:true})).toBeVisible();
  await expect(table.getByRole("columnheader", {name:"累计综合顺位",exact:true})).toHaveCount(0);
  await rank.getByRole("link").click();
  await expect(rank).toHaveAttribute("aria-sort", "descending");
  const ranks = (await table.locator("tbody tr td:first-child").allTextContents()).map(Number);
  expect(ranks).toEqual([...ranks].sort((a,b) => b-a));
  await movement.getByRole("link").click();
  await expect(movement).toHaveAttribute("aria-sort", "ascending");
  const signed = await table.locator("tbody tr td:nth-child(6) span").evaluateAll((spans) => spans.map((s) => {
    const label = s.getAttribute("aria-label")!;
    if (label === "无可比较顺位") return null;
    if (label === "顺位不变") return 0;
    return Number(label.match(/\d+/)![0]) * (label.startsWith("下降") ? -1 : 1);
  }));
  const values = signed.filter((n) => n !== null);
  expect(values.some((n) => n < 0)).toBe(true);
  expect(values.some((n) => n > 0)).toBe(true);
  expect(signed).toEqual([...[...values].sort((a,b) => a-b), ...Array(signed.length-values.length).fill(null)]);
  expect(signed.slice(-2)).toEqual([null,null]);
  const ascending = await rowIds();
  await movement.getByRole("link").focus();
  await page.keyboard.press("Enter");
  await expect(movement).toHaveAttribute("aria-sort", "descending");
  const descending = await rowIds();
  expect(descending).not.toEqual(ascending);
  await expect(table.locator("tbody tr").last()).toContainText("参考成绩");
  await page.reload();
  expect(await rowIds()).toEqual(descending);
  await page.goBack();
  await expect(movement).toHaveAttribute("aria-sort", "ascending");
  expect(await rowIds()).toEqual(ascending);
  await page.goForward();
  await expect(movement).toHaveAttribute("aria-sort", "descending");
  await page.getByRole("navigation",{name:"区间导航"}).getByRole("link",{name:"3区",exact:true}).click();
  await expect(page).toHaveURL(/section=3&sort=movement&direction=desc/);
  await expect(movement).toHaveAttribute("aria-sort", "descending");
  await cumulative.getByRole("link").click();
  await expect(cumulative).toHaveAttribute("aria-sort", "ascending");
  const times = (await table.locator("tbody tr td:nth-child(7)").allTextContents()).map((t) => t.split(":").reduce((total,n) => total*60+Number(n),0));
  expect(times).toEqual([...times].sort((a,b) => a-b));
  await cumulative.getByRole("link").click();
  await expect(cumulative).toHaveAttribute("aria-sort", "descending");
  await page.getByRole("navigation",{name:"区间导航"}).getByRole("link",{name:"最终综合",exact:true}).click();
  await expect(page.getByRole("region",{name:"正式综合成绩表",exact:true})).toBeVisible();
  await page.getByRole("navigation",{name:"区间导航"}).getByRole("link",{name:"3区",exact:true}).click();
  await expect(cumulative).toHaveAttribute("aria-sort", "descending");
});

test("overview keeps explicit co-awards, non-winning record badges and the pre-race record", async ({page}) => {
  await page.goto("/editions/all-japan-2026?section=2");
  const overview = page.getByRole("region",{name:"本区间成绩概览"});
  const awards = overview.locator("div").filter({has:page.getByRole("heading",{name:"区间赏",exact:true})});
  await expect(awards.locator(".result-badge--award")).toHaveCount(2);
  for (const name of ["増子 陽太", "楠岡 由浩"]) await expect(awards.getByRole("link",{name,exact:true})).toBeVisible();
  await expect(awards.locator('a[href="/universities/waseda"]')).toHaveText("早稲田大");
  await expect(awards.locator('a[href="/universities/teikyo"]')).toHaveText("帝京大");
  await expect(awards).toContainText("30:51");
  const record = overview.locator("div").filter({has:page.getByRole("heading",{name:"区间纪录",exact:true})});
  await expect(record).toContainText("31:01");
  await expect(record).toContainText("共同纪录保持者");
  await expect(record).not.toContainText("30:51");
  await expect(page.locator('tr[data-result-id="aj26-result-01-2"] .result-badge--record')).toHaveText("区間新");
  await page.goto("/editions/izumo-2023?section=5");
  // Revised first place did not receive a retroactive official award.
  await expect(overview).toContainText("区间赏尚待核验");
  await expect(overview.locator(".result-badge--award")).toHaveCount(0);
});

for (const width of [1280, 740, 390]) {
  test(`homepage gutters and number-first statistics, archive details at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900});
    await page.goto("/");
    const layout = await page.locator(".home-hero").evaluate((hero) => {
      const copy = hero.querySelector(".home-hero-copy")!;
      const panel = hero.querySelector(".home-stat-panel")!;
      const leftInset = copy.querySelector("p")!.getBoundingClientRect().left-copy.getBoundingClientRect().left;
      const rightInset = panel.querySelector("p")!.getBoundingClientRect().left-panel.getBoundingClientRect().left;
      return {leftInset,rightInset,numberFirst:[...panel.querySelectorAll("dl > div")].map((item) => item.querySelector("dd")!.getBoundingClientRect().bottom <= item.querySelector("dt")!.getBoundingClientRect().top)};
    });
    expect(layout.leftInset).toBe(layout.rightInset);
    expect(layout.numberFirst).toEqual([true,true,true,true]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto("/editions/all-japan-2024?section=2");
    await expect(page.getByRole("region",{name:"本区间成绩概览"})).toBeVisible();
    await page.getByRole("columnheader",{name:/顺位变化/}).getByRole("link").click();
    await expect(page.getByRole("columnheader",{name:/顺位变化/})).toHaveAttribute("aria-sort","ascending");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto("/universities/aoyama-gakuin");
    await expect(page.getByRole("columnheader",{name:"综合顺位",exact:true})).toBeVisible();
    await expect(page.getByRole("columnheader",{name:"总成绩",exact:true})).toBeVisible();
  });
}
