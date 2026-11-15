import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { baseRoutes, mockApi, renderPage, type MockRoute } from "@/test/api";
import { modelFixture, modelLR, predictResponse, settingsOut, targetDetail, uploadCsv, uploadCsvParsed } from "@/test/fixtures";
import PlanetDetectionPage from "./index";

vi.mock("@/components/charts/Plot", () => ({ Plot: ({ ariaLabel }: { ariaLabel: string }) => <figure aria-label={ariaLabel} data-testid="plot" /> }));
afterEach(() => vi.unstubAllGlobals());

const common: MockRoute[] = [
  ...baseRoutes,
  { path: "/settings", body: settingsOut },
  { path: "/targets/11442793", body: targetDetail() },
];

describe("Planet Detection", () => {
  it("scores a catalogue signal with the default model and shows one verdict per model", async () => {
    const api = mockApi([...common, { path: "/models", body: [modelLR, modelFixture] }, { method: "POST", path: "/predictions", body: predictResponse() }]);
    const user = userEvent.setup();
    renderPage(<PlanetDetectionPage />, { path: "/detect", route: "/detect?kepid=11442793&signal=41" });
    const picker = await screen.findByRole("group", { name: "Models to run" });
    expect(within(picker).getByRole("checkbox", { name: /Logistic regression/ })).toBeChecked();
    expect(within(picker).queryByText("Fixture CNN")).toBeNull(); // fixtures hidden unless asked for
    await user.click(screen.getByRole("button", { name: /Score signal/ }));

    expect(await screen.findAllByTestId("prediction-verdict")).toHaveLength(2);
    expect(api.find("POST", "/predictions")[0]!.body).toEqual({
      model_version_ids: [1],
      source: { type: "catalog", kepid: 11442793, signal_id: 41 },
      ephemeris_source: "catalog",
      ephemeris: null,
      download_if_missing: true,
    });
    // Every verdict carries the research-lead note; fixture and training-split warnings are explicit.
    expect(screen.getAllByTestId("research-lead-note")).toHaveLength(2);
    expect(screen.getByText("Fixture model")).toBeInTheDocument();
    expect(screen.getByText("Seen during training")).toBeInTheDocument();
    expect(screen.getAllByText("star not in the model's dataset").length).toBeGreaterThan(0);
    // Context: model input views, quality grade, NASA labels side by side, warnings.
    expect(screen.getByRole("region", { name: "Data quality report" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "NASA catalogue labels" })).toBeInTheDocument();
    expect(screen.getByText(/reserved showcase system/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Stored as prediction #7/ })).toHaveAttribute("href", "/predictions?id=7");
  });

  it("explains that a model must be trained first when there is none", async () => {
    mockApi([...common, { path: "/models", body: [] }]);
    renderPage(<PlanetDetectionPage />, { path: "/detect", route: "/detect?kepid=11442793&signal=41" });
    expect(await screen.findByText("No trained model yet")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open Model Training" })[0]).toHaveAttribute("href", "/training");
    expect(screen.getByRole("button", { name: /Score signal/ })).toBeDisabled();
  });

  it("turns a 409 no_model answer into the training call to action", async () => {
    mockApi([
      ...common,
      { path: "/models", body: [modelLR] },
      { method: "POST", path: "/predictions", status: 409, body: { detail: "No trained model is available", code: "no_model", hint: "Train a model first (Training page)." } },
    ]);
    const user = userEvent.setup();
    renderPage(<PlanetDetectionPage />, { path: "/detect", route: "/detect?kepid=11442793&signal=41" });
    await user.click(await screen.findByRole("button", { name: /Score signal/ }));
    expect(await screen.findByText("No trained model yet")).toBeInTheDocument();
  });

  it("shows why a signal cannot be scored (400 unscorable_signal)", async () => {
    mockApi([
      ...common,
      { path: "/models", body: [modelLR] },
      { method: "POST", path: "/predictions", status: 400, body: { detail: "The local view has empty bins", code: "unscorable_signal", hint: "Check the ephemeris in Transit Analysis." } },
    ]);
    const user = userEvent.setup();
    renderPage(<PlanetDetectionPage />, { path: "/detect", route: "/detect?kepid=11442793&signal=41" });
    await user.click(await screen.findByRole("button", { name: /Score signal/ }));
    expect(await screen.findByText("This signal cannot be scored")).toBeInTheDocument();
    expect(screen.getByText("The local view has empty bins")).toBeInTheDocument();
    expect(screen.getByText("Check the ephemeris in Transit Analysis.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inspect in Transit Analysis" })).toHaveAttribute("href", expect.stringContaining("/transit?"));
  });

  it("sends a manual ephemeris and BLS choice as the API expects", async () => {
    const api = mockApi([...common, { path: "/models", body: [modelLR] }, { method: "POST", path: "/predictions", body: predictResponse({ results: [predictResponse().results[0]!] }) }]);
    const user = userEvent.setup();
    renderPage(<PlanetDetectionPage />, { path: "/detect", route: "/detect?kepid=11442793&eph=manual&p=7.0082&t0=137.6716&dur=3.81" });
    await user.click(await screen.findByRole("button", { name: /Score signal/ }));
    await waitFor(() => expect(api.find("POST", "/predictions")).toHaveLength(1));
    expect(api.find("POST", "/predictions")[0]!.body).toMatchObject({
      source: { type: "catalog", kepid: 11442793, signal_id: null },
      ephemeris_source: "manual",
      ephemeris: { period_days: 7.0082, epoch: 137.6716, duration_hours: 3.81 },
    });
  });

  it("walks through an upload: file → column mapping → time system → parse → score", async () => {
    let parsed = false;
    const api = mockApi([
      ...baseRoutes,
      { path: "/settings", body: settingsOut },
      { path: "/models", body: [modelLR] },
      { method: "POST", path: "/uploads", body: uploadCsv },
      { path: `/uploads/${uploadCsv.upload_id}`, handle: () => ({ body: parsed ? uploadCsvParsed : uploadCsv }) },
      {
        method: "POST",
        path: `/uploads/${uploadCsv.upload_id}/parse`,
        handle: () => {
          parsed = true;
          return { body: { ...uploadCsvParsed.parsed, upload_id: uploadCsv.upload_id } };
        },
      },
      { method: "POST", path: "/predictions", body: predictResponse({ results: [predictResponse().results[0]!], catalog_labels: null, signal: null }) },
    ]);
    const user = userEvent.setup();
    const { router } = renderPage(<PlanetDetectionPage />, { path: "/detect", route: "/detect?src=upload" });
    const file = new File(["time,flux\n130,1.0\n"], "synthetic_lc.csv", { type: "text/csv" });
    await user.upload(await screen.findByLabelText("Light-curve file"), file);
    await waitFor(() => expect(router.state.location.search).toContain(`upload=${uploadCsv.upload_id}`));
    expect(api.find("POST", "/uploads")[0]!.body).toBeInstanceOf(FormData);

    // Suggested mapping is preselected; the time system defaults to the suggestion.
    expect(await screen.findByLabelText(/Time column/)).toHaveValue("time");
    expect(screen.getByLabelText(/Flux column/)).toHaveValue("flux");
    expect(screen.getByLabelText("Time system")).toHaveValue("BKJD");
    await user.selectOptions(screen.getByLabelText("Time system"), "BJD");
    await user.click(screen.getByRole("button", { name: "Parse light curve" }));
    expect(api.find("POST", `/uploads/${uploadCsv.upload_id}/parse`)[0]!.body).toEqual({
      mapping: { time: "time", flux: "flux", flux_err: "flux_err", quality: "quality" },
      time_system: "BJD",
    });
    expect(await screen.findByText("Out of distribution for the models")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Score light curve/ }));
    await waitFor(() => expect(api.find("POST", "/predictions")).toHaveLength(1));
    expect(api.find("POST", "/predictions")[0]!.body).toMatchObject({ source: { type: "upload", upload_id: uploadCsv.upload_id }, ephemeris_source: "bls" });
    expect(await screen.findByText(/Not a catalogue signal/)).toBeInTheDocument();
  });
});
