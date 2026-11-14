/**
 * Experiments (`/api/experiments*`): the experiment log, detail (config, environment, epoch
 * curves, model version, evaluations), notes/tags/archive editing, deletion and comparison.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import type { ExperimentCompareOut, ExperimentDeleteOut, ExperimentDetailOut, ExperimentOut, ExperimentPatch, ExperimentQuery } from "../schemasOps";
import { qk } from "./keys";
import { qkOps } from "./keysOps";

const ACTIVE = new Set(["queued", "running"]);

export function useExperiments(query: ExperimentQuery = {}) {
  return useQuery({
    queryKey: qkOps.experiments.list(query),
    queryFn: ({ signal }) => api.get<ExperimentOut[]>("/experiments", query, signal),
    placeholderData: keepPreviousData,
    // Follow running experiments so their status and metrics appear without a reload.
    refetchInterval: (q) => (q.state.data?.some((e) => ACTIVE.has(e.status)) ? 5_000 : false),
  });
}

export function useExperiment(id: number | null, options: { pollWhileRunning?: boolean } = {}) {
  const { pollWhileRunning = true } = options;
  return useQuery({
    queryKey: qkOps.experiments.detail(id ?? -1),
    queryFn: ({ signal }) => api.get<ExperimentDetailOut>(`/experiments/${id}`, undefined, signal),
    enabled: id !== null,
    refetchInterval: (q) => (pollWhileRunning && q.state.data && ACTIVE.has(q.state.data.status) ? 4_000 : false),
  });
}

export function usePatchExperiment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: ExperimentPatch }) => api.patch<ExperimentDetailOut>(`/experiments/${id}`, patch),
    onSuccess: (detail) => {
      qc.setQueryData(qkOps.experiments.detail(detail.id), detail);
      return Promise.all([qc.invalidateQueries({ queryKey: qkOps.experiments.all }), qc.invalidateQueries({ queryKey: qk.models.all })]);
    },
  });
}

export function useDeleteExperiment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<ExperimentDeleteOut>(`/experiments/${id}`),
    onSuccess: (_out, id) => {
      qc.removeQueries({ queryKey: qkOps.experiments.detail(id) });
      return Promise.all([
        qc.invalidateQueries({ queryKey: qkOps.experiments.all }),
        qc.invalidateQueries({ queryKey: qkOps.evaluation.all }),
        qc.invalidateQueries({ queryKey: qkOps.datasets.all }),
        qc.invalidateQueries({ queryKey: qk.models.all }),
        qc.invalidateQueries({ queryKey: qk.predictions.all }),
        qc.invalidateQueries({ queryKey: qk.system.all }),
      ]);
    },
  });
}

/** Ids are sent comma-separated (`?ids=3,5`), as the API expects. */
export function useCompareExperiments(ids: readonly number[]) {
  return useQuery({
    queryKey: qkOps.experiments.compare(ids),
    queryFn: ({ signal }) => api.get<ExperimentCompareOut>("/experiments/compare", { ids: ids.join(",") }, signal),
    enabled: ids.length >= 2,
  });
}
