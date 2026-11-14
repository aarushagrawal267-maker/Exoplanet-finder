import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EstimateOut } from "@/api/schemasOps";
import { fxDataset, fxExperimentDetail, fxJob, fxModel, fxModelCards } from "../_ops/testFixtures";
import { mockApi, renderRoute } from "../_ops/testUtils";
import ModelTrainingPage from "./index";

afterEach(() => vi.unstubAllGlobals());

const estimate: EstimateOut = {
  model_type: "cnn_two_view",
  dataset_id: 7,
  n_train: 80,
  batches_per_epoch: 2,
  seconds_per_epoch: 12,
  seconds_per_batch: 6,
  num_threads: 4,
  device: "cpu",
  max_epochs: 50,
  ensemble_size: 1,
  est_max_total_seconds: 600,
  note: "Measured on this machine (fixture).",
};

describe("Model Training", () => {
  it("asks for a dataset first", async () => {
    mockApi([
      { path: "/datasets", body: [] },
      { path: "/training/model-types", body: fxModelCards },
      { path: "/jobs", body: [] },
      { path: "/models", body: [] },
    ]);
    renderRoute(<ModelTrainingPage />, { url: "/training", path: "/training" });
    expect(await screen.findByText("Build a dataset first")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Dataset Explorer/ })).toHaveAttribute("href", "/datasets");
    expect(await screen.findByText("No trained models yet")).toBeInTheDocument();
  });

  it("shows the measured estimate, validates the config and starts a run", async () => {
    const api = mockApi([
      { path: "/datasets", body: [fxDataset] },
      { path: "/training/model-types", body: fxModelCards },
      { path: "/training/estimate", body: estimate },
      { path: "/jobs", body: [] },
      { path: "/models", body: [fxModel] },
      { method: "POST", path: "/training/runs", status: 202, body: { experiment_id: 31, job: fxJob({ id: "train-1", kind: "train", title: "Train Logistic regression", params: { experiment_id: 31 } }) } },
      { path: "/jobs/train-1", body: fxJob({ id: "train-1", kind: "train", title: "Train Logistic regression", params: { experiment_id: 31 }, status: "succeeded", progress: 1 }) },
      { path: "/experiments/31", body: fxExperimentDetail },
    ]);
    renderRoute(<ModelTrainingPage />, { url: "/training", path: "/training" });
    // Default: the two-view CNN with its card defaults and the measured epoch time.
    expect(await screen.findByRole("radio", { name: /Two-view CNN/ })).toHaveAttribute("aria-checked", "true");
    expect(await screen.findByText("12 s")).toBeInTheDocument();
    expect(screen.getByText("10 min 00 s")).toBeInTheDocument(); // 12 s × 50 epochs × 1 member

    // An invalid learning rate blocks the request.
    const lr = screen.getByRole("textbox", { name: /Learning rate/ });
    await userEvent.clear(lr);
    await userEvent.type(lr, "0");
    await userEvent.click(screen.getByRole("button", { name: "Start training" }));
    expect(await screen.findByText("A learning rate above 0 and at most 1.")).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);

    // Switch to logistic regression: its own grid fields, and the run starts.
    await userEvent.click(screen.getByRole("radio", { name: /Logistic regression/ }));
    expect(screen.getByRole("textbox", { name: /C grid/ })).toHaveValue("0.01, 0.1");
    await userEvent.click(screen.getByRole("button", { name: "Start training" }));
    await waitFor(() =>
      expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({
        name: null,
        model_type: "logreg",
        dataset_id: 7,
        config: { logreg_c_grid: [0.01, 0.1], logreg_max_iter: 5000, cv_folds: 3, seed: 42 },
      }),
    );
    // The live view follows the job and, once done, offers the evaluation.
    const live = await screen.findByRole("region", { name: "Live training" });
    expect(await within(live).findByText("Training finished")).toBeInTheDocument();
    expect(await within(live).findByRole("link", { name: /Evaluate this model/ })).toHaveAttribute("href", "/evaluation?model=21");
  });

  it("lists trained models and confirms a forced delete of the only model", async () => {
    const api = mockApi([
      { path: "/datasets", body: [fxDataset] },
      { path: "/training/model-types", body: fxModelCards },
      { path: "/training/estimate", body: estimate },
      { path: "/jobs", body: [] },
      { path: "/models", body: [fxModel] },
      { method: "DELETE", path: "/models/21", query: (q) => q.get("force") !== "true", status: 409, body: { detail: "This is the only (active) model", code: "model_is_active", hint: "Train another model first." } },
      { method: "DELETE", path: "/models/21", query: (q) => q.get("force") === "true", body: { deleted: true, model_id: 21, models: 1, evaluations: 1, predictions: 0, active_model_id: null } },
    ]);
    renderRoute(<ModelTrainingPage />, { url: "/training", path: "/training" });
    await screen.findByText("#21 · Logistic regression · Fixture Pilot");
    const table = screen.getByRole("table", { name: "Trained models" });
    expect(within(table).getByText("Fixture LR")).toBeInTheDocument();
    expect(within(table).getByText("active")).toBeInTheDocument();
    expect(within(table).getByText("0.910")).toBeInTheDocument();
    await userEvent.click(within(table).getByRole("button", { name: "Delete Fixture LR" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete model" }));
    expect(await within(dialog).findByText(/stop working until you train another model/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete anyway" }));
    expect(await screen.findByText(/Model #21 deleted/)).toBeInTheDocument();
    expect(api.calls.filter((c) => c.method === "DELETE").map((c) => c.search)).toEqual(["", "?force=true"]);
  });
});
