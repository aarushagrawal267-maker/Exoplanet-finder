import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fxEvaluation, fxEvaluationCompare, fxEvaluationDetail, fxEvaluationExamples, fxFeatureImportance, fxJob, fxModel } from "../_ops/testFixtures";
import { mockApi, renderRoute } from "../_ops/testUtils";
import ModelEvaluationPage from "./index";

afterEach(() => vi.unstubAllGlobals());

describe("Model Evaluation", () => {
  it("asks for a trained model first", async () => {
    mockApi([
      { path: "/models", body: [] },
      { path: "/evaluation", body: [] },
    ]);
    renderRoute(<ModelEvaluationPage />, { url: "/evaluation", path: "/evaluation" });
    expect(await screen.findByText("Train a model first")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Model Training/ })).toHaveAttribute("href", "/training");
  });

  it("guards test-split runs: notice, count of earlier test evaluations and explicit confirmation", async () => {
    const api = mockApi([
      { path: "/models", body: [{ ...fxModel, n_test_evaluations: 1 }] },
      { path: "/evaluation", body: [{ ...fxEvaluation, id: 40, split: "test", test_evaluation_number: 1 }] },
      { method: "POST", path: "/evaluation/runs", status: 202, body: fxJob({ id: "ev-1", kind: "evaluate", title: "Evaluate (test evaluation #2)" }) },
      { path: "/jobs/ev-1", body: fxJob({ id: "ev-1", kind: "evaluate", title: "Evaluate (test evaluation #2)" }) },
    ]);
    renderRoute(<ModelEvaluationPage />, { url: "/evaluation", path: "/evaluation" });
    await userEvent.click(await screen.findByRole("radio", { name: "Test" }));
    expect(screen.getByText("The test split is evaluated once per final model")).toBeInTheDocument();
    expect(screen.getByText(/test evaluation so far/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open the existing test result" })).toBeInTheDocument();
    const run = screen.getByRole("button", { name: "Run test evaluation #2" });
    expect(run).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /run test evaluation #2/ }));
    await userEvent.click(run);
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ model_version_id: 21, split: "test", n_boot: 1000, seed: 0 }));
  });

  it("shows a finished evaluation: CIs, optimistic label, threshold table, errors and importance", async () => {
    mockApi([
      { path: "/models", body: [fxModel] },
      { path: "/evaluation", body: [fxEvaluation] },
      { path: "/evaluation/41", body: fxEvaluationDetail },
      { path: "/evaluation/41/examples", body: fxEvaluationExamples },
      { path: "/evaluation/41/feature-importance", body: fxFeatureImportance },
    ]);
    renderRoute(<ModelEvaluationPage />, { url: "/evaluation?eval=41", path: "/evaluation" });
    expect(await screen.findByText("Validation metrics are optimistic")).toBeInTheDocument();
    expect(screen.getByText("95% CI 0.800–0.980")).toBeInTheDocument();
    const thr = screen.getByRole("table", { name: /validation-chosen threshold and at 0.5/ });
    expect(thr).toHaveTextContent("0.420");
    expect(thr).toHaveTextContent("0.750"); // F1 at 0.5
    expect(await screen.findByText("TCE-000000012-01")).toBeInTheDocument(); // the false positive
    expect(screen.getByRole("link", { name: /KIC 12/ })).toHaveAttribute("href", "/targets/12");
    expect(await screen.findByText("Local view (all bins)")).toBeInTheDocument();
  });

  it("explains why CNNs have no permutation importance", async () => {
    mockApi([
      { path: "/models", body: [fxModel] },
      { path: "/evaluation", body: [] },
      { path: "/evaluation/41", body: { ...fxEvaluationDetail, model_type: "cnn_two_view", split: "test", test_evaluation_number: 1 } },
      { path: "/evaluation/41/examples", body: fxEvaluationExamples },
    ]);
    renderRoute(<ModelEvaluationPage />, { url: "/evaluation?eval=41", path: "/evaluation" });
    expect(await screen.findByText("Not available for CNNs")).toBeInTheDocument();
    expect(screen.getAllByText(/Test · unbiased · #1/).length).toBeGreaterThan(0);
  });

  it("compares evaluations and warns when datasets differ", async () => {
    mockApi([
      { path: "/models", body: [fxModel] },
      { path: "/evaluation", body: fxEvaluationCompare.evaluations },
      { path: "/evaluation/compare", query: (q) => q.get("ids") === "41,42", body: fxEvaluationCompare },
      { path: "/evaluation/41", body: fxEvaluationDetail },
      { path: "/evaluation/42", body: { ...fxEvaluationDetail, id: 42, model_type: "cnn_two_view", dataset_id: 8 } },
    ]);
    renderRoute(<ModelEvaluationPage />, { url: "/evaluation?compare=41,42", path: "/evaluation" });
    const compare = await screen.findByRole("region", { name: "Comparison" });
    expect(await within(compare).findByText("These evaluations are not directly comparable")).toBeInTheDocument();
    expect(within(compare).getByRole("table", { name: /Aligned metrics/ })).toHaveTextContent("0.910");
    expect(within(compare).getByLabelText("Metric comparison across 2 models")).toBeInTheDocument();
  });
});
