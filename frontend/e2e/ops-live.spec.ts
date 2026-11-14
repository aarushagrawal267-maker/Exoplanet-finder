/**
 * WRITE flow against the REAL backend — opt-in: runs only with E2E_OPS_WRITE=1, on the desktop
 * project, and only when a dataset whose name starts with "UI check" exists (build a small custom
 * one first). It trains a logistic regression named "UI check e2e LR" through the UI, follows it
 * live, evaluates it on the VALIDATION split (never test), edits the run's notes, and deletes the
 * experiment through the UI. Anything named "UI check e2e…" left behind by a failure is deleted
 * through the API afterwards.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";

const PREFIX = "UI check e2e";

async function cleanup(request: APIRequestContext) {
  const exps = (await (await request.get("/api/experiments")).json()) as Array<{ id: number; name: string }>;
  for (const e of exps.filter((x) => x.name.startsWith(PREFIX))) await request.delete(`/api/experiments/${e.id}`);
}

test.describe("training → evaluation → experiment (real backend, writes)", () => {
  test.skip(process.env.E2E_OPS_WRITE !== "1", "set E2E_OPS_WRITE=1 to run the write flow against the real backend");
  test.skip(({ isMobile }) => isMobile, "desktop only");
  test.setTimeout(240_000);
  test.afterAll(async ({ request }) => cleanup(request));

  test("train a UI-check LR, evaluate it on validation, annotate and delete the run", async ({ page, request }) => {
    const datasets = (await (await request.get("/api/datasets")).json()) as Array<{ id: number; name: string; status: string }>;
    const ds = datasets.find((d) => d.status === "ready" && d.name.startsWith("UI check"));
    test.skip(!ds, "no ready 'UI check…' dataset");
    const name = `${PREFIX} LR ${Date.now()}`;

    await page.goto(`/training?dataset=${ds?.id}`);
    await page.getByRole("radio", { name: /Logistic regression/ }).click();
    await page.getByRole("textbox", { name: /Run name/ }).fill(name);
    await page.getByRole("button", { name: "Start training" }).click();
    const live = page.getByRole("region", { name: "Live training" });
    await expect(live.getByText("Training finished")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole("list", { name: "Job notifications" }).getByText("Finished")).toBeVisible();

    await live.getByRole("link", { name: /Evaluate this model/ }).click();
    await expect(page).toHaveURL(/\/evaluation\?model=\d+/);
    await page.getByRole("radio", { name: "Validation" }).click();
    await page.getByRole("button", { name: "Evaluate on validation" }).click();
    await expect(page).toHaveURL(/eval=\d+/, { timeout: 120_000 });
    await expect(page.getByText("Validation metrics are optimistic", { exact: true })).toBeVisible();
    await expect(page.getByText(/95% CI/).first()).toBeVisible();

    const exps = (await (await request.get("/api/experiments")).json()) as Array<{ id: number; name: string }>;
    const exp = exps.find((e) => e.name === name);
    expect(exp).toBeTruthy();
    await page.goto(`/experiments?id=${exp?.id}`);
    const details = page.getByRole("region", { name: "Run details" });
    await details.getByRole("textbox", { name: "Notes" }).fill("Created by the e2e write flow.");
    await details.getByRole("button", { name: "Save notes and tags" }).click();
    await expect(details.getByText("Saved.")).toBeVisible();
    await details.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete experiment" }).click();
    await expect(page.getByText(`Experiment #${exp?.id} deleted`)).toBeVisible();
  });
});
