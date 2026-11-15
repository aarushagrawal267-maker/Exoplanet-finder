/**
 * Test helpers for pages: a route-table `fetch` mock that answers like the FastAPI backend
 * (JSON bodies, `{detail, code, hint}` errors) and records every request, plus a renderer that
 * mounts a page inside a memory router and a fresh QueryClient.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { vi } from "vitest";

export interface MockRoute {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  /** Path under /api, matched against the pathname: exact string, or a RegExp. */
  path: string | RegExp;
  status?: number;
  body?: unknown;
  /** Compute the response from the request (overrides status/body). */
  handle?: (req: { url: URL; method: string; body: unknown }) => { status?: number; body?: unknown } | undefined;
  /** Never resolve (to observe loading states). */
  pending?: boolean;
}

export interface RecordedCall {
  method: string;
  url: URL;
  path: string;
  body: unknown;
}

export function mockApi(routes: MockRoute[]) {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://test.local");
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/api/, "");
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    } else if (init?.body) body = init.body;
    calls.push({ method, url, path, body });
    const route = routes.find((r) => (r.method ?? "GET") === method && (typeof r.path === "string" ? r.path === path : r.path.test(path)));
    if (!route) {
      return new Response(JSON.stringify({ detail: `No mock for ${method} ${path}`, code: "no_mock" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    if (route.pending) return new Promise<Response>(() => undefined);
    const out = route.handle?.({ url, method, body }) ?? { status: route.status, body: route.body };
    return new Response(out.body === undefined ? "" : JSON.stringify(out.body), { status: out.status ?? 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock, find: (method: string, path: string | RegExp) => calls.filter((c) => c.method === method && (typeof path === "string" ? c.path === path : path.test(c.path))) };
}

/** Routes every page shell needs (health). */
export const baseRoutes: MockRoute[] = [{ path: "/health", body: { status: "ok", version: "1.0.0", pipeline_version: "1.0" } }];

export function renderPage(element: ReactElement, { path = "/", route = "/" }: { path?: string; route?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY }, mutations: { retry: false } } });
  const router = createMemoryRouter([{ path, element }, { path: "*", element: <div data-testid="elsewhere" /> }], {
    initialEntries: [route],
    future: { v7_relativeSplatPath: true },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </QueryClientProvider>,
  );
  return { ...utils, router, qc };
}
