/**
 * Test helpers for the operations pages: a fetch stub that routes `/api/*` requests to canned
 * responses, and a renderer with a fresh QueryClient and a memory router.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { vi } from "vitest";

type Responder = (req: { url: URL; init?: RequestInit }) => unknown;

export interface MockRoute {
  method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  /** Matched against the pathname (without the `/api` prefix), e.g. /^\/datasets$/ or "/datasets/7". */
  path: RegExp | string;
  /** Optional check on the query string. */
  query?: (q: URLSearchParams) => boolean;
  status?: number;
  body: Responder | object | string | number | boolean | null;
  headers?: Record<string, string>;
}

export interface MockApi {
  fetch: ReturnType<typeof vi.fn>;
  calls: Array<{ method: string; path: string; search: string; body: unknown }>;
}

/** Install a fetch stub; unmatched requests answer 404 `{detail}` (and are recorded). */
export function mockApi(routes: MockRoute[]): MockApi {
  const calls: MockApi["calls"] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/api/, "");
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ method, path, search: url.search, body });
    const route = routes.find(
      (r) => (r.method ?? "GET") === method && (typeof r.path === "string" ? r.path === path : r.path.test(path)) && (!r.query || r.query(url.searchParams)),
    );
    if (!route) return new Response(JSON.stringify({ detail: `No mock for ${method} ${path}` }), { status: 404, headers: { "Content-Type": "application/json" } });
    const payload = typeof route.body === "function" ? (route.body as Responder)({ url, init }) : route.body;
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    return new Response(text, { status: route.status ?? 200, headers: { "Content-Type": "application/json", ...route.headers } });
  });
  vi.stubGlobal("fetch", fn);
  return { fetch: fn, calls };
}

/** Render `element` at `url` inside a router (route `path`) and a fresh QueryClient. */
export function renderRoute(element: ReactElement, { url = "/", path = "/" }: { url?: string; path?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path, element },
      { path: "*", element: <div data-testid="elsewhere" /> },
    ],
    { initialEntries: [url], future: { v7_relativeSplatPath: true } },
  );
  const utils = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </QueryClientProvider>,
  );
  return { ...utils, qc, router };
}
