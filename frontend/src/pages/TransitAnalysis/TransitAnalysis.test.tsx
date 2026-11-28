import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { baseRoutes, mockApi, renderPage } from "@/test/api";
import { blsOut, injectionOut, kepler2Detail, lightCurve, transitOut } from "@/test/fixtures";
import TransitAnalysisPage from "./index";

vi.mock("@/components/charts/Plot", () => ({ Plot: ({ ariaLabel }: { ariaLabel: string }) => <figure aria-label={ariaLabel} data-testid="plot" /> }));
afterEach(() => vi.unstubAllGlobals());

const routes = [
  ...baseRoutes,
  { path: "/targets/10666592", body: kepler2Detail },
  { path: "/lightcurves/10666592", body: lightCurve({ kepid: 10666592 }) },
  { method: "POST" as const, path: "/analysis/bls", body: blsOut },
  { method: "POST" as const, path: "/analysis/transit", body: transitOut },
  { method: "POST" as const, path: "/analysis/injection", body: injectionOut },
];

describe("Transit Analysis", () => {
  it("asks for a light curve first", async () => {
    mockApi(routes);
    renderPage(<TransitAnalysisPage />, { path: "/transit", route: "/transit" });
    expect(screen.getByText("Choose a light curve to analyse")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Search the catalogue" })).toBeInTheDocument();
  });

  it("runs BLS on the selected star and lists peaks with their aliases", async () => {
    const api = mockApi(routes);
    const user = userEvent.setup();
    renderPage(<TransitAnalysisPage />, { path: "/transit", route: "/transit?kepid=10666592&signal=19997" });
    expect(await screen.findByText("Kepler-2 (KIC 10666592)")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Kepler-2 b/ })).toBeChecked();
    await user.click(await screen.findByRole("button", { name: "Run BLS search" }));
    const peaks = await screen.findByRole("table", { name: "Strongest BLS peaks" });
    expect(within(peaks).getByText("Alias · P/2")).toBeInTheDocument();
    expect(within(peaks).getByText("Best")).toBeInTheDocument();
    expect(api.find("POST", "/analysis/bls")[0]!.body).toEqual({ source: { type: "catalog", kepid: 10666592 }, min_period: null, max_period: null });
    expect(screen.getByText(/can lock onto aliases/)).toBeInTheDocument();
  });

  it("fits the transit on the catalogue ephemeris and shows vetting checks with provenance", async () => {
    const api = mockApi(routes);
    const user = userEvent.setup();
    renderPage(<TransitAnalysisPage />, { path: "/transit", route: "/transit?kepid=10666592&signal=19997" });
    await user.click(await screen.findByRole("button", { name: "Analyse transit" }));
    expect(await screen.findByText("Odd / even depths")).toBeInTheDocument();
    const body = api.find("POST", "/analysis/transit")[0]!.body as { ephemeris: Record<string, unknown>; signal_id: number };
    expect(body.ephemeris).toMatchObject({ period_days: 2.20474, epoch: 132.381, duration_hours: 3.86, source: "catalogue", label: "TCE-010666592-01" });
    expect(body.signal_id).toBe(19997);
    expect(screen.getByText("Consistent")).toBeInTheDocument();
    expect(screen.getByText("Detected at 56.3σ")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Catalogue, measured and estimated transit parameters" });
    expect(within(table).getByText("6,704")).toBeInTheDocument();
    expect(within(table).getByText("R⊕")).toBeInTheDocument(); // API unit R_earth shown typographically
    expect(screen.getByText("Planet radius", { selector: "div" })).toBeInTheDocument(); // derived estimate label
    expect(screen.getByRole("region", { name: "Data quality report" })).toBeInTheDocument();
  });

  it("uses the BLS ephemeris after a search", async () => {
    const api = mockApi(routes);
    const user = userEvent.setup();
    renderPage(<TransitAnalysisPage />, { path: "/transit", route: "/transit?kepid=10666592" });
    await user.click(await screen.findByRole("button", { name: "Run BLS search" }));
    await user.click(await screen.findByRole("button", { name: "Fit a transit with this ephemeris" }));
    await waitFor(() => expect(api.find("POST", "/analysis/transit")).toHaveLength(1));
    expect((api.find("POST", "/analysis/transit")[0]!.body as { ephemeris: { source: string; period_days: number } }).ephemeris).toMatchObject({ source: "measured", period_days: 2.204729639 });
  });

  it("validates a manual ephemeris before fitting", async () => {
    const api = mockApi(routes);
    const user = userEvent.setup();
    renderPage(<TransitAnalysisPage />, { path: "/transit", route: "/transit?kepid=10666592&eph=manual" });
    await user.click(await screen.findByRole("button", { name: "Analyse transit" }));
    expect(screen.getByText("Enter a period greater than 0 days.")).toBeInTheDocument();
    expect(api.find("POST", "/analysis/transit")).toHaveLength(0);
  });

  it("labels the injection–recovery test as synthetic", async () => {
    const api = mockApi(routes);
    const user = userEvent.setup();
    renderPage(<TransitAnalysisPage />, { path: "/transit", route: "/transit?kepid=10666592&signal=19997" });
    expect(await screen.findByText("Synthetic")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Inject and search" }));
    expect(await screen.findByText("Synthetic — not an observation")).toBeInTheDocument();
    expect(screen.getByText("Injected signal recovered")).toBeInTheDocument();
    expect(api.find("POST", "/analysis/injection")[0]!.body).toMatchObject({ kepid: 10666592, period_days: 5.3, depth_ppm: 500, duration_hours: 3 });
  });

  it("shows the server's error envelope when BLS fails", async () => {
    mockApi([
      ...routes.filter((r) => r.path !== "/analysis/bls"),
      { method: "POST", path: "/analysis/bls", status: 409, body: { detail: "Light curve not downloaded", code: "not_downloaded", hint: "Download it first." } },
    ]);
    const user = userEvent.setup();
    renderPage(<TransitAnalysisPage />, { path: "/transit", route: "/transit?kepid=10666592" });
    await user.click(await screen.findByRole("button", { name: "Run BLS search" }));
    expect(await screen.findByText("Light curve not downloaded")).toBeInTheDocument();
    expect(screen.getByText("Download it first.")).toBeInTheDocument();
  });
});
