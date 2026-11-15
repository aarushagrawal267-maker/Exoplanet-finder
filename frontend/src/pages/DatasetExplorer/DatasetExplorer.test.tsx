import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fxDataset, fxDatasetDetail, fxExamples, fxJob, fxTiers } from "../_ops/testFixtures";
import { mockApi, renderRoute } from "../_ops/testUtils";
import DatasetExplorerPage from "./index";

afterEach(() => vi.unstubAllGlobals());

describe("Dataset Explorer", () => {
  it("explains the empty state and validates + submits the build form", async () => {
    const api = mockApi([
      { path: "/datasets", body: [] },
      { path: "/datasets/tiers", body: fxTiers },
      { method: "POST", path: "/datasets", status: 202, body: fxJob() },
      { path: "/datasets/7", body: { ...fxDatasetDetail, status: "building", stats: null } },
      { path: "/jobs/job-1", body: fxJob() },
    ]);
    renderRoute(<DatasetExplorerPage />, { url: "/datasets", path: "/datasets" });
    expect(await screen.findByText("No datasets yet")).toBeInTheDocument();
    const pilot = await screen.findByRole("radio", { name: /Pilot/ });
    expect(pilot).toHaveAttribute("aria-checked", "true");
    expect(within(pilot).getByText("300")).toBeInTheDocument();

    const name = screen.getByRole("textbox", { name: /Name/ });
    await userEvent.clear(name);
    await userEvent.click(screen.getByRole("button", { name: "Build dataset" }));
    expect(await screen.findByText("Give the dataset a name.")).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);

    await userEvent.click(screen.getByRole("radio", { name: /Custom/ }));
    await userEvent.type(name, "UI test set");
    await userEvent.click(screen.getByRole("button", { name: "Build dataset" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toMatchObject({ name: "UI test set", tier: "custom", max_signals: 500, split_seed: 42, exclude_conflicts: true, pipeline: { detrend_method: "spline" } }));
    // The new dataset opens and shows its build progress.
    expect(await screen.findByText("Fixture Pilot")).toBeInTheDocument();
  });

  it("shows splits, exclusions with human labels, quality and filters examples by reason", async () => {
    const api = mockApi([
      { path: "/datasets", body: [fxDataset] },
      { path: "/datasets/7", body: fxDatasetDetail },
      { path: "/datasets/7/examples", body: fxExamples },
    ]);
    renderRoute(<DatasetExplorerPage />, { url: "/datasets?id=7", path: "/datasets" });
    expect(await screen.findByRole("table", { name: "Examples per split" })).toHaveTextContent("Validation");
    expect(screen.getByText("Autovetter label and KOI disposition disagree (excluded on request)")).toBeInTheDocument();
    expect(screen.getByLabelText("Data-quality grades of the processed signals")).toHaveTextContent("90");
    expect(await screen.findByText("TCE-000000011-01")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show examples excluded for label_conflict" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/datasets/7/examples" && c.search.includes("reason=label_conflict") && c.search.includes("included=false"))).toBe(true));
    await userEvent.click(screen.getByRole("tab", { name: /Provenance/ }));
    expect(screen.getByText("Content hash (SHA-256)")).toBeInTheDocument();
    expect(screen.getByText("NASA catalogue snapshots")).toBeInTheDocument();
    expect(screen.getByText("q1_q17_dr24_tce")).toBeInTheDocument();
  });

  it("offers a forced delete with an explicit warning when models depend on the dataset", async () => {
    const api = mockApi([
      { path: "/datasets", body: [{ ...fxDataset, n_models: 2 }] },
      { path: "/datasets/7", body: { ...fxDatasetDetail, n_models: 2 } },
      { path: "/datasets/7/examples", body: fxExamples },
      {
        method: "DELETE",
        path: "/datasets/7",
        query: (q) => q.get("force") !== "true",
        status: 409,
        body: { detail: "2 model(s) and 2 experiment(s) depend on this dataset", code: "dataset_in_use", hint: "Delete those experiments first." },
      },
      { method: "DELETE", path: "/datasets/7", query: (q) => q.get("force") === "true", body: { deleted: true, dataset_id: 7, examples: 105, experiments: 2, models: 2, evaluations: 3, predictions: 0 } },
    ]);
    renderRoute(<DatasetExplorerPage />, { url: "/datasets?id=7", path: "/datasets" });
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("2 model(s) were trained on this dataset");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete dataset" }));
    expect(await within(dialog).findByText("2 model(s) and 2 experiment(s) depend on this dataset")).toBeInTheDocument();
    const force = within(dialog).getByRole("button", { name: "Delete dataset and dependants" });
    expect(force).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("checkbox"));
    await userEvent.click(force);
    expect(await screen.findByText("Dataset #7 deleted")).toBeInTheDocument();
    expect(screen.getByText(/2 experiment\(s\), 2 model\(s\), 3 evaluation\(s\)/)).toBeInTheDocument();
    expect(api.calls.filter((c) => c.method === "DELETE").map((c) => c.search)).toEqual(["", "?force=true"]);
  });
});
