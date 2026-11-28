/**
 * Science pages against the REAL backend (a Vite server proxied to a running API with the NASA
 * catalogue loaded). Before the tests run, the light curves they open (Kepler-2 = KIC 10666592 and
 * Kepler-90 = KIC 11442793, about 8 MB each from NASA MAST) are downloaded through the API if they
 * are not cached yet; without a catalogue, or when MAST cannot be reached, the tests are skipped
 * with a message saying what to do. Read-only apart from that download, cached analyses (BLS /
 * transit / injection are not stored) and, when a model exists, one prediction. Destructive actions
 * (storage clear, catalogue refresh) are only opened and cancelled.
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const KEPLER2 = 10666592;
const KEPLER2_B = 19997; // TCE-010666592-01
const KEPLER90 = 11442793;

async function noSideways(page: Page) {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw, "no horizontal page scroll").toBeLessThanOrEqual(cw as number);
}

test.describe.configure({ timeout: 120_000 });

const LIGHT_CURVE_BUDGET_MS = 600_000; // two stars from MAST on a slow connection

/** Download (or confirm cached) the light curve of `kepid`; returns an error message or null. */
async function ensureLightCurve(api: APIRequestContext, kepid: number): Promise<string | null> {
  const start = await api.post(`/api/targets/${kepid}/download`);
  if (start.status() === 200) return null; // already cached
  if (start.status() !== 202) return `POST /api/targets/${kepid}/download returned HTTP ${start.status()}: ${await start.text()}`;
  const job = (await start.json()) as { id: string };
  const deadline = Date.now() + LIGHT_CURVE_BUDGET_MS;
  while (Date.now() < deadline) {
    const j = (await (await api.get(`/api/jobs/${job.id}`)).json()) as { status: string; error?: string | null };
    if (j.status === "succeeded") {
      const t = (await (await api.get(`/api/targets/${kepid}`)).json()) as { target?: { lc_status?: string } };
      const status = t.target?.lc_status;
      return status === undefined || status === "available" ? null : `KIC ${kepid}: light curve status '${status}' after download`;
    }
    if (j.status === "failed" || j.status === "cancelled") return `KIC ${kepid}: download ${j.status}${j.error ? `: ${j.error}` : ""}`;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return `KIC ${kepid}: download did not finish within ${LIGHT_CURVE_BUDGET_MS / 1000} s`;
}

// Tests that need the catalogue and two cached light curves; Research Docs and Settings below do not.
test.describe("with the NASA catalogue and cached light curves", () => {
  test.beforeAll(async ({ playwright }, testInfo) => {
    testInfo.setTimeout(LIGHT_CURVE_BUDGET_MS + 60_000);
    const api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
    try {
      const res = await api.get("/api/system/summary");
      testInfo.skip(!res.ok(), `The backend API is not reachable (GET /api/system/summary → HTTP ${res.status()}); start it with scripts/start.sh.`);
      const summary = (await res.json()) as { catalog?: { n_signals?: number } };
      testInfo.skip(
        !summary.catalog?.n_signals,
        "The NASA catalogue is not loaded: run `exofinder refresh-catalog` (or Overview → Refresh catalogue) before the science e2e tests.",
      );
      for (const kepid of [KEPLER2, KEPLER90]) {
        const problem = await ensureLightCurve(api, kepid);
        testInfo.skip(problem !== null, `Could not cache a light curve the science tests need (${problem}). Check the connection to NASA MAST, or run \`exofinder download --kepid ${kepid}\`.`);
      }
    } finally {
      await api.dispose();
    }
  });

  test("Overview shows live counts from /api/system/summary", async ({ page, request }) => {
    const summary = await (await request.get("/api/system/summary")).json();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Find transit-like signals");
    await expect(page.getByText(summary.catalog.n_signals.toLocaleString("en-US")).first()).toBeVisible();
    await expect(page.getByText(/steps done/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh catalogue" }).first()).toBeVisible(); // not clicked: it re-downloads NASA tables
    await noSideways(page);
  });

  test("Signal Explorer: server filters, detail panel with light curve and preselected links", async ({ page, isMobile }) => {
    await page.goto(`/signals?q=${KEPLER2}`);
    const table = page.getByRole("table", { name: "Catalogue signals" });
    await expect(table.getByText("TCE-010666592-01")).toBeVisible();
    if (isMobile) await page.getByRole("button", { name: /Filters/ }).click();
    await page.getByRole("group", { name: "Catalogue category" }).getByRole("button", { name: "Confirmed" }).click();
    await expect(page).toHaveURL(/cat=confirmed/);
    await table.getByText("TCE-010666592-01").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("link", { name: /Transit analysis/ })).toHaveAttribute("href", `/transit?kepid=${KEPLER2}&signal=${KEPLER2_B}`);
    await expect(dialog.locator(".js-plotly-plot").first()).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByText(/cadences/).first()).toBeVisible();
    await noSideways(page);
  });

  test("Target Dossier: stellar parameters, signals and light curve of Kepler-90", async ({ page }) => {
    await page.goto(`/targets/${KEPLER90}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kepler-90 (KIC 11442793)");
    await expect(page.getByText("Effective temperature")).toBeVisible();
    await expect(page.getByRole("table", { name: "Catalogue signals on this star" }).getByRole("row")).toHaveCount(9); // header + 8 signals
    await page.getByRole("table", { name: "Catalogue signals on this star" }).getByText("Kepler-90 h").click();
    await expect(page.getByText("Folded on Kepler-90 h")).toBeVisible();
    await expect(page.locator(".js-plotly-plot").first()).toBeVisible({ timeout: 60_000 });
    await noSideways(page);
  });

  test("command palette searches targets and opens the dossier", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Search pages and targets" }).fill("Kepler-90");
    await expect(page.getByRole("option", { name: /Kepler-90 \(KIC 11442793\)/ }).first()).toBeVisible();
    await page.getByRole("option", { name: /Kepler-90 \(KIC 11442793\)/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/targets/${KEPLER90}`));
  });

  test("Transit Analysis: BLS, transit fit with vetting, and a SYNTHETIC injection", async ({ page, isMobile }) => {
    await page.goto(`/transit?kepid=${KEPLER2}&signal=${KEPLER2_B}`);
    await expect(page.getByRole("link", { name: "Kepler-2 (KIC 10666592)" })).toBeVisible();
    await page.getByRole("button", { name: "Run BLS search" }).click();
    const peaks = page.getByRole("table", { name: "Strongest BLS peaks" });
    await expect(peaks).toBeVisible({ timeout: 90_000 });
    await expect(peaks.getByText("Best", { exact: true })).toBeVisible();
    await expect(peaks.getByText(/Alias/).first()).toBeVisible();

    await page.getByRole("button", { name: "Analyse transit" }).click();
    await expect(page.getByText("Odd / even depths")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("table", { name: "Catalogue, measured and estimated transit parameters" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Data quality report" })).toBeVisible();

    if (!isMobile) {
      await expect(page.getByText("SYNTHETIC", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Inject and search" }).click();
      await expect(page.getByText("SYNTHETIC — not an observation")).toBeVisible({ timeout: 90_000 });
    }
    await noSideways(page);
  });

  test("Planet Detection on the live backend: a score, or the no-model call to action", async ({ page, request }) => {
    test.setTimeout(300_000); // a real score (synchronous light-curve processing + model) on a busy CPU
    const models = (await (await request.get("/api/models")).json()) as Array<{ compatible: boolean; checkpoint_exists: boolean }>;
    await page.goto(`/detect?kepid=${KEPLER90}&signal=41`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Planet Detection");
    if (!models.some((m) => m.compatible && m.checkpoint_exists)) {
      await expect(page.getByText("No trained model yet")).toBeVisible();
      await expect(page.getByRole("link", { name: "Open Model Training" }).first()).toHaveAttribute("href", "/training");
      await expect(page.getByRole("button", { name: /Score signal/ })).toBeDisabled();
    } else {
      await page.getByRole("button", { name: /Score signal/ }).click();
      await expect(page.getByTestId("prediction-verdict").first()).toBeVisible({ timeout: 240_000 });
      await expect(page.getByTestId("research-lead-note").first()).toContainText("Research lead — not a confirmed discovery");
      await expect(page.getByRole("region", { name: "NASA catalogue labels" })).toBeVisible();
    }
    await noSideways(page);
  });

  test("Candidate Explorer and Prediction History load with their empty or ranked states", async ({ page }) => {
    await page.goto("/candidates");
    await expect(page.getByText(/research leads for follow-up/).first()).toBeVisible();
    await expect(page.getByRole("table", { name: "Ranked candidates" }).or(page.getByText("No trained model yet").first())).toBeVisible();
    await noSideways(page);
    await page.goto("/predictions");
    await expect(page.getByRole("table", { name: "Stored predictions" })).toBeVisible();
    await noSideways(page);
  });
});

test("Research Docs: index, reader with tables and formulas, page navigation", async ({ page }) => {
  await page.goto("/docs");
  await page.getByRole("link", { name: /Research methodology/ }).first().click();
  await expect(page).toHaveURL(/\/docs\/methodology$/);
  const article = page.getByRole("article");
  await expect(article.getByRole("table").first()).toBeVisible();
  await expect(article.getByRole("math").first()).toBeVisible();
  await page.getByRole("link", { name: /^Next:/ }).click();
  await expect(page).not.toHaveURL(/\/docs\/methodology$/);
  await noSideways(page);
});

test("Settings: preferences, storage (clear is confirmed, then cancelled), backup and diagnostics", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByLabel("Compute device")).toBeVisible();
  const clear = page.getByRole("button", { name: /^Clear / }).and(page.locator(":not([disabled])")).first();
  if (await clear.count()) {
    await clear.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/cannot be undone/)).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  }
  await expect(page.getByRole("link", { name: /Download backup/ })).toHaveAttribute("href", "/api/settings/backup");
  await expect(page.getByText("Versions")).toBeVisible();
  await noSideways(page);
});
