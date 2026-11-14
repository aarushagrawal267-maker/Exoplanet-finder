import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "@/test/api";
import { searchResults, systemSummary } from "@/test/fixtures";
import { AppShell } from "./AppShell";
import { searchTargetCommands, targetToCommand } from "./targetSearch";
import { deviceText, predictionModel } from "./useSystemStatus";

afterEach(() => vi.unstubAllGlobals());

describe("system status from /api/system/summary", () => {
  it("reads the device and the model used for predictions from the real summary shape", () => {
    const s = systemSummary();
    expect(deviceText(s.device)).toBe("CPU");
    expect(deviceText({ ...s.device, device: "cuda", cuda_device: "RTX 4070" })).toBe("CUDA · RTX 4070");
    expect(predictionModel(s)?.name).toBe("Pilot DR24 v1 - Logistic regression");
    expect(predictionModel(systemSummary({ models: { count: 0, n_real: 0, active: null, default_model_id: null, default_for_predictions: null } }))).toBeNull();
  });

  it("shows API, device, model and dataset in the sidebar footer", async () => {
    mockApi([
      { path: "/health", body: { status: "ok", version: "1.0.0", pipeline_version: "1.0" } },
      { path: "/system/summary", body: systemSummary() },
    ]);
    const router = createMemoryRouter([{ element: <AppShell />, children: [{ path: "/", element: <h1>Home</h1> }] }], { initialEntries: ["/"], future: { v7_relativeSplatPath: true } });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} future={{ v7_startTransition: true }} />
      </QueryClientProvider>,
    );
    expect(await screen.findByLabelText("System status")).toBeInTheDocument();
    expect(await screen.findByText("online · v1.0.0")).toBeInTheDocument();
    expect(await screen.findByText("CPU")).toBeInTheDocument();
    expect(screen.getByText("Pilot DR24 v1 - Logistic regression")).toBeInTheDocument();
    expect(screen.getByText("Pilot DR24 v1")).toBeInTheDocument();
  });
});

describe("command palette target search", () => {
  it("maps search results to commands that open the Target Dossier (with the matched signal)", () => {
    expect(targetToCommand(searchResults[0]!)).toMatchObject({ label: "Kepler-90 (KIC 11442793)", group: "Targets", hint: "KIC 11442793", path: "/targets/11442793" });
    const planet = targetToCommand(searchResults[1]!);
    expect(planet).toMatchObject({ label: "Kepler-90 b", path: "/targets/11442793?signal=41" });
    expect(planet.description).toContain("8 signals");
    expect(planet.description).toContain("light curve cached");
  });

  it("queries /api/targets/search and navigates on Enter", async () => {
    const api = mockApi([
      { path: "/health", status: 502, body: { detail: "down", code: "backend_unreachable" } },
      { path: "/targets/search", body: searchResults },
    ]);
    const router = createMemoryRouter(
      [{ element: <AppShell onSearch={searchTargetCommands} />, children: [{ path: "/", element: <h1>Home</h1> }, { path: "/targets/:kepid", element: <h1>Dossier</h1> }] }],
      { initialEntries: ["/"], future: { v7_relativeSplatPath: true } },
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} future={{ v7_startTransition: true }} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.keyboard("{Control>}k{/Control}");
    await user.type(screen.getByRole("combobox", { name: "Search pages and targets" }), "Kepler-90");
    expect(await screen.findByRole("option", { name: /Kepler-90 b/ })).toBeInTheDocument();
    expect(api.find("GET", "/targets/search")[0]!.url.searchParams.get("q")).toBe("Kepler-90");
    // Pages that do not match are filtered out, so the first option is the first target.
    await user.keyboard("{Enter}");
    expect(router.state.location.pathname).toBe("/targets/11442793");
  });
});
