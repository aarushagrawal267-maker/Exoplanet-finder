import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { fxJob } from "@/pages/_ops/testFixtures";
import { JobTray } from "./JobTray";

describe("JobTray (live feed behaviour)", () => {
  it("links each job to its page and shows progress with ETA", async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <JobTray jobs={[fxJob({ eta_s: 65 })]} connection="live" />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Background jobs: 1 active" }));
    const panel = screen.getByRole("dialog", { name: "Background jobs" });
    expect(within(panel).getByRole("link", { name: /Build dataset 'Fixture Pilot'/ })).toHaveAttribute("href", "/datasets?id=7");
    expect(within(panel).getByText("about 1 min 05 s left")).toBeInTheDocument();
    expect(within(panel).getByText("Live updates")).toBeInTheDocument();
  });

  it("raises a notification with the error text when a job fails", async () => {
    const { rerender } = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <JobTray jobs={[fxJob({ id: "j" })]} />
      </MemoryRouter>,
    );
    rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <JobTray jobs={[fxJob({ id: "j", status: "failed", error: "RuntimeError: dataset 7 is not available" })]} />
      </MemoryRouter>,
    );
    const region = await screen.findByRole("list", { name: "Job notifications" });
    expect(within(region).getByRole("alert")).toHaveTextContent("Failed");
    expect(within(region).getByText("RuntimeError: dataset 7 is not available")).toBeInTheDocument();
    expect(within(region).getByRole("link", { name: /Open/ })).toHaveAttribute("href", "/datasets?id=7");
    await userEvent.click(within(region).getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByRole("list", { name: "Job notifications" })).not.toBeInTheDocument();
  });

  it("auto-dismisses success notifications and ignores jobs that were already finished", () => {
    vi.useFakeTimers();
    try {
      const done = fxJob({ id: "old", status: "succeeded", progress: 1 });
      const { rerender } = render(<JobTray jobs={[done, fxJob({ id: "new" })]} />);
      rerender(<JobTray jobs={[done, fxJob({ id: "new", status: "succeeded", progress: 1 })]} />);
      const region = screen.getByRole("list", { name: "Job notifications" });
      expect(within(region).getAllByRole("listitem")).toHaveLength(1);
      expect(region).toHaveTextContent("Finished");
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.queryByRole("list", { name: "Job notifications" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a rejected cancel inline", async () => {
    const onCancel = vi.fn(() => Promise.reject(new ApiError(409, "This job is not running in the API server process", { code: "job_not_in_this_process", hint: "Use Ctrl+C in that terminal." })));
    render(<JobTray jobs={[fxJob({ title: "CLI build" })]} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: /Background jobs/ }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel CLI build" }));
    expect(await screen.findByText("This job is not running in the API server process")).toBeInTheDocument();
    expect(screen.getByText("Use Ctrl+C in that terminal.")).toBeInTheDocument();
  });
});
