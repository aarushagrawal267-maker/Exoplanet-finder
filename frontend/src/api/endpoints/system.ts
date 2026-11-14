/** System: health, the dashboard summary and diagnostics (`/api/health`, `/api/system/*`). */
import { useQuery } from "@tanstack/react-query";
import { api } from "../client";
import type { DiagnosticsOut, HealthOut, SystemSummaryOut } from "../schemas";
import { qk } from "./keys";

export const fetchHealth = (signal?: AbortSignal) => api.get<HealthOut>("/health", undefined, signal);
export const fetchSystemSummary = (signal?: AbortSignal) => api.get<SystemSummaryOut>("/system/summary", undefined, signal);
export const fetchDiagnostics = (checkNetwork: boolean, signal?: AbortSignal) =>
  api.get<DiagnosticsOut>("/system/diagnostics", { check_network: checkNetwork || undefined }, signal);

export function useHealth() {
  return useQuery({
    queryKey: qk.health,
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 30_000,
    retry: false,
  });
}

/**
 * `/api/system/summary` — counts, active model, running jobs and the setup checklist. Polls a
 * little faster while jobs are running so progress and counts stay current.
 */
export function useSystemSummary(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.system.summary,
    queryFn: ({ signal }) => fetchSystemSummary(signal),
    enabled: options.enabled ?? true,
    refetchInterval: (query) => ((query.state.data?.running_jobs.length ?? 0) > 0 ? 5_000 : 60_000),
    retry: false,
  });
}

export function useDiagnostics(checkNetwork: boolean) {
  return useQuery({
    queryKey: qk.system.diagnostics(checkNetwork),
    queryFn: ({ signal }) => fetchDiagnostics(checkNetwork, signal),
    staleTime: checkNetwork ? 0 : 30_000,
  });
}
