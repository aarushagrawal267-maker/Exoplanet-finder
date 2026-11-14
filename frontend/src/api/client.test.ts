import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, apiFetch, buildUrl, normaliseDetail } from "./client";

function mockFetch(response: Response | Error) {
  const fn = vi.fn(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildUrl", () => {
  it("prefixes the API base and drops empty query values", () => {
    expect(buildUrl("/catalog/signals", { search: "Kepler-90", limit: 50, kepid: undefined, conflict: null, q: "" })).toBe(
      "/api/catalog/signals?search=Kepler-90&limit=50",
    );
  });
  it("repeats array values and leaves absolute URLs alone", () => {
    expect(buildUrl("evaluation/compare", { ids: [1, 2] })).toBe("/api/evaluation/compare?ids=1&ids=2");
    expect(buildUrl("/api/health")).toBe("/api/health");
    expect(buildUrl("http://example.test/x")).toBe("http://example.test/x");
  });
});

describe("normaliseDetail", () => {
  it("reads the {detail, code, hint} envelope", () => {
    expect(normaliseDetail({ detail: "No model", code: "no_model", hint: "Train one" }, "x")).toEqual({
      detail: "No model",
      code: "no_model",
      hint: "Train one",
    });
  });
  it("flattens pydantic 422 arrays", () => {
    const body = { detail: [{ loc: ["body", "period_days"], msg: "Input should be greater than 0", type: "greater_than" }] };
    expect(normaliseDetail(body, "x").detail).toBe("period_days: Input should be greater than 0");
  });
  it("falls back for empty bodies", () => {
    expect(normaliseDetail(undefined, "500 Internal Server Error").detail).toBe("500 Internal Server Error");
  });
});

describe("apiFetch", () => {
  it("returns parsed JSON and sends JSON bodies", async () => {
    const fetchFn = mockFetch(new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(api.post<{ ok: number }>("/predictions", { kepid: 1 })).resolves.toEqual({ ok: 1 });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/predictions");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ kepid: 1 }));
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("normalises HTTP errors into ApiError", async () => {
    mockFetch(new Response(JSON.stringify({ detail: "No trained model", code: "no_model", hint: "Train a model first" }), { status: 409 }));
    const err = await apiFetch("/predictions").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, detail: "No trained model", code: "no_model", hint: "Train a model first" });
  });

  it("reports network failures as status 0 with a hint", async () => {
    mockFetch(new TypeError("Failed to fetch"));
    const err = (await apiFetch("/health").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.isNetworkError).toBe(true);
    expect(err.hint).toMatch(/Start the backend/);
  });

  it("treats the dev proxy's backend_unreachable 502 as a network error", async () => {
    mockFetch(new Response(JSON.stringify({ detail: "The backend is not reachable.", code: "backend_unreachable", hint: "Start it" }), { status: 502 }));
    const err = (await apiFetch("/health").catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(502);
    expect(err.isNetworkError).toBe(true);
    expect(err.hint).toBe("Start it");
  });

  it("handles non-JSON error bodies", async () => {
    mockFetch(new Response("Bad gateway", { status: 502, statusText: "Bad Gateway" }));
    const err = (await apiFetch("/health").catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(502);
    expect(err.detail).toBe("Bad gateway");
  });
});
