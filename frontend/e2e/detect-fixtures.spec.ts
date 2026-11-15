/**
 * Planet Detection with the API intercepted by TEST FIXTURES (src/test/fixtures.ts — shapes typed
 * against the generated OpenAPI schema). These cover outcomes the live database may not be in:
 * a successful score with several models (one a fixture model, one that saw the star in training)
 * and the "no model trained" state. Nothing here reaches the real backend.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { lightCurve, modelFixture, modelLR, predictResponse, settingsOut, systemSummary, targetDetail } from "../src/test/fixtures";

type Handler = (route: Route, url: URL) => unknown;

async function interceptApi(page: Page, routes: Record<string, unknown | Handler>) {
  // Match API calls only (a "**/api/**" glob would also catch Vite's /src/api/*.ts modules).
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const url = new URL(route.request().url());
    const key = `${route.request().method()} ${url.pathname.replace(/^\/api/, "")}`;
    const hit = routes[key];
    if (hit === undefined) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: `No test fixture for ${key}`, code: "no_fixture" }) });
      return;
    }
    const out = typeof hit === "function" ? await (hit as Handler)(route, url) : hit;
    // `{ __status, body }` answers with an HTTP error envelope; anything else is a 200 JSON body.
    const envelope = out !== null && typeof out === "object" && "__status" in out ? (out as { __status: number; body: unknown }) : null;
    await route.fulfill({ status: envelope?.__status ?? 200, contentType: "application/json", body: JSON.stringify(envelope ? envelope.body : out) });
  });
}

const common = {
  "GET /health": { status: "ok", version: "1.0.0", pipeline_version: "1.0" },
  "GET /system/summary": systemSummary(),
  "GET /settings": settingsOut,
  "GET /targets/11442793": targetDetail(),
  "GET /lightcurves/11442793": lightCurve(),
};

test.describe("Planet Detection (test fixtures)", () => {
  test("scores a signal and shows a verdict per model with every caveat", async ({ page }) => {
    let body: unknown = null;
    await interceptApi(page, {
      ...common,
      "GET /models": [modelLR, modelFixture],
      "POST /predictions": (route: Route) => {
        body = route.request().postDataJSON();
        return predictResponse();
      },
    });
    await page.goto("/detect?kepid=11442793&signal=41");
    await expect(page.getByRole("checkbox", { name: /Logistic regression/ })).toBeChecked();
    await page.getByRole("button", { name: /Score signal/ }).click();

    const verdicts = page.getByTestId("prediction-verdict");
    await expect(verdicts).toHaveCount(2);
    expect(body).toMatchObject({ model_version_ids: [1], source: { type: "catalog", kepid: 11442793, signal_id: 41 }, ephemeris_source: "catalog" });
    await expect(page.getByTestId("research-lead-note")).toHaveCount(2);
    await expect(page.getByTestId("research-lead-note").first()).toContainText("Research lead — not a confirmed discovery");
    await expect(page.getByText("Fixture model", { exact: true })).toBeVisible();
    await expect(page.getByText("Seen during training")).toBeVisible();
    await expect(page.getByRole("region", { name: "NASA catalogue labels" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Data quality report" })).toBeVisible();
    await expect(page.locator(".js-plotly-plot").first()).toBeVisible({ timeout: 30_000 }); // model input views
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(sw).toBeLessThanOrEqual(cw as number);
  });

  test("no model trained: friendly call to action instead of a score", async ({ page }) => {
    await interceptApi(page, { ...common, "GET /models": [] });
    await page.goto("/detect?kepid=11442793&signal=41");
    await expect(page.getByText("No trained model yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Model Training" }).first()).toHaveAttribute("href", "/training");
    await expect(page.getByRole("button", { name: /Score signal/ })).toBeDisabled();
  });

  test("409 no_model from the API is turned into the same call to action", async ({ page }) => {
    await interceptApi(page, {
      ...common,
      "GET /models": [modelLR],
      "POST /predictions": { __status: 409, body: { detail: "No trained model is available", code: "no_model", hint: "Train a model first (Training page)." } },
    });
    await page.goto("/detect?kepid=11442793&signal=41");
    await page.getByRole("button", { name: /Score signal/ }).click();
    await expect(page.getByText("No trained model yet")).toBeVisible();
  });
});
