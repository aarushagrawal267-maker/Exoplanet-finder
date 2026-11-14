/**
 * Machine-learning operations pages against the REAL backend (read-only: nothing is created or
 * deleted). Run with the backend up and E2E_BASE_URL pointing at a Vite server proxying to it.
 * Data-dependent checks skip themselves when the database has nothing to show yet.
 */
import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

const PAGES: Array<[string, string]> = [
  ["/datasets", "Dataset Explorer"],
  ["/training", "Model Training"],
  ["/evaluation", "Model Evaluation"],
  ["/experiments", "Experiments"],
];

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  const unexpected = (m: ConsoleMessage) => m.type() === "error" && !/Failed to load resource|\/api\/|ECONNREFUSED|50[0-4]/i.test(m.text());
  page.on("console", (m) => unexpected(m) && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function noHorizontalScroll(page: Page) {
  const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll, "page must not scroll horizontally").toBeLessThanOrEqual(inner);
}

for (const [path, title] of PAGES) {
  test(`${path} renders from the real API without errors or page-level horizontal scroll`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await expect(page.locator("[aria-busy=true]")).toHaveCount(0, { timeout: 20_000 }).catch(() => undefined);
    await noHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
}

test("dataset detail: splits, examples with a view preview, gallery and provenance", async ({ page, request }) => {
  const datasets = (await (await request.get("/api/datasets")).json()) as Array<{ id: number; status: string; n_examples: number }>;
  const ready = datasets.find((d) => d.status === "ready" && d.n_examples > 0);
  test.skip(!ready, "no ready dataset in the database yet");
  await page.goto(`/datasets?id=${ready?.id}`);
  await expect(page.getByRole("table", { name: "Examples per split" })).toContainText("Validation");
  await expect(page.getByText("Exclusions by reason")).toBeVisible();
  const examples = page.getByRole("table", { name: "Dataset examples" });
  await expect(examples.locator("tbody tr").first()).toBeVisible();
  await examples.locator("tbody tr").first().click();
  await expect(page.getByRole("figure", { name: /Global view .* and local view/ })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("tab", { name: /Gallery/ }).click();
  await expect(page.getByRole("region", { name: "Planet-like examples" }).getByRole("img").first()).toBeVisible();
  await page.getByRole("tab", { name: /Provenance/ }).click();
  await expect(page.getByText("Content hash (SHA-256)")).toBeVisible();
  await noHorizontalScroll(page);
});

test("training: the four model cards come from the API and the form validates", async ({ page, request }) => {
  const datasets = (await (await request.get("/api/datasets")).json()) as Array<{ status: string }>;
  test.skip(!datasets.some((d) => d.status === "ready"), "no ready dataset: the page shows 'Build a dataset first'");
  await page.goto("/training");
  const cards = page.getByRole("radiogroup", { name: "Model type" }).getByRole("radio");
  await expect(cards).toHaveCount(4);
  await page.getByRole("radio", { name: /Logistic regression/ }).click();
  const grid = page.getByRole("textbox", { name: /C grid/ });
  await grid.fill("0.1, -2");
  await page.getByRole("button", { name: "Start training" }).click();
  await expect(page.getByText("One or more positive numbers, separated by commas.")).toBeVisible();
  await expect(page.getByRole("table", { name: "Trained models" }).or(page.getByText("No trained models yet"))).toBeVisible();
});

test("evaluation: an existing evaluation shows CIs, curves, calibration and error analysis", async ({ page, request }) => {
  const evals = (await (await request.get("/api/evaluation")).json()) as Array<{ id: number }>;
  test.skip(!evals.length, "no evaluation in the database yet");
  await page.goto(`/evaluation?eval=${evals[0]?.id}`);
  await expect(page.getByText(/95% CI/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("figure", { name: /ROC curves/ })).toBeVisible();
  await expect(page.getByRole("figure", { name: /Reliability diagram/ })).toBeVisible();
  await expect(page.getByRole("figure", { name: /Confusion matrix/ })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Examples by outcome" })).toBeVisible();
  await noHorizontalScroll(page);
});

test("experiments: open a run and download its Markdown report under the server's filename", async ({ page, request }) => {
  const exps = (await (await request.get("/api/experiments")).json()) as Array<{ id: number }>;
  test.skip(!exps.length, "no experiment in the database yet");
  const id = exps[0]?.id as number;
  await page.goto(`/experiments?id=${id}`);
  const details = page.getByRole("region", { name: "Run details" });
  await expect(details.getByText("Configuration", { exact: true })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), details.getByRole("button", { name: "Markdown" }).click()]);
  expect(download.suggestedFilename()).toBe(`exofinder-experiment-${id}-report.md`);
});

test("experiments: compare two runs (config diff, curves, comparison report)", async ({ page, request }) => {
  const exps = (await (await request.get("/api/experiments")).json()) as Array<{ id: number }>;
  test.skip(exps.length < 2, "fewer than two experiments");
  await page.goto(`/experiments?compare=${exps[0]?.id},${exps[1]?.id}`);
  const compare = page.getByRole("region", { name: "Comparison" });
  await expect(compare.getByRole("table", { name: "Experiment summary" })).toBeVisible();
  await expect(compare.getByRole("group", { name: "Download the comparison report" })).toBeVisible();
  await noHorizontalScroll(page);
});

test("job tray opens from the top bar and reports the feed state", async ({ page }) => {
  await page.goto("/datasets");
  await page.getByRole("button", { name: /Background jobs/ }).click();
  const panel = page.getByRole("dialog", { name: "Background jobs" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/Live updates|Connecting to job feed|updating by polling/)).toBeVisible();
});
