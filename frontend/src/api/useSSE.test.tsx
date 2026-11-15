import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSSE } from "./useSSE";

/** Minimal controllable EventSource double. */
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readonly url: string;
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Array<(ev: MessageEvent) => void>>();
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, fn: (ev: MessageEvent) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
  // helpers
  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }
  emit(name: string, data: unknown) {
    const ev = new MessageEvent(name, { data: JSON.stringify(data) });
    if (name === "message") this.onmessage?.(ev);
    else this.listeners.get(name)?.forEach((fn) => fn(ev));
  }
  fail() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useSSE", () => {
  it("connects under the API base, decodes JSON and dispatches named events", () => {
    const progress = vi.fn();
    const { result } = renderHook(() => useSSE("/jobs/abc/events", { events: { progress } }));
    const es = FakeEventSource.instances[0] as FakeEventSource;
    expect(es.url).toBe("/api/jobs/abc/events");
    expect(result.current.status).toBe("connecting");
    act(() => es.open());
    expect(result.current.status).toBe("open");
    act(() => es.emit("progress", { progress: 0.5 }));
    expect(progress).toHaveBeenCalledWith({ progress: 0.5 }, expect.any(MessageEvent));
    expect(result.current.lastEventAt).not.toBeNull();
  });

  it("reconnects with exponential backoff after the stream closes", () => {
    const { result } = renderHook(() => useSSE("/jobs/stream", { initialDelayMs: 1000, maxRetries: 3 }));
    act(() => (FakeEventSource.instances[0] as FakeEventSource).fail());
    expect(result.current.status).toBe("reconnecting");
    expect(result.current.retries).toBe(1);
    act(() => vi.advanceTimersByTime(999));
    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeEventSource.instances).toHaveLength(2);
    act(() => (FakeEventSource.instances[1] as FakeEventSource).fail());
    act(() => vi.advanceTimersByTime(2000)); // second delay doubles
    expect(FakeEventSource.instances).toHaveLength(3);
    act(() => (FakeEventSource.instances[2] as FakeEventSource).open());
    expect(result.current.status).toBe("open");
    expect(result.current.retries).toBe(0);
  });

  it("gives up after maxRetries and reports an error", () => {
    const { result } = renderHook(() => useSSE("/jobs/stream", { initialDelayMs: 10, maxRetries: 1 }));
    act(() => (FakeEventSource.instances[0] as FakeEventSource).fail());
    act(() => vi.advanceTimersByTime(10));
    act(() => (FakeEventSource.instances[1] as FakeEventSource).fail());
    expect(result.current.status).toBe("error");
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it("stops after the closeOn event and closes on unmount", () => {
    const done = vi.fn();
    const { result, unmount } = renderHook(() => useSSE("/jobs/abc/events", { events: { done }, closeOn: "done" }));
    const es = FakeEventSource.instances[0] as FakeEventSource;
    act(() => es.open());
    act(() => es.emit("done", { status: "succeeded" }));
    expect(done).toHaveBeenCalled();
    expect(es.closed).toBe(true);
    expect(result.current.status).toBe("closed");
    unmount();
  });

  it("stays idle for a null path", () => {
    const { result } = renderHook(() => useSSE(null));
    expect(result.current.status).toBe("idle");
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
