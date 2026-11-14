import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { baseRoutes, mockApi, renderPage } from "@/test/api";
import { catalogStats, kepler2Detail, lightCurve, signalPage } from "@/test/fixtures";
import SignalExplorerPage from "./index";

vi.mock("@/components/charts/Plot", () => ({ Plot: ({ ariaLabel }: { ariaLabel: string }) => <figure aria-label={ariaLabel} data-testid="plot" /> }));
afterEach(() => vi.unstubAllGlobals());

const routes = [
  ...baseRoutes,
  { path: "/catalog/signals", body: signalPage },
  { path: "/catalog/stats", body: catalogStats },
  { path: "/targets/10666592", body: kepler2Detail },
  { path: "/lightcurves/10666592", body: lightCurve({ kepid: 10666592, signal_id: 19997 }) },
];

describe("Signal Explorer", () => {
  it("loads the first server page and shows NASA labels per signal", async () => {
    const api = mockApi(routes);
    renderPage(<SignalExplorerPage />, { path: "/signals", route: "/signals" });
    const table = await screen.findByRole("table", { name: "Catalogue signals" });
    expect(await within(table).findByText("TCE-010666592-01")).toBeInTheDocument();
    expect(within(table).getByText("Kepler-2 b")).toBeInTheDocument();
    expect(within(table).getByText("6,704 ppm")).toBeInTheDocument();
    expect(within(table).getAllByText("Label conflict").length).toBe(1); // sr-only marker on the conflicting signal
    expect(screen.getByText("1–50 of 22,644 signals")).toBeInTheDocument();
    const q = api.find("GET", "/catalog/signals")[0]!.url.searchParams;
    expect(q.get("limit")).toBe("50");
    expect(q.get("sort")).toBe("signal_key");
    expect(q.get("order")).toBe("asc");
  });

  it("filters by category on the server and resets to the first page", async () => {
    const api = mockApi(routes);
    const user = userEvent.setup();
    renderPage(<SignalExplorerPage />, { path: "/signals", route: "/signals?offset=50" });
    await screen.findByText("TCE-010666592-01");
    await user.click(screen.getByRole("button", { name: /Filters/ }));
    await user.click(within(screen.getByRole("group", { name: "Catalogue category" })).getByRole("button", { name: "Candidate" }));
    await waitFor(() => {
      const last = api.find("GET", "/catalog/signals").at(-1)!.url.searchParams;
      expect(last.get("category")).toBe("candidate");
      expect(last.get("offset")).toBe("0");
    });
    await user.click(within(screen.getByRole("group", { name: "KOI disposition" })).getByRole("button", { name: "Not a KOI" }));
    await waitFor(() => expect(api.find("GET", "/catalog/signals").at(-1)!.url.searchParams.get("koi_disposition")).toBe("none"));
  });

  it("sorts on the server when a column header is clicked (numeric columns descending first)", async () => {
    const api = mockApi(routes);
    const user = userEvent.setup();
    renderPage(<SignalExplorerPage />, { path: "/signals", route: "/signals" });
    await screen.findByText("TCE-010666592-01");
    const header = screen.getByRole("columnheader", { name: /Period/ });
    await user.click(within(header).getByRole("button"));
    await waitFor(() => {
      const q = api.find("GET", "/catalog/signals").at(-1)!.url.searchParams;
      expect(q.get("sort")).toBe("period_days");
      expect(q.get("order")).toBe("desc");
    });
  });

  it("opens a detail panel with catalogue values, the light curve and links that preselect the signal", async () => {
    const api = mockApi(routes);
    const user = userEvent.setup();
    renderPage(<SignalExplorerPage />, { path: "/signals", route: "/signals" });
    await user.click(await screen.findByText("TCE-010666592-01"));
    const dialog = await screen.findByRole("dialog", { name: "Kepler-2 b" });
    expect(await within(dialog).findByText("2.2047 d")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /Transit analysis/ })).toHaveAttribute("href", "/transit?kepid=10666592&signal=19997");
    expect(within(dialog).getByRole("link", { name: /Planet detection/ })).toHaveAttribute("href", "/detect?kepid=10666592&signal=19997");
    expect(within(dialog).getByRole("link", { name: /Target dossier/ })).toHaveAttribute("href", "/targets/10666592?signal=19997");
    expect(await within(dialog).findByTestId("lightcurve-viewer")).toBeInTheDocument();
    const lc = api.find("GET", "/lightcurves/10666592")[0]!.url.searchParams;
    expect(lc.get("signal_id")).toBe("19997");
    expect(lc.get("max_points")).toBe("10000");
    expect(within(dialog).getAllByTestId("plot").length).toBeGreaterThanOrEqual(2); // light curve + fold
  });

  it("offers a download when the star has no cached light curve", async () => {
    mockApi([
      ...baseRoutes,
      { path: "/catalog/signals", body: signalPage },
      { path: "/targets/10666592", body: { ...kepler2Detail, target: { ...kepler2Detail.target, lc_status: "none" } } },
      { path: "/lightcurves/10666592", status: 404, body: { detail: "Light curve not downloaded", code: "not_downloaded", hint: "POST /api/targets/10666592/download" } },
    ]);
    const user = userEvent.setup();
    renderPage(<SignalExplorerPage />, { path: "/signals", route: "/signals?signal=19997&kepid=10666592" });
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Light curve not downloaded yet")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Download light curve" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows category statistics", async () => {
    mockApi(routes);
    renderPage(<SignalExplorerPage />, { path: "/signals", route: "/signals?tab=stats" });
    expect(await screen.findByText("14,114")).toBeInTheDocument();
    expect(screen.getByText(/Values are catalogue values/)).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Histogram scale" })).toBeInTheDocument();
  });
});
