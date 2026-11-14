import { test, expect, type Page } from "@playwright/test";
import { database } from "../../data/index";

async function noPageOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

async function noGenericProfileForm(page: Page) {
  await expect(page.locator("main form")).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "应用筛选" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "区间视图", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "大学视图", exact: true }),
  ).toHaveCount(0);
}

test("athlete archive retains verified cross-year identities and separates missing biography/PB", async ({
  page,
}) => {
  await page.goto("/editions/all-japan-2025?section=3");
  await page.getByRole("link", { name: "野中 恒亨", exact: true }).click();
  await expect(page).toHaveURL(/athletes\/athlete-aj24-01-5/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("野中 恒亨");
  await noGenericProfileForm(page);
  const rows = database.results.filter(
    (row) => row.athleteId === "athlete-aj24-01-5",
  );
  await expect(page.locator("tr[data-result-id]")).toHaveCount(rows.length);
  const originalRows = rows.filter(
    (row) => row.id.startsWith("aj24-") || row.id.startsWith("aj25-"),
  );
  expect(originalRows).toHaveLength(2);
  for (const row of originalRows)
    await expect(page.locator(`tr[data-result-id="${row.id}"]`)).toBeVisible();
  const groups = page.locator('section[aria-labelledby^="history-"]');
  await expect(groups).toHaveCount(3);
  await expect(groups.nth(0)).toHaveAttribute(
    "aria-labelledby",
    "history-hakone",
  );
  await expect(groups.nth(1)).toHaveAttribute(
    "aria-labelledby",
    "history-all-japan",
  );
  await expect(groups.nth(2)).toHaveAttribute(
    "aria-labelledby",
    "history-izumo",
  );
  for (const row of await page.locator("tr[data-result-id]").all())
    await expect(row).not.toContainText("野中 恒亨");
  const pb = page.getByRole("region", { name: /个人最佳/ });
  for (const event of ["5000m", "10000m", "半程马拉松"])
    await expect(pb).toContainText(event);
  await expect(pb).toContainText("尚未收录");
  await expect(pb).not.toContainText(/\d+:\d{2}/);
  await page
    .locator(
      'tr[data-result-id="aj25-result-01-3"] a[href="/editions/all-japan-2025?section=3"]',
    )
    .click();
  await expect(page).toHaveURL(/editions\/all-japan-2025\?section=3/);
  await expect(
    page
      .getByRole("navigation", { name: "区间导航" })
      .getByRole("link", { name: "3区", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("all three race archives and all eleven editions expose actual routes and complete section one", async ({
  page,
}) => {
  expect(database.races).toHaveLength(3);
  expect(database.editions).toHaveLength(11);
  for (const race of database.races) {
    const response = await page.goto(`/races/${race.id}`);
    expect(response?.status()).toBe(200);
    await noGenericProfileForm(page);
    await expect(
      page.getByRole("heading", { name: "区间与路线", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "已收录届次的优胜大学", exact: true }),
    ).toBeVisible();
    const latest = database.editions
      .filter((edition) => edition.raceId === race.id)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    await expect(page.locator("main")).toContainText(String(latest.number));
    await expect(page.locator("main")).toContainText("待核实");
    for (const edition of database.editions.filter(
      (item) => item.raceId === race.id,
    )) {
      await expect(
        page.locator(`a[href="/editions/${edition.id}"]`).first(),
      ).toBeVisible();
    }
  }
  for (const edition of database.editions) {
    const response = await page.goto(`/editions/${edition.id}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      String(edition.number),
    );
    await noGenericProfileForm(page);
    const nav = page.getByRole("navigation", { name: "区间导航" });
    const sections = database.sections.filter(
      (section) => section.editionId === edition.id,
    );
    await expect(nav.getByRole("link")).toHaveCount(sections.length + 1);
    await expect(
      nav.getByRole("link", { name: "1区", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    const firstSection = sections.find((section) => section.number === 1)!;
    await expect(page.locator("tr[data-result-id]")).toHaveCount(
      database.results.filter((row) => row.sectionId === firstSection.id)
        .length,
    );
  }
});

test("section switch survives refresh, sharing and back/forward with separate final standings", async ({
  page,
}) => {
  await page.goto("/editions/all-japan-2024");
  const nav = page.getByRole("navigation", { name: "区间导航" });
  await nav.getByRole("link", { name: "6区", exact: true }).click();
  await expect(page).toHaveURL(/section=6/);
  await expect(
    page.locator('tr[data-result-id="aj24-kokugakuin-s6"]'),
  ).toContainText("山本 歩夢");
  await expect(
    page.locator('tr[data-result-id="aj24-kokugakuin-s1"]'),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    nav.getByRole("link", { name: "6区", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const shared = page.url();
  await nav.getByRole("link", { name: "最终综合", exact: true }).click();
  await expect(page).toHaveURL(/section=final/);
  await expect(page.locator("main")).toContainText("日本学連選抜");
  await expect(page.locator("main")).toContainText("参考");
  await expect(page.locator("main")).not.toContainText("综合 26");
  await page.goBack();
  await expect(
    nav.getByRole("link", { name: "6区", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(
    nav.getByRole("link", { name: "最终综合", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.goto("/");
  await page.goto(shared);
  await expect(
    page.locator('tr[data-result-id="aj24-kokugakuin-s6"]'),
  ).toBeVisible();
});

test("official section award and record badges use red/white and gold/black, including both on one result", async ({
  page,
}) => {
  for (const [section, rowId] of [
    [4, "aj24-aoyama-gakuin-s4"],
    [6, "aj24-kokugakuin-s6"],
  ] as const) {
    await page.goto(`/editions/all-japan-2024?section=${section}`);
    const row = page.locator(`tr[data-result-id="${rowId}"]`);
    const award = row.locator(".result-badge--award");
    const record = row.locator(".result-badge--record");
    await expect(award).toHaveText("区間賞");
    await expect(record).toHaveText("区間新");
    await expect(award).toHaveCSS("background-color", "rgb(180, 35, 53)");
    await expect(award).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(record).toHaveCSS("background-color", "rgb(232, 185, 69)");
    await expect(record).toHaveCSS("color", "rgb(0, 0, 0)");
  }
  await page.goto("/editions/izumo-2023?section=1");
  const disqualified = page
    .locator("tr[data-result-id]")
    .filter({ hasText: "石丸 惇那" });
  await expect(disqualified).toContainText("—");
  await expect(disqualified.locator(".result-badge")).toHaveCount(0);
});

test("mobile archives keep cross-race athlete links, reference identities and advanced team navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    "/races/hakone",
    "/editions/hakone-2026?section=10",
    "/athletes/athlete-aj24-03-4",
    "/universities/aoyama-gakuin",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await noPageOverflow(page);
  }
  await page.goto("/editions/izumo-2025?section=6");
  await page.getByRole("link", { name: "黒田 朝日", exact: true }).click();
  await expect(page).toHaveURL(/athletes\/athlete-aj24-03-4/);
  for (const race of database.races)
    await expect(page.locator(`#history-${race.id}`)).toContainText(race.name);
  await page.locator('a[href="/editions/hakone-2026"]').first().click();
  await expect(page).toHaveURL(/editions\/hakone-2026/);
  await expect(page.locator("tr[data-result-id]")).toHaveCount(21);

  await page.goto("/editions/all-japan-2024?section=2");
  await page.getByRole("link", { name: "片川 祐大", exact: true }).click();
  await expect(page).toHaveURL(/athletes\/athlete-hk25-21-1/);
  await expect(page.locator("tr[data-result-id]")).toHaveCount(2);
  await expect(
    page.locator('a[href="/editions/all-japan-2024"]'),
  ).toBeVisible();
  await expect(page.locator('a[href="/editions/hakone-2025"]')).toBeVisible();
  await noGenericProfileForm(page);
  await noPageOverflow(page);
  await page.locator('a[href="/teams/team-japan-selection"]').first().click();
  await expect(page).toHaveURL(/teams\/team-japan-selection/);
  await expect(page.getByRole("button", { name: "应用筛选" })).toBeVisible();
  const selectionEntries = new Set(
    database.entries
      .filter((entry) => entry.teamId === "team-japan-selection")
      .map((entry) => entry.id),
  );
  await expect(page.getByRole("status")).toHaveText(
    `共 ${database.results.filter((row) => selectionEntries.has(row.entryId)).length} 条成绩`,
  );
});

test("official cumulative standing, movement and leader gap are distinct from individual section rank", async ({
  page,
}) => {
  await page.goto("/editions/all-japan-2024?section=2");
  await expect(page.locator("main")).toContainText("官方累计成绩");
  const kokugakuin = page.locator('tr[data-result-id="aj24-kokugakuin-s2"]');
  await expect(kokugakuin.locator("td").nth(4)).toHaveText("6");
  await expect(kokugakuin.locator("td").nth(6)).toHaveText("1:00:19");
  await expect(kokugakuin.locator("td").nth(7)).toHaveText("+00:54");
  await expect(kokugakuin.locator(".rank-movement--down")).toContainText("4");
  await expect(kokugakuin.locator(".rank-movement--down")).toHaveCSS(
    "color",
    "rgb(180, 35, 53)",
  );
  const aoyama = page.locator('tr[data-result-id="aj24-aoyama-gakuin-s2"]');
  await expect(aoyama.locator("td").nth(4)).toHaveText("1");
  await expect(aoyama.locator(".rank-movement--up")).toContainText("3");
  await expect(aoyama.locator(".rank-movement--up")).toHaveCSS(
    "color",
    "rgb(24, 118, 75)",
  );
  await page
    .getByRole("navigation", { name: "区间导航" })
    .getByRole("link", { name: "6区", exact: true })
    .click();
  const sixth = page.locator('tr[data-result-id="aj24-kokugakuin-s6"]');
  await expect(sixth.locator("td").nth(4)).toHaveText("2");
  await expect(sixth.locator("td").nth(5)).toHaveText("—");
  await expect(sixth.locator("td").nth(6)).toHaveText("3:20:35");
  await expect(sixth.locator("td").nth(7)).toHaveText("+00:04");
  await page
    .getByRole("navigation", { name: "区间导航" })
    .getByRole("link", { name: "1区", exact: true })
    .click();
  for (const row of await page.locator("tr[data-result-id]").all())
    await expect(row.locator("td").nth(5)).toHaveText("—");
});

test("reference, DNF and Hakone timing do not acquire invented official cumulative ranks", async ({
  page,
}) => {
  await page.goto("/editions/all-japan-2024?section=8");
  for (const id of ["aj24-japan-selection-s8", "aj24-tokai-selection-s8"]) {
    const row = page.locator(`tr[data-result-id="${id}"]`);
    await expect(row).toContainText("参考");
    for (const column of [4, 5, 7])
      await expect(row.locator("td").nth(column)).toHaveText("—");
  }
  await page
    .getByRole("navigation", { name: "区间导航" })
    .getByRole("link", { name: "最终综合", exact: true })
    .click();
  const referenceRows = page
    .locator("tr[data-entry-id]")
    .filter({ hasText: /日本学連選抜|東海学連選抜/ });
  await expect(referenceRows).toHaveCount(2);
  for (const row of await referenceRows.all())
    await expect(row).toContainText("参考");
  await expect(
    page.locator('tr[data-entry-id="aj24-japan-selection"]'),
  ).toContainText("5:21:31");
  await expect(
    page.locator('tr[data-entry-id="aj24-tokai-selection"]'),
  ).toContainText("5:32:20");
  await page.goto("/editions/hakone-2026?section=10");
  await expect(page.locator("main")).toContainText("繰り上げスタート");
  for (const row of await page.locator("tr[data-result-id]").all()) {
    for (const column of [4, 5, 6, 7])
      await expect(row.locator("td").nth(column)).toHaveText("—");
  }
  await page.goto("/editions/all-japan-2023?section=8");
  await expect(page.locator("main")).toContainText("累计成绩尚待核验");
  for (const row of await page.locator("tr[data-result-id]").all())
    await expect(row.locator("td").nth(4)).toHaveText("—");
  await page.goto("/editions/all-japan-2025?section=2");
  await expect(page.locator("main")).toContainText("按区间用时计算");
  await expect(page.locator("main")).toContainText("不是官方通過順位");
});

test("advanced season filters and reference-team scope remain URL based", async ({
  page,
}) => {
  const athleteId = "athlete-aj24-01-5";
  await page.goto(`/results?athlete=${athleteId}`);
  const allRows = database.results.filter((row) => row.athleteId === athleteId);
  await expect(page.getByRole("status")).toHaveText(
    `共 ${allRows.length} 条成绩`,
  );
  await page
    .getByRole("combobox", { name: "赛季", exact: true })
    .selectOption("2025");
  await page.getByRole("button", { name: "应用筛选" }).click();
  await expect(page).toHaveURL(/season=2025/);
  await expect(page).toHaveURL(new RegExp(`athlete=${athleteId}`));
  const seasonEditionIds = new Set(
    database.editions
      .filter((edition) => edition.seasonYear === 2025)
      .map((edition) => edition.id),
  );
  const seasonEntryIds = new Set(
    database.entries
      .filter((entry) => seasonEditionIds.has(entry.editionId))
      .map((entry) => entry.id),
  );
  const count = allRows.filter((row) => seasonEntryIds.has(row.entryId)).length;
  await page.reload();
  await expect(page.getByRole("status")).toHaveText(`共 ${count} 条成绩`);
  await page.goBack();
  await expect(page.getByRole("status")).toHaveText(
    `共 ${allRows.length} 条成绩`,
  );
  await page.goForward();
  await expect(page.getByRole("status")).toHaveText(`共 ${count} 条成绩`);
  await page.goto(
    "/results?team=team-japan-selection&season=2025&view=university",
  );
  await page
    .getByRole("link", { name: "日本学連選抜", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/teams\/team-japan-selection/);
  await expect(page.getByRole("button", { name: "应用筛选" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await noPageOverflow(page);
});
