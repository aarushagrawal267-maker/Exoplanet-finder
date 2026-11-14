import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fxDataset, fxExperiment, fxExperimentCnn, fxExperimentCompare, fxExperimentDetail } from "../_ops/testFixtures";
import { mockApi, renderRoute } from "../_ops/testUtils";
import ExperimentsPage from "./index";

afterEach(() => vi.unstubAllGlobals());

describe("Experiments", () => {
  it("explains the empty log", async () => {
    mockApi([
      { path: "/experiments", body: [] },
      { path: "/datasets", body: [] },
    ]);
    renderRoute(<ExperimentsPage />, { url: "/experiments", path: "/experiments" });
    expect(await screen.findByText("No experiments yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Train a model first/ })).toHaveAttribute("href", "/training");
  });

  it("filters the log through the API and opens a run with its config, metrics and notes", async () => {
    const api = mockApi([
      { path: "/experiments", body: [fxExperiment, fxExperimentCnn] },
      { path: "/datasets", body: [fxDataset] },
      { path: "/experiments/31", body: fxExperimentDetail },
      { method: "PATCH", path: "/experiments/31", body: ({ init }) => ({ ...fxExperimentDetail, ...JSON.parse(String(init?.body)) }) },
    ]);
    renderRoute(<ExperimentsPage />, { url: "/experiments", path: "/experiments" });
    await screen.findByText("Fixture CNN run");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Model type" }), "cnn_two_view");
    await waitFor(() => expect(api.calls.some((c) => c.path === "/experiments" && c.search.includes("model_type=cnn_two_view"))).toBe(true));
    expect(api.calls.some((c) => c.path === "/experiments" && c.search.includes("archived=false"))).toBe(true);

    await userEvent.click(screen.getByText("Fixture LR run"));
    const details = await screen.findByRole("region", { name: "Run details" });
    expect(await within(details).findByText("C grid (inverse regularisation)")).toBeInTheDocument();
    expect(within(details).queryByText("Learning rate")).not.toBeInTheDocument(); // not used by logistic regression
    expect(within(details).getByText("Not evaluated on the test split. Evaluate each final model once, from the Model Evaluation page.")).toBeInTheDocument();
    expect(within(details).getByRole("group", { name: "Download the experiment report" })).toBeInTheDocument();

    await userEvent.type(within(details).getByRole("textbox", { name: "Notes" }), "Seed sweep next");
    await userEvent.type(within(details).getByRole("textbox", { name: "Add a tag" }), "pilot{Enter}");
    await userEvent.click(within(details).getByRole("button", { name: "Save notes and tags" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ notes: "Seed sweep next", tags: ["baseline", "pilot"] }));
  });

  it("compares runs: configuration differences and the comparison report", async () => {
    mockApi([
      { path: "/experiments", body: [fxExperiment, fxExperimentCnn] },
      { path: "/datasets", body: [fxDataset] },
      { path: "/experiments/compare", query: (q) => q.get("ids") === "31,32", body: fxExperimentCompare },
    ]);
    renderRoute(<ExperimentsPage />, { url: "/experiments", path: "/experiments" });
    await userEvent.click(await screen.findByRole("checkbox", { name: "Add experiment 31 to the comparison" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Add experiment 32 to the comparison" }));
    const compare = await screen.findByRole("region", { name: "Comparison" });
    const diff = await within(compare).findByRole("table", { name: "Configuration differences" });
    expect(diff).toHaveTextContent("logreg");
    expect(diff).toHaveTextContent("cnn_two_view");
    expect(within(compare).getByRole("group", { name: "Download the comparison report" })).toBeInTheDocument();
    expect(within(compare).getByLabelText(/Validation PR-AUC by epoch/)).toBeInTheDocument();
  });
});
