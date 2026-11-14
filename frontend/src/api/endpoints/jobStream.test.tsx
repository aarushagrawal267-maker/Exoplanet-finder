import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fxJob } from "@/pages/_ops/testFixtures";
import { mockApi } from "@/pages/_ops/testUtils";
import type { JobOut } from "../schemas";
import { jobHref, mergeJob, orderJobs, parseApiTime, useJobFeed } from "./jobStream";

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** Minimal EventSource stand-in that tests drive by hand. */
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = 0;
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Array<(ev: MessageEvent) => void>>();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, fn: (ev: MessageEvent) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  emit(name: string, data: unknown) {
    for (const fn of this.listeners.get(name) ?? []) fn(new MessageEvent(name, { data: JSON.stringify(data) }));
  }
  close() {
    this.readyState = 2;
  }
}

describe("job feed helpers", () => {
  it("never lets an older active state overwrite a final one, and progress never goes back", () => {
    const done = fxJob({ status: "succeeded", progress: 1 });
    expect(mergeJob(done, fxJob({ status: "running", progress: 0.5 }))).toBe(done);
    expect(mergeJob(fxJob({ progress: 0.6 }), fxJob({ progress: 0.5 })).progress).toBe(0.6);
    expect(mergeJob(fxJob(), done).status).toBe("succeeded");
  });

  it("orders running → queued → finished (newest first) and caps finished jobs", () => {
    const jobs: JobOut[] = [
      fxJob({ id: "f1", status: "succeeded", finished_at: "2026-11-14T10:00:00" }),
      fxJob({ id: "q", status: "queued" }),
      fxJob({ id: "f2", status: "failed", finished_at: "2026-11-14T11:00:00" }),
      fxJob({ id: "r", status: "running" }),
    ];
    expect(orderJobs(jobs, 1).map((j) => j.id)).toEqual(["r", "q", "f2"]);
  });

  it("maps jobs to the page that shows them", () => {
    expect(jobHref(fxJob())).toBe("/datasets?id=7");
    expect(jobHref(fxJob({ id: "abc", kind: "train_suite" }))).toBe("/training?job=abc");
    expect(jobHref(fxJob({ kind: "evaluate", params: { model_version_id: 3 }, result: { evaluation_id: 9 } }))).toBe("/evaluation?eval=9");
    expect(jobHref(fxJob({ kind: "download", params: { kepid: 11442793 } }))).toBe("/targets/11442793");
    expect(jobHref(fxJob({ kind: "unknown" }))).toBeNull();
    expect(parseApiTime("2026-11-14T00:00:00")).toBe(Date.UTC(2026, 10, 14));
  });
});

describe("useJobFeed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeEventSource.instances = [];
  });

  it("polls active jobs, detects completion and invalidates the affected pages", async () => {
    let active: JobOut[] = [fxJob({ id: "b" })];
    mockApi([
      { path: "/jobs", query: (q) => q.get("status") === "queued,running", body: () => active },
      { path: "/jobs", body: [fxJob({ id: "a", status: "succeeded", progress: 1, finished_at: "2026-11-14T19:00:00" })] },
      { path: "/jobs/b", body: fxJob({ id: "b", status: "succeeded", progress: 1, finished_at: "2026-11-14T21:00:00", result: { dataset_id: 7 } }) },
    ]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useJobFeed(), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.jobs.map((j) => j.id)).toEqual(["b", "a"]));
    expect(result.current.connection).toBe("offline"); // no EventSource in jsdom → polling

    active = [];
    await act(() => qc.refetchQueries({ queryKey: ["job-feed", "active"] }));
    await waitFor(() => expect(result.current.jobs.find((j) => j.id === "b")?.status).toBe("succeeded"));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["datasets"] }));
  });

  it("follows the SSE stream: snapshot, progress for a new job, done", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    mockApi([
      { path: "/jobs", query: (q) => q.get("status") === "queued,running", body: [] },
      { path: "/jobs", body: [] },
      { path: "/jobs/n", body: fxJob({ id: "n", kind: "train", title: "Train two-view CNN", status: "running", progress: 0.1 }) },
    ]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useJobFeed(), { wrapper: wrapper(qc) });
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    const es = FakeEventSource.instances[0] as FakeEventSource;
    expect(es.url).toBe("/api/jobs/stream");
    act(() => {
      es.open();
      es.emit("snapshot", { jobs: [fxJob({ id: "s", title: "Snapshot job" })] });
    });
    await waitFor(() => expect(result.current.connection).toBe("live"));
    expect(result.current.jobs.map((j) => j.id)).toEqual(["s"]);

    act(() => es.emit("progress", { job_id: "n", progress: 0.2, status: "running", message: "epoch 1/3" }));
    await waitFor(() => expect(result.current.jobs.find((j) => j.id === "n")?.title).toBe("Train two-view CNN"));

    act(() => es.emit("done", { job_id: "s", status: "failed", error: "RuntimeError: boom" }));
    await waitFor(() => expect(result.current.jobs.find((j) => j.id === "s")?.status).toBe("failed"));
    expect(result.current.jobs.find((j) => j.id === "s")?.error).toBe("RuntimeError: boom");
  });

  it("surfaces cancel failures (e.g. jobs run by the command-line tool)", async () => {
    mockApi([
      { path: "/jobs", body: [] },
      {
        method: "POST",
        path: "/jobs/cli/cancel",
        status: 409,
        body: { detail: "This job is not running in the API server process", code: "job_not_in_this_process", hint: "Use Ctrl+C in that terminal." },
      },
    ]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useJobFeed(), { wrapper: wrapper(qc) });
    await expect(result.current.cancel("cli")).rejects.toMatchObject({ code: "job_not_in_this_process" });
  });
});
