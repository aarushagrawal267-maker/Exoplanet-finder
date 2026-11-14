import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { baseRoutes, mockApi, renderPage } from "@/test/api";
import { modelLR, predictionDetail, predictionPage } from "@/test/fixtures";
import PredictionHistoryPage from "./index";

vi.mock("@/components/charts/Plot", () => ({ Plot: ({ ariaLabel }: { ariaLabel: string }) => <figure aria-label={ariaLabel} data-testid="plot" /> }));
afterEach(() => vi.unstubAllGlobals());

const routes = [...baseRoutes, { path: "/models", body: [modelLR] }, { path: "/predictions", body: predictionPage }, { path: "/predictions/7", body: predictionDetail }];

describe("Prediction History", () => {
  it("lists stored predictions with verdict, grade and split", async () => {
    mockApi(routes);
    renderPage(<PredictionHistoryPage />, { path: "/predictions", route: "/predictions" });
    const table = await screen.findByRole("table", { name: "Stored predictions" });
    expect(await within(table).findByText("Kepler-90 b")).toBeInTheDocument();
    expect(within(table).getByText("my_star.csv")).toBeInTheDocument();
    expect(within(table).getByText("0.874")).toBeInTheDocument();
    expect(within(table).getByText("Planet-like")).toBeInTheDocument();
    expect(within(table).getAllByText("unseen")).toHaveLength(2);
  });

  it("filters by input type on the server", async () => {
    const api = mockApi(routes);
    const user = userEvent.setup();
    renderPage(<PredictionHistoryPage />, { path: "/predictions", route: "/predictions" });
    await screen.findByText("my_star.csv");
    await user.selectOptions(screen.getByLabelText("Input"), "csv");
    await waitFor(() => expect(api.find("GET", "/predictions").at(-1)!.url.searchParams.get("source_type")).toBe("csv"));
  });

  it("opens the stored prediction with its views, quality and warnings", async () => {
    const api = mockApi(routes);
    const user = userEvent.setup();
    renderPage(<PredictionHistoryPage />, { path: "/predictions", route: "/predictions" });
    await user.click(await screen.findByText("Kepler-90 b"));
    const dialog = await screen.findByRole("dialog", { name: "Prediction #7" });
    expect(await within(dialog).findByText("Stored warning: reserved showcase star.")).toBeInTheDocument();
    expect(within(dialog).getByTestId("research-lead-note")).toBeInTheDocument();
    expect(within(dialog).getByRole("region", { name: "Data quality report" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Model input views/)).toBeInTheDocument();
    expect(api.find("GET", "/predictions/7")).toHaveLength(1);
  });

  it("explains how to make a first prediction", async () => {
    mockApi([...baseRoutes, { path: "/models", body: [] }, { path: "/predictions", body: { total: 0, limit: 50, offset: 0, items: [] } }]);
    renderPage(<PredictionHistoryPage />, { path: "/predictions", route: "/predictions" });
    expect(await screen.findByText("No predictions yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Planet Detection/ })).toHaveAttribute("href", "/detect");
  });
});
