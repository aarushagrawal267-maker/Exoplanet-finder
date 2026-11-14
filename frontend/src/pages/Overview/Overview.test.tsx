import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { baseRoutes, mockApi, renderPage } from "@/test/api";
import { job, systemSummary } from "@/test/fixtures";
import OverviewPage from "./index";

vi.mock("@/components/brand/TransitDiagram", () => ({ TransitDiagram: () => <div data-testid="diagram" /> }));
afterEach(() => vi.unstubAllGlobals());

describe("Overview", () => {
  it("shows live counts, the prediction model with its test metrics and recent predictions", async () => {
    mockApi([...baseRoutes, { path: "/system/summary", body: systemSummary() }]);
    renderPage(<OverviewPage />);
    expect(await screen.findByText("22,644")).toBeInTheDocument();
    expect(screen.getByText("14,233")).toBeInTheDocument();
    expect(screen.getByText("6,365")).toBeInTheDocument(); // stars cached
    const model = screen.getByText("Pilot DR24 v1 - Logistic regression").closest(".card-surface") as HTMLElement;
    expect(within(model).getByText("Test split (held-out stars)")).toBeInTheDocument();
    expect(within(model).getByText("0.790")).toBeInTheDocument(); // PR-AUC
    expect(screen.getByRole("link", { name: /KOI-K00351\.06/ })).toHaveAttribute("href", "/predictions?id=7");
    expect(screen.getByText(/research leads, not discoveries/)).toBeInTheDocument();
  });

  it("offers the next pending step with a link to where it is done", async () => {
    mockApi([...baseRoutes, { path: "/system/summary", body: systemSummary() }]);
    renderPage(<OverviewPage />);
    expect(await screen.findByText("Next step: Evaluate on the test set")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /Open Model Evaluation/ });
    expect(links[0]).toHaveAttribute("href", "/evaluation");
    expect(screen.getByText("5 of 6 steps done")).toBeInTheDocument();
  });

  it("starts a catalogue refresh and follows the job until it finishes", async () => {
    let polls = 0;
    const api = mockApi([
      ...baseRoutes,
      { path: "/system/summary", body: systemSummary() },
      { method: "POST", path: "/catalog/refresh", status: 202, body: job({ status: "queued", progress: 0 }) },
      {
        path: "/jobs/job-1",
        handle: () => {
          polls += 1;
          return { body: polls < 2 ? job() : job({ status: "succeeded", progress: 1, message: "Catalogue refreshed", result: { n_signals: 22650 } }) };
        },
      },
    ]);
    const user = userEvent.setup();
    renderPage(<OverviewPage />);
    const button = await screen.findByRole("button", { name: "Refresh catalogue" });
    await user.click(button);
    await waitFor(() => expect(api.find("POST", "/catalog/refresh")).toHaveLength(1));
    expect(await screen.findByRole("region", { name: "Job: Refresh NASA catalogue" })).toBeInTheDocument();
    expect(await screen.findByText("Catalogue refreshed", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText("22,650")).toBeInTheDocument();
  });

  it("reports a refresh that is already running (409 job_running)", async () => {
    mockApi([
      ...baseRoutes,
      { path: "/system/summary", body: systemSummary() },
      { method: "POST", path: "/catalog/refresh", status: 409, body: { detail: "A catalogue refresh is already running", code: "job_running", hint: "Wait for it to finish." } },
    ]);
    const user = userEvent.setup();
    renderPage(<OverviewPage />);
    await user.click(await screen.findByRole("button", { name: "Refresh catalogue" }));
    expect(await screen.findByText("A catalogue refresh is already running")).toBeInTheDocument();
    expect(screen.getByText("Wait for it to finish.")).toBeInTheDocument();
    expect(screen.getByText("code: job_running")).toBeInTheDocument();
  });

  it("explains how to get a model when none is trained", async () => {
    mockApi([...baseRoutes, { path: "/system/summary", body: systemSummary({ models: { count: 0, n_real: 0, active: null, default_model_id: null, default_for_predictions: null } }) }]);
    renderPage(<OverviewPage />);
    expect(await screen.findByText(/No trained model yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Train a model/ })).toHaveAttribute("href", "/training");
  });

  it("shows an error panel when the summary cannot be loaded", async () => {
    mockApi([...baseRoutes, { path: "/system/summary", status: 500, body: { detail: "Database is locked", code: "db_locked", hint: "Retry in a moment." } }]);
    renderPage(<OverviewPage />);
    expect(await screen.findByText("Database is locked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
