import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobOut } from "@/api/types";
import { AppShell } from "./AppShell";
import { CommandPalette, matchScore } from "./CommandPalette";
import { JobTray } from "./JobTray";
import { breadcrumbsFor, isActive, NAV_GROUPS } from "./nav";

afterEach(() => vi.unstubAllGlobals());

describe("navigation model", () => {
  it("has the five sidebar groups in order", () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(["Observe", "Detect", "Data", "Models", "Reference"]);
    expect(NAV_GROUPS.flatMap((g) => g.items).map((i) => i.label)).toEqual([
      "Overview",
      "Signal Explorer",
      "Transit Analysis",
      "Planet Detection",
      "Candidate Explorer",
      "Prediction History",
      "Dataset Explorer",
      "Model Training",
      "Model Evaluation",
      "Experiments",
      "Research Docs",
      "Settings",
    ]);
  });
  it("derives breadcrumbs", () => {
    expect(breadcrumbsFor("/training")).toEqual([{ label: "Models" }, { label: "Model Training" }]);
    expect(breadcrumbsFor("/targets/10666592")).toEqual([{ label: "Targets", path: "/candidates" }, { label: "KIC 10666592" }]);
    expect(breadcrumbsFor("/design")).toEqual([{ label: "Reference" }, { label: "Design System" }]);
    expect(breadcrumbsFor("/nope")).toEqual([{ label: "Not found" }]);
  });
  it("matches the overview only at the root", () => {
    const overview = NAV_GROUPS[0]!.items[0]!;
    expect(isActive(overview, "/")).toBe(true);
    expect(isActive(overview, "/signals")).toBe(false);
  });
});

describe("command palette", () => {
  it("ranks label prefixes above keyword matches", () => {
    expect(matchScore({ label: "Model Training" }, "mod")).toBeGreaterThan(matchScore({ label: "Experiments", keywords: ["model"] }, "mod"));
    expect(matchScore({ label: "Signal Explorer" }, "zzz")).toBe(0);
  });

  it("filters pages and navigates with the keyboard", async () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} onNavigate={onNavigate} />);
    const input = screen.getByRole("combobox", { name: "Search pages and targets" });
    await userEvent.type(input, "evaluat");
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Model Evaluation");
    await userEvent.keyboard("{Enter}");
    expect(onClose).toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith("/evaluation");
  });

  it("calls the onSearch hook for target results", async () => {
    const onSearch = vi.fn(async () => [{ id: "t:1", label: "Kepler-90", group: "Targets", hint: "KIC 11442793", path: "/targets/11442793" }]);
    const onNavigate = vi.fn();
    render(<CommandPalette open onClose={() => undefined} onNavigate={onNavigate} onSearch={onSearch} />);
    await userEvent.type(screen.getByRole("combobox"), "Kepler-90");
    const option = await screen.findByRole("option", { name: /Kepler-90/ });
    expect(onSearch).toHaveBeenCalledWith("Kepler-90", expect.any(AbortSignal));
    await userEvent.click(option);
    expect(onNavigate).toHaveBeenCalledWith("/targets/11442793");
  });
});

describe("JobTray", () => {
  const jobs: JobOut[] = [
    { id: "1", kind: "train", title: "Train CNN", status: "running", progress: 0.5, created_at: new Date().toISOString(), eta_s: 65 },
    { id: "2", kind: "download", title: "Download", status: "failed", progress: 0.1, error: "HTTP 503", created_at: new Date().toISOString() },
  ];
  it("shows the active count and lists jobs with cancel", async () => {
    const onCancel = vi.fn();
    render(<JobTray jobs={jobs} onCancel={onCancel} />);
    const trigger = screen.getByRole("button", { name: "Background jobs: 1 active" });
    await userEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Background jobs" })).toBeInTheDocument();
    expect(screen.getByText("HTTP 503")).toBeInTheDocument();
    expect(screen.getByText("about 1 min 05 s left")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel Train CNN" }));
    expect(onCancel).toHaveBeenCalledWith("1");
  });
  it("shows an empty state", async () => {
    render(<JobTray jobs={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Background jobs" }));
    expect(screen.getByText("No background jobs")).toBeInTheDocument();
  });
});

describe("AppShell", () => {
  it("renders sidebar, breadcrumbs and the routed page, and opens the palette with Ctrl+K", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
    const router = createMemoryRouter(
      [{ element: <AppShell />, children: [{ path: "/training", element: <h1>Training page</h1> }] }],
      { initialEntries: ["/training"], future: { v7_relativeSplatPath: true } },
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} future={{ v7_startTransition: true }} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Training page" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Model Training" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Model Training");
    expect(await screen.findByText("offline")).toBeInTheDocument(); // API status row
    await userEvent.keyboard("{Control>}k{/Control}");
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
  });

  it("keeps the natural tab order on first load and moves focus to <main> only on navigation", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
    const router = createMemoryRouter(
      [
        {
          element: <AppShell />,
          children: [
            { path: "/training", element: <h1>Training page</h1> },
            { path: "/evaluation", element: <h1>Evaluation page</h1> },
          ],
        },
      ],
      { initialEntries: ["/training"], future: { v7_relativeSplatPath: true } },
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} future={{ v7_startTransition: true }} />
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "Training page" });
    // Initial load: focus is left alone, so Tab reaches the skip link and the sidebar first.
    expect(document.activeElement).toBe(document.body);
    await userEvent.tab();
    expect(document.activeElement).toHaveTextContent("Skip to content");

    // Client-side navigation: focus moves to the main region for screen-reader users.
    await userEvent.click(screen.getByRole("link", { name: "Model Evaluation" }));
    await screen.findByRole("heading", { name: "Evaluation page" });
    expect(document.activeElement).toBe(document.getElementById("main"));
  });
});
