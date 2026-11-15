/**
 * TanStack Query keys for the machine-learning operations API areas (datasets, training, model
 * administration, evaluation, experiments, the job feed). Kept apart from `keys.ts` (science pages)
 * so the two halves of the UI can evolve independently; model lists still use `qk.models` from
 * there because both halves read them.
 */
export const qkOps = {
  datasets: {
    all: ["datasets"] as const,
    list: ["datasets", "list"] as const,
    tiers: (labelMode: string) => ["datasets", "tiers", labelMode] as const,
    detail: (id: number) => ["datasets", "detail", id] as const,
    examples: (id: number, query: object) => ["datasets", "examples", id, query] as const,
    views: (id: number, signalId: number) => ["datasets", "views", id, signalId] as const,
    gallery: (id: number, perClass: number, seed: number) => ["datasets", "gallery", id, perClass, seed] as const,
  },
  training: {
    all: ["training"] as const,
    modelTypes: ["training", "model-types"] as const,
    estimate: (modelType: string, datasetId: number) => ["training", "estimate", modelType, datasetId] as const,
  },
  modelAdmin: {
    all: ["model-admin"] as const,
    detail: (id: number) => ["model-admin", "detail", id] as const,
  },
  evaluation: {
    all: ["evaluation"] as const,
    list: (query: object) => ["evaluation", "list", query] as const,
    detail: (id: number) => ["evaluation", "detail", id] as const,
    examples: (id: number, query: object) => ["evaluation", "examples", id, query] as const,
    featureImportance: (id: number) => ["evaluation", "feature-importance", id] as const,
    compare: (ids: readonly number[]) => ["evaluation", "compare", ids.join(",")] as const,
  },
  experiments: {
    all: ["experiments"] as const,
    list: (query: object) => ["experiments", "list", query] as const,
    detail: (id: number) => ["experiments", "detail", id] as const,
    compare: (ids: readonly number[]) => ["experiments", "compare", ids.join(",")] as const,
  },
  jobFeed: {
    all: ["job-feed"] as const,
    active: ["job-feed", "active"] as const,
    recent: ["job-feed", "recent"] as const,
  },
};
