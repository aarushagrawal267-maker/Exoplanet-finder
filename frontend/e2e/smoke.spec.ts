/**
 * Smoke tests for the app shell: every route renders its page header, navigation works, the
 * command palette opens with Ctrl+K, and pages render without console errors. The backend is
 * not required (API calls may fail; the UI must degrade gracefully).
 */
import { expect, test, type ConsoleMessage } from "@playwright/test";

const ROUTES: Array<[string, RegExp]> = [
  ["/", /Find transit-like signals/],
  ["/signals", /Signal Explorer/],
  ["/transit", /Transit Analysis/],
  ["/detect", /Planet Detection/],
  ["/candidates", /Candidate Explorer/],
  ["/predictions", /Prediction History/],
  ["/datasets", /Dataset Explorer/],
  ["/training", /Model Training/],
  ["/evaluation", /Model Evaluation/],
  ["/experiments", /Experiments/],
  ["/docs", /Research Docs/],
  ["/settings", /Settings/],
  ["/targets/10666592", /KIC 10666592/],
  ["/design", /Design System/],
];

/** Errors caused only by the backend being offline are expected in this smoke test. */
function isUnexpected(msg: ConsoleMessage): boolean {
  if (msg.type() !== "error") return false;
  const text = msg.text();
  return !/Failed to load resource|\/api\/|ECONNREFUSED|502|504|500 \(Internal Server Error\)/i.test(text);
}

for (const [path, heading] of ROUTES) {
  test(`renders ${path}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => isUnexpected(m) && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(heading);
    expect(errors).toEqual([]);
  });
}

test("sidebar navigation and command palette", async ({ page, isMobile }) => {
  await page.goto("/");
  if (isMobile) {
    await page.getByRole("button", { name: "Open navigation" }).click();
  }
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Model Training" }).click();
  await expect(page).toHaveURL(/\/training$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Model Training");

  await page.keyboard.press("Control+k");
  const input = page.getByRole("combobox", { name: "Search pages and targets" });
  await expect(input).toBeVisible();
  await input.fill("evaluation");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/evaluation$/);
});

test("design page shows demo-data labelling and renders charts", async ({ page }) => {
  await page.goto("/design");
  await expect(page.getByText("Demo data — for UI preview only").first()).toBeVisible();
  await expect(page.locator(".js-plotly-plot").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("research-lead-note").first()).toContainText("Research lead — not a confirmed discovery");
});

test("layout regressions: laptop sidebar fit, tab order, tablist overflow, no sideways scroll", async ({ page, isMobile }) => {
  if (isMobile) {
    // Phones: no horizontal page scroll on the densest page.
    await page.goto("/design");
    await expect(page.locator(".js-plotly-plot").first()).toBeVisible({ timeout: 30_000 });
    const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(widths[0]).toBeLessThanOrEqual(widths[1] as number);
    return;
  }
  // 1024×768 laptop: every sidebar destination fits above the status footer without scrolling.
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  const fits = await nav.evaluate((el) => el.scrollHeight <= el.clientHeight);
  expect(fits).toBe(true);
  await expect(nav.getByRole("link", { name: "Settings" })).toBeInViewport({ ratio: 1 });

  // First load keeps the natural tab order: skip link first, then the sidebar.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();

  // Tabs: the tablist must not be vertically scrollable (stray scrollbar on Windows).
  await page.goto("/design");
  const tablist = page.getByRole("tablist").first();
  const overflow = await tablist.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(overflow).toBe(0);
});
