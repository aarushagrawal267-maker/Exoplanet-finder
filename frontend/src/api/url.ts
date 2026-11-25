/** API base URL and query-string helpers (shared by the fetch client and the SSE hook). */

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") || "/api";

/**
 * Where the backend's interactive OpenAPI docs live (opened in a new tab).
 * Development: the backend's own `/docs` (not proxied). Production build: the backend serves the
 * app itself and moves its API docs to `/api/docs` on the same origin (the app owns `/docs`).
 */
export const API_DOCS_URL: string =
  (import.meta.env.VITE_API_DOCS_URL as string | undefined) ||
  (import.meta.env.PROD
    ? `${API_BASE}/docs`
    : `${((import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:8000").replace(/\/$/, "")}/docs`);

export type QueryValue = string | number | boolean | null | undefined | ReadonlyArray<string | number>;

/** Build a URL under the API base with a serialised query string (null/undefined/"" dropped). */
export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  if (/^https?:\/\//.test(path)) return path;
  const clean = path.startsWith("/") ? path : `/${path}`;
  const url = clean.startsWith(`${API_BASE}/`) ? clean : `${API_BASE}${clean}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      value.forEach((v) => params.append(key, String(v)));
    } else {
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}
