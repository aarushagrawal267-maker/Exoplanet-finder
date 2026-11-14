/**
 * Thin fetch wrapper for the Exoplanet Finder REST API.
 *
 * - Base URL `/api` (proxied to the FastAPI backend by Vite in development); override with
 *   `VITE_API_BASE` for a different deployment.
 * - JSON in / JSON out; query parameters are serialised with undefined/null values dropped.
 * - Every failure is normalised to an {@link ApiError} carrying the HTTP status, a human-readable
 *   `detail`, and the backend's optional machine `code` and `hint` (see docs/dev/API.md).
 */
import type { ApiErrorBody } from "./types";
import { buildUrl, type QueryValue } from "./url";

export { API_BASE, API_DOCS_URL, buildUrl } from "./url";
export type { QueryValue } from "./url";

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/** Normalised API failure. `status` is 0 for network errors (backend unreachable). */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly code: string | null;
  readonly hint: string | null;
  readonly body: unknown;

  constructor(status: number, detail: string, opts: { code?: string | null; hint?: string | null; body?: unknown } = {}) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.code = opts.code ?? null;
    this.hint = opts.hint ?? null;
    this.body = opts.body;
  }

  /** True when the backend could not be reached at all (network error or dev-proxy 502). */
  get isNetworkError(): boolean {
    return this.status === 0 || this.code === "backend_unreachable";
  }
}

/**
 * Turn any FastAPI error payload into one readable sentence. Handles our `{detail, code, hint}`
 * envelope, plain strings, and pydantic 422 arrays (`[{loc, msg, type}]`).
 */
export function normaliseDetail(body: unknown, fallback: string): { detail: string; code: string | null; hint: string | null } {
  if (body === null || body === undefined || body === "") return { detail: fallback, code: null, hint: null };
  if (typeof body === "string") return { detail: body, code: null, hint: null };
  if (typeof body === "object") {
    const b = body as ApiErrorBody;
    const code = typeof b.code === "string" ? b.code : null;
    const hint = typeof b.hint === "string" ? b.hint : null;
    const d = b.detail;
    if (typeof d === "string") return { detail: d, code, hint };
    if (Array.isArray(d)) {
      const parts = d.map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          const loc = Array.isArray((item as { loc?: unknown }).loc)
            ? ((item as { loc: unknown[] }).loc.filter((p) => p !== "body" && p !== "query").join("."))
            : "";
          const msg = String((item as { msg: unknown }).msg);
          return loc ? `${loc}: ${msg}` : msg;
        }
        return String(item);
      });
      return { detail: parts.join("; ") || fallback, code, hint };
    }
    if (d && typeof d === "object") return { detail: JSON.stringify(d), code, hint };
    return { detail: fallback, code, hint };
  }
  return { detail: fallback, code: null, hint: null };
}

/** Perform a request and parse JSON. Throws {@link ApiError} on any failure. */
export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", query, body, signal, headers } = opts;
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      signal,
      headers: {
        Accept: "application/json",
        ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "Cannot reach the Exoplanet Finder API.", {
      hint: "Start the backend (scripts/start.sh or start.ps1) and check it is listening on port 8000.",
      body: err,
    });
  }

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    const { detail, code, hint } = normaliseDetail(parsed, `${res.status} ${res.statusText || "Request failed"}`);
    throw new ApiError(res.status, detail, { code, hint, body: parsed });
  }
  return parsed as T;
}

/** Convenience verbs. */
export const api = {
  get: <T>(path: string, query?: Record<string, QueryValue>, signal?: AbortSignal) => apiFetch<T>(path, { query, signal }),
  post: <T>(path: string, body?: unknown, query?: Record<string, QueryValue>) => apiFetch<T>(path, { method: "POST", body, query }),
  put: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PUT", body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string, query?: Record<string, QueryValue>) => apiFetch<T>(path, { method: "DELETE", query }),
};

export { useSSE } from "./useSSE";
export type { SSEStatus, UseSSEOptions, UseSSEResult } from "./useSSE";
