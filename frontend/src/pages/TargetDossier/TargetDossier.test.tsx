import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { baseRoutes, mockApi, renderPage } from "@/test/api";
import { job, lightCurve, targetDetail } from "@/test/fixtures";
import TargetDossierPage from "./index";

vi.mock("@/components/charts/Plot", () => ({ Plot: ({ ariaLabel }: { ariaLabel: string }) => <figure aria-label={ariaLabel} data-testid="plot" /> }));
afterEach(() => vi.unstubAllGlobals());

describe("Target Dossier", () => {
  it("shows stellar parameters with provenance, signals, memberships and predictions", async () => {
    mockApi([...baseRoutes, { path: "/targets/11442793", body: targetDetail() }, { path: "/lightcurves/11442793", body: lightCurve() }]);
    renderPage(<TargetDossierPage />, { path: "/targets/:kepid", route: "/targets/11442793" });
    expect(await screen.findByRole("heading", { level: 1, name: "Kepler-90 (KIC 11442793)" })).toBeInTheDocument();
    expect(screen.getByText("5,970 K")).toBeInTheDocument();
    expect(screen.getByText("1.200 R☉")).toBeInTheDocument();
    expect(screen.getAllByText("Catalogue").length).toBeGreaterThan(3); // provenance chips
    expect(screen.getByText("Reserved showcase")).toBeInTheDocument();
    const signals = screen.getByRole("table", { name: "Catalogue signals on this star" });
    expect(within(signals).getByText("Kepler-90 b")).toBeInTheDocument();
    expect(screen.getByText("test")).toBeInTheDocument();
    expect(screen.getByText("excluded")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /KOI-K00351\.06/ })).toHaveAttribute("href", "/predictions?id=7");
    // A single-signal star folds on that signal by default.
    expect(await screen.findByText("Folded on Kepler-90 b")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Planet detection/ })).toHaveAttribute("href", "/detect?kepid=11442793&signal=41");
  });

  it("downloads a light curve that is not cached and follows the job", async () => {
    const notCached = targetDetail({ target: { ...targetDetail().target, lc_status: "none", lc_cached: false, lc_n_cadences: null } });
    const api = mockApi([
      ...baseRoutes,
      { path: "/targets/11442793", body: notCached },
      { method: "POST", path: "/targets/11442793/download", status: 202, body: job({ id: "d1", kind: "download", title: "Download KIC 11442793", progress: 0.5, message: "Quarter 7/14" }) },
      { path: "/jobs/d1", body: job({ id: "d1", kind: "download", title: "Download KIC 11442793", progress: 0.5, message: "Quarter 7/14" }) },
    ]);
    const user = userEvent.setup();
    renderPage(<TargetDossierPage />, { path: "/targets/:kepid", route: "/targets/11442793" });
    await user.click(await screen.findByRole("button", { name: "Download light curve" }));
    expect(await screen.findByRole("region", { name: "Job: Download KIC 11442793" })).toBeInTheDocument();
    expect(screen.getByText("Quarter 7/14")).toBeInTheDocument();
    await waitFor(() => expect(api.find("POST", "/targets/11442793/download")).toHaveLength(1));
  });

  it("explains an unknown star and offers a search", async () => {
    mockApi([...baseRoutes, { path: "/targets/42", status: 404, body: { detail: "KIC 42 is not in the catalogue", code: "target_not_found", hint: null } }]);
    renderPage(<TargetDossierPage />, { path: "/targets/:kepid", route: "/targets/42" });
    expect(await screen.findByText("This star is not in the local catalogue")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("KIC 42");
    expect(screen.getByRole("combobox", { name: "Find a star" })).toBeInTheDocument();
  });

  it("rejects an invalid KIC id without calling the API", async () => {
    const api = mockApi(baseRoutes);
    renderPage(<TargetDossierPage />, { path: "/targets/:kepid", route: "/targets/abc" });
    expect(await screen.findByText("Not a valid KIC id")).toBeInTheDocument();
    expect(api.find("GET", /\/targets\//)).toHaveLength(0);
  });
});
