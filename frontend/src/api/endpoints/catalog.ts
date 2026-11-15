/** NASA catalogue: signals, statistics, snapshots and refresh (`/api/catalog/*`). */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import type { CatalogStatsOut, JobOut, SignalPage, SignalQuery, SnapshotOut } from "../schemas";
import { qk } from "./keys";

export const fetchSignals = (query: SignalQuery, signal?: AbortSignal) => api.get<SignalPage>("/catalog/signals", query, signal);

/** Server-paginated, filterable, sortable catalogue signals. Keeps the previous page while loading. */
export function useSignals(query: SignalQuery, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.catalog.signals(query),
    queryFn: ({ signal }) => fetchSignals(query, signal),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useCatalogStats() {
  return useQuery({
    queryKey: qk.catalog.stats,
    queryFn: ({ signal }) => api.get<CatalogStatsOut>("/catalog/stats", undefined, signal),
    staleTime: 5 * 60_000,
  });
}

export function useSnapshots() {
  return useQuery({
    queryKey: qk.catalog.snapshots,
    queryFn: ({ signal }) => api.get<SnapshotOut[]>("/catalog/snapshots", undefined, signal),
    staleTime: 5 * 60_000,
  });
}

/** POST /api/catalog/refresh → 202 JobOut (409 job_running when a refresh is already running). */
export function useRefreshCatalog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sources?: string[] | null) => api.post<JobOut>("/catalog/refresh", sources ? { sources } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.system.summary }),
  });
}
