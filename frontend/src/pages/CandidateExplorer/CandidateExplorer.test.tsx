import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { baseRoutes, mockApi, renderPage } from "@/test/api";
import { candidatePage, job, modelLR } from "@/test/fixtures";
import CandidateExplorerPage from "./index";

afterEach(() => vi.unstubAllGlobals());

describe("Candidate Explorer", () => {
  it("ranks scored candidates with agreement, uncertainty, grade and the research-leads disclaimer", async () => {
    const api = mockApi([...baseRoutes, { path: "/models", body: [modelLR] }, { path: "/predictions/candidates", body: candidatePage }]);
    renderPage(<CandidateExplorerPage />, { path: "/candidates", route: "/candidates" });
    const table = await screen.findByRole("table", { name: "Ranked candidates" });
    expect(await within(table).findByText("K00752.02")).toBeInTheDocument();
    expect(within(table).getAllByText("0.930")).toHaveLength(2); // mean and max
    expect(within(table).getByText("1/1")).toBeInTheDocument();
    expect(await screen.findByText(/These rankings are research leads for follow-up/)).toBeInTheDocument();
    const q = api.find("GET", "/predictions/candidates")[0]!.url.searchParams;
    expect(q.get("category")).toBe("candidate");
    expect(q.get("sort")).toBe("mean_probability");
    // training-seen candidates are hidden by default, and the page says how many
    expect(q.get("include_seen")).toBe("false");
    expect(await screen.findByText(/hidden \(seen in training\)/)).toBeInTheDocument();
  });

  it("changes the ranking on the server", async () => {
    const api = mockApi([...baseRoutes, { path: "/models", body: [modelLR] }, { path: "/predictions/candidates", body: candidatePage }]);
    const user = userEvent.setup();
    renderPage(<CandidateExplorerPage />, { path: "/candidates", route: "/candidates" });
    await screen.findByText("K00752.02");
    await user.selectOptions(screen.getByLabelText("Rank by"), "uncertainty");
    await waitFor(() => expect(api.find("GET", "/predictions/candidates").at(-1)!.url.searchParams.get("sort")).toBe("uncertainty"));
  });

  it("opens per-model scores for a candidate", async () => {
    mockApi([...baseRoutes, { path: "/models", body: [modelLR] }, { path: "/predictions/candidates", body: candidatePage }]);
    const user = userEvent.setup();
    renderPage(<CandidateExplorerPage />, { path: "/candidates", route: "/candidates" });
    await user.click(await screen.findByText("K00752.02"));
    const dialog = await screen.findByRole("dialog", { name: "K00752.02" });
    expect(within(dialog).getByRole("link", { name: "prediction #11" })).toHaveAttribute("href", "/predictions?id=11");
    expect(within(dialog).getByRole("link", { name: /Score again/ })).toHaveAttribute("href", "/detect?kepid=10797460&signal=5001");
  });

  it("starts batch scoring and shows the job's progress", async () => {
    const api = mockApi([
      ...baseRoutes,
      { path: "/models", body: [modelLR] },
      { path: "/predictions/candidates", body: candidatePage },
      { method: "POST", path: "/predictions/batch", status: 202, body: job({ id: "b1", kind: "batch_predict", title: "Batch scoring: candidate", progress: 0.25, message: "Scored 50/200" }) },
      { path: "/jobs/b1", body: job({ id: "b1", kind: "batch_predict", title: "Batch scoring: candidate", progress: 0.25, message: "Scored 50/200" }) },
    ]);
    const user = userEvent.setup();
    renderPage(<CandidateExplorerPage />, { path: "/candidates", route: "/candidates" });
    await user.click(await screen.findByRole("button", { name: "Start batch scoring" }));
    expect(await screen.findByRole("region", { name: "Job: Batch scoring: candidate" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    expect(api.find("POST", "/predictions/batch")[0]!.body).toEqual({ model_version_id: null, category: "candidate", only_downloaded: true, limit: 200, skip_existing: true });
  });

  it("explains a batch that has nothing to score", async () => {
    mockApi([
      ...baseRoutes,
      { path: "/models", body: [modelLR] },
      { path: "/predictions/candidates", body: { ...candidatePage, total: 0, items: [] } },
      { method: "POST", path: "/predictions/batch", status: 409, body: { detail: "No signals to score", code: "nothing_to_score", hint: "Download light curves for the stars first, or set only_downloaded=false." } },
    ]);
    const user = userEvent.setup();
    renderPage(<CandidateExplorerPage />, { path: "/candidates", route: "/candidates" });
    expect(await screen.findByText("No scored signals match")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start batch scoring" }));
    expect(await screen.findByText("No signals to score")).toBeInTheDocument();
    expect(screen.getByText(/Download light curves for the stars first/)).toBeInTheDocument();
  });

  it("points to Model Training when no model exists", async () => {
    mockApi([...baseRoutes, { path: "/models", body: [] }, { path: "/predictions/candidates", body: { ...candidatePage, total: 0, items: [], models: [] } }]);
    renderPage(<CandidateExplorerPage />, { path: "/candidates", route: "/candidates" });
    expect((await screen.findAllByText("No trained model yet")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Start batch scoring" })).toBeNull();
  });
});
