/**
 * Machine-learning operations pages with API-INTERCEPTED TEST FIXTURES (synthetic payloads from
 * src/pages/_ops/testFixtures.ts, never real results) for states that are slow or destructive to
 * reach on a real database: empty states, a dataset build, a finished evaluation, a forced dataset
 * delete and a failing job in the tray. Every `/api` request is answered by the routes below;
 * anything unrouted gets a 404 so no real data leaks into these checks.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  fxDataset,
  fxDatasetDetail,
  fxEvaluation,
  fxEvaluationDetail,
  fxEvaluationExamples,
  fxFeatureImportance,
  fxExamples,
  fxJob,
  fxModel,
  fxModelCards,
  fxTiers,
} from "../src/pages/_ops/testFixtures";

type Handler = (route: Route, url: URL) => unknown | Promise<unknown>;

/** Route `/api/**` through `handlers` (first match on "METHOD /path" wins). */
async function fixtureApi(page: Page, handlers: Array<[RegExp, Handler | unknown]>) {
  // Only the API (not Vite's /src/api/*.ts modules).
  await page.route((u) => u.pathname.startsWith("/api/"), async (route) => {
    const url = new URL(route.request().url());
    const key = `${route.request().method()} ${url.pathname.replace(/^\/api/, "")}${url.search}`;
    // The SSE feed is not simulated: the tray falls back to polling.
    if (url.pathname.endsWith("/events") || url.pathname.endsWith("/jobs/stream")) return route.fulfill({ status: 503, body: "" });
    for (const [re, h] of handlers) {
      if (!re.test(key)) continue;
      const out = typeof h === "function" ? await (h as Handler)(route, url) : h;
      if (out === undefined) return; // handler fulfilled the route itself
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: `fixture: no route for ${key}` }) });
  });
}

const EMPTY: Array<[RegExp, unknown]> = [
  [/^GET \/health/, { status: "ok", version: "fixture", pipeline_version: "1.0" }],
  [/^GET \/datasets\/tiers/, fxTiers],
  [/^GET \/datasets(\?|$)/, []],
  [/^GET \/models(\?|$)/, []],
  [/^GET \/evaluation(\?|$)/, []],
  [/^GET \/experiments(\?|$)/, []],
  [/^GET \/jobs(\?|$)/, []],
  [/^GET \/training\/model-types/, fxModelCards],
];

test.describe("empty states (test fixtures)", () => {
  test("each page explains the next step", async ({ page }) => {
    await fixtureApi(page, EMPTY);
    await page.goto("/datasets");
    await expect(page.getByText("No datasets yet")).toBeVisible();
    await page.goto("/training");
    await expect(page.getByText("Build a dataset first")).toBeVisible();
    await expect(page.getByRole("link", { name: /Open Dataset Explorer/ })).toBeVisible();
    await page.goto("/evaluation");
    await expect(page.getByText("Train a model first")).toBeVisible();
    await page.goto("/experiments");
    await expect(page.getByText("No experiments yet")).toBeVisible();
  });
});

test("dataset build: form → job progress → the new dataset (test fixtures)", async ({ page }) => {
  let built = false;
  await fixtureApi(page, [
    [/^POST \/datasets$/, () => ((built = true), fxJob())],
    [/^GET \/jobs\/job-1/, () => fxJob({ status: "succeeded", progress: 1, finished_at: "2026-11-14T20:01:00", result: { dataset_id: 7 } })],
    [/^GET \/datasets\/7\/examples/, fxExamples],
    [/^GET \/datasets\/7(\?|$)/, fxDatasetDetail],
    [/^GET \/datasets(\?|$)/, () => (built ? [fxDataset] : [])],
    ...EMPTY,
  ]);
  await page.goto("/datasets");
  await page.getByRole("radio", { name: /Pilot/ }).click();
  await page.getByRole("textbox", { name: /Name/ }).fill("Fixture Pilot");
  await page.getByRole("button", { name: "Build dataset" }).click();
  await expect(page).toHaveURL(/\/datasets\?id=7/);
  await expect(page.getByRole("table", { name: "Examples per split" })).toBeVisible();
});

test("forced dataset delete states what else is removed (test fixtures)", async ({ page }) => {
  await fixtureApi(page, [
    [/^GET \/datasets\/7\/examples/, fxExamples],
    [/^GET \/datasets\/7(\?|$)/, { ...fxDatasetDetail, n_models: 2 }],
    [
      /^DELETE \/datasets\/7\?force=true/,
      { deleted: true, dataset_id: 7, examples: 105, experiments: 2, models: 2, evaluations: 3, predictions: 4 },
    ],
    [
      /^DELETE \/datasets\/7$/,
      (route: Route) =>
        route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ detail: "2 model(s) and 2 experiment(s) depend on this dataset", code: "dataset_in_use", hint: "Delete those experiments first." }),
        }),
    ],
    ...EMPTY,
  ]);
  await page.goto("/datasets?id=7");
  await page.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Delete dataset" }).click();
  await expect(dialog.getByText("every prediction made with those models.")).toBeVisible();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Delete dataset and dependants" }).click();
  await expect(page.getByText("Dataset #7 deleted")).toBeVisible();
});

test("finished evaluation: CIs, curves, calibration, errors and importance (test fixtures)", async ({ page }) => {
  await fixtureApi(page, [
    [/^GET \/models(\?|$)/, [fxModel]],
    [/^GET \/evaluation\/41\/examples/, fxEvaluationExamples],
    [/^GET \/evaluation\/41\/feature-importance/, fxFeatureImportance],
    [/^GET \/evaluation\/41(\?|$)/, fxEvaluationDetail],
    [/^GET \/evaluation(\?|$)/, [fxEvaluation]],
    ...EMPTY,
  ]);
  await page.goto("/evaluation?eval=41");
  await expect(page.getByText("Validation metrics are optimistic", { exact: true })).toBeVisible();
  await expect(page.getByText("95% CI 0.800–0.980")).toBeVisible();
  await expect(page.getByRole("figure", { name: /ROC curves/ })).toBeVisible();
  await expect(page.getByRole("figure", { name: /Confusion matrix/ })).toBeVisible();
  await expect(page.getByText("TCE-000000012-01")).toBeVisible();
  await expect(page.getByText("Local view (all bins)")).toBeVisible();
  const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll).toBeLessThanOrEqual(inner);
});

test("job tray: a failing job raises a notification with its error (test fixtures)", async ({ page }) => {
  // The job runs until the tray has shown it as active; then it fails. (State is flipped by the
  // test rather than by a request counter, so a dev-server page reload cannot skip the transition.)
  let failed = false;
  const running = fxJob({ id: "job-x", kind: "train", title: "Train fixture CNN" });
  await fixtureApi(page, [
    [/^GET \/jobs\?status=queued%2Crunning/, () => (failed ? [] : [running])],
    [/^GET \/jobs\/job-x/, () => (failed ? fxJob({ ...running, status: "failed", error: "TrainingDiverged: non-finite loss; try a lower learning rate" }) : running)],
    ...EMPTY,
  ]);
  await page.goto("/experiments");
  await expect(page.getByRole("button", { name: "Background jobs: 1 active" })).toBeVisible();
  failed = true;
  const toast = page.getByRole("list", { name: "Job notifications" });
  await expect(toast.getByText("TrainingDiverged: non-finite loss; try a lower learning rate")).toBeVisible({ timeout: 15_000 });
  await expect(toast.getByRole("link", { name: /Open/ })).toHaveAttribute("href", "/training?job=job-x");
});
