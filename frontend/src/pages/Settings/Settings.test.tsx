import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { baseRoutes, mockApi, renderPage, type MockRoute } from "@/test/api";
import { diagnosticsOut, modelLR, settingsOut, storageOut } from "@/test/fixtures";
import SettingsPage, { validateSetting } from "./index";

afterEach(() => vi.unstubAllGlobals());

const routes: MockRoute[] = [
  ...baseRoutes,
  { path: "/settings", body: settingsOut },
  { path: "/models", body: [modelLR] },
  { path: "/settings/storage", body: storageOut },
  { path: "/system/diagnostics", handle: ({ url }) => ({ body: diagnosticsOut(url.searchParams.get("check_network") ? [{ name: "NASA Exoplanet Archive", url: "https://exoplanetarchive.ipac.caltech.edu", ok: true, status_code: 200, elapsed_ms: 412, error: null }] : null) }) },
];

describe("validateSetting", () => {
  it("checks integer ranges and choices", () => {
    const d = settingsOut.descriptions.download_workers!;
    expect(validateSetting(d, 4)).toBeNull();
    expect(validateSetting(d, 40)).toBe("Must be at most 16.");
    expect(validateSetting(d, null)).toBe("Enter a whole number.");
    expect(validateSetting(settingsOut.descriptions.device!, "tpu")).toBe("Choose one of the options.");
  });
});

describe("Settings", () => {
  it("saves only the changed values", async () => {
    const api = mockApi([...routes, { method: "PUT", path: "/settings", handle: ({ body }) => ({ body: { ...settingsOut, values: { ...settingsOut.values, ...(body as object) } } }) }]);
    const user = userEvent.setup();
    renderPage(<SettingsPage />, { path: "/settings", route: "/settings" });
    const device = await screen.findByLabelText("Compute device");
    await user.selectOptions(device, "cpu");
    await user.selectOptions(screen.getByLabelText("Default model for predictions"), "1");
    expect(screen.getByText("2 unsaved changes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.find("PUT", "/settings")).toHaveLength(1));
    expect(api.find("PUT", "/settings")[0]!.body).toEqual({ device: "cpu", default_model_id: 1 });
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("validates before saving and shows the server's message on the field", async () => {
    const api = mockApi([
      ...routes,
      { method: "PUT", path: "/settings", status: 400, body: { detail: "device: 'cuda' is not available on this machine", code: "invalid_setting", hint: null } },
    ]);
    const user = userEvent.setup();
    renderPage(<SettingsPage />, { path: "/settings", route: "/settings" });
    const workers = await screen.findByLabelText("Parallel downloads");
    await user.clear(workers);
    await user.type(workers, "40");
    await user.tab();
    expect(screen.getByText("Must be at most 16.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await user.clear(workers);
    await user.type(workers, "4");
    await user.selectOptions(screen.getByLabelText("Compute device"), "cuda");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("device: 'cuda' is not available on this machine")).toBeInTheDocument();
    expect(screen.getByText("Settings were not saved")).toBeInTheDocument();
    expect(api.find("PUT", "/settings")).toHaveLength(1);
  });

  it("clears a storage category only after confirmation", async () => {
    const api = mockApi([...routes, { method: "POST", path: "/settings/storage/clear", body: { target: "raw_fits", bytes_freed: 31455360, files_removed: 72, path: "/data/raw/kepler" } }]);
    const user = userEvent.setup();
    renderPage(<SettingsPage />, { path: "/settings", route: "/settings" });
    await user.click(await screen.findByRole("button", { name: "Clear Raw FITS downloads" }));
    const dialog = screen.getByRole("dialog", { name: "Clear raw fits downloads?" });
    expect(within(dialog).getByText(/This cannot be undone/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(api.find("POST", "/settings/storage/clear")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Clear Raw FITS downloads" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete files" }));
    expect(await screen.findByText(/removed 72 files, freed 31\.5 MB/)).toBeInTheDocument();
    expect(api.find("POST", "/settings/storage/clear")[0]!.body).toEqual({ target: "raw_fits" });
    // An empty category cannot be cleared.
    expect(screen.getByRole("button", { name: "Clear Uploads" })).toBeDisabled();
  });

  it("explains a clear refused while a job runs (409 job_running)", async () => {
    mockApi([...routes, { method: "POST", path: "/settings/storage/clear", status: 409, body: { detail: "A download job is running", code: "job_running", hint: "Try again when it has finished." } }]);
    const user = userEvent.setup();
    renderPage(<SettingsPage />, { path: "/settings", route: "/settings" });
    await user.click(await screen.findByRole("button", { name: "Clear Raw FITS downloads" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete files" }));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByText("A running job is using these files")).toBeInTheDocument();
    expect(within(dialog).getByText("Try again when it has finished.")).toBeInTheDocument();
  });

  it("offers the backup download and an on-demand network check", async () => {
    const api = mockApi(routes);
    const user = userEvent.setup();
    renderPage(<SettingsPage />, { path: "/settings", route: "/settings" });
    expect(await screen.findByRole("link", { name: /Download backup/ })).toHaveAttribute("href", "/api/settings/backup");
    expect(await screen.findByText("sqlite:////data/app.db", { exact: false })).toBeInTheDocument();
    expect(api.find("GET", "/system/diagnostics").every((c) => !c.url.searchParams.get("check_network"))).toBe(true);
    await user.click(screen.getByRole("button", { name: "Check connection to NASA" }));
    expect(await screen.findByText("reachable")).toBeInTheDocument();
    expect(api.find("GET", "/system/diagnostics").some((c) => c.url.searchParams.get("check_network") === "true")).toBe(true);
  });
});
