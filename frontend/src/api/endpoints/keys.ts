/**
 * TanStack Query keys for every API area, in one place so invalidation after a mutation is
 * explicit (`queryClient.invalidateQueries({ queryKey: qk.catalog.all })`).
 */
export const qk = {
  health: ["health"] as const,
  system: {
    all: ["system"] as const,
    summary: ["system", "summary"] as const,
    diagnostics: (checkNetwork: boolean) => ["system", "diagnostics", checkNetwork] as const,
  },
  catalog: {
    all: ["catalog"] as const,
    signals: (query: object) => ["catalog", "signals", query] as const,
    stats: ["catalog", "stats"] as const,
    snapshots: ["catalog", "snapshots"] as const,
  },
  targets: {
    all: ["targets"] as const,
    search: (q: string) => ["targets", "search", q] as const,
    detail: (kepid: number) => ["targets", "detail", kepid] as const,
  },
  lightcurves: {
    all: ["lightcurves"] as const,
    one: (params: object) => ["lightcurves", params] as const,
  },
  uploads: {
    one: (id: string) => ["uploads", id] as const,
  },
  analysis: {
    bls: (body: object) => ["analysis", "bls", body] as const,
    transit: (body: object) => ["analysis", "transit", body] as const,
    injection: (body: object) => ["analysis", "injection", body] as const,
  },
  predictions: {
    all: ["predictions"] as const,
    list: (query: object) => ["predictions", "list", query] as const,
    detail: (id: number) => ["predictions", "detail", id] as const,
    candidates: (query: object) => ["predictions", "candidates", query] as const,
  },
  models: {
    all: ["models"] as const,
    list: (includeFixtures: boolean) => ["models", "list", includeFixtures] as const,
  },
  jobs: {
    all: ["jobs"] as const,
    one: (id: string) => ["jobs", id] as const,
  },
  settings: {
    all: ["settings"] as const,
    values: ["settings", "values"] as const,
    storage: ["settings", "storage"] as const,
  },
  docs: {
    pages: ["docs", "pages"] as const,
    page: (slug: string) => ["docs", "page", slug] as const,
  },
};
