/**
 * Evaluation (`/api/evaluation*`): start a run (background job), list, full detail, scored
 * examples per confusion-matrix cell, permutation feature importance (baselines only) and the
 * aligned comparison of several evaluations.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import type { JobOut } from "../schemas";
import type {
  EvaluationCompareOut,
  EvaluationCreate,
  EvaluationDetailOut,
  EvaluationExamplePage,
  EvaluationOut,
  EvaluationOutcome,
  EvaluationQuery,
  FeatureImportanceOut,
} from "../schemasOps";
import { qk } from "./keys";
import { qkOps } from "./keysOps";

export function useEvaluations(query: EvaluationQuery = {}) {
  return useQuery({
    queryKey: qkOps.evaluation.list(query),
    queryFn: ({ signal }) => api.get<EvaluationOut[]>("/evaluation", query, signal),
  });
}

export const fetchEvaluation = (id: number, signal?: AbortSignal) => api.get<EvaluationDetailOut>(`/evaluation/${id}`, undefined, signal);

export function useEvaluation(id: number | null) {
  return useQuery({
    queryKey: qkOps.evaluation.detail(id ?? -1),
    queryFn: ({ signal }) => fetchEvaluation(id as number, signal),
    enabled: id !== null,
    staleTime: Number.POSITIVE_INFINITY, // a stored evaluation never changes
  });
}

export function useEvaluationExamples(id: number | null, query: { outcome?: EvaluationOutcome; limit?: number; offset?: number }) {
  return useQuery({
    queryKey: qkOps.evaluation.examples(id ?? -1, query),
    queryFn: ({ signal }) => api.get<EvaluationExamplePage>(`/evaluation/${id}/examples`, query, signal),
    enabled: id !== null,
    placeholderData: keepPreviousData,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Permutation importance (computed on demand by the server, cached there). 409 for CNNs. */
export function useFeatureImportance(id: number | null, enabled = true) {
  return useQuery({
    queryKey: qkOps.evaluation.featureImportance(id ?? -1),
    queryFn: ({ signal }) => api.get<FeatureImportanceOut>(`/evaluation/${id}/feature-importance`, undefined, signal),
    enabled: id !== null && enabled,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/** Ids are sent comma-separated (`?ids=3,5`), as the API expects. */
export function useCompareEvaluations(ids: readonly number[]) {
  return useQuery({
    queryKey: qkOps.evaluation.compare(ids),
    queryFn: ({ signal }) => api.get<EvaluationCompareOut>("/evaluation/compare", { ids: ids.join(",") }, signal),
    enabled: ids.length >= 2,
  });
}

/** POST /api/evaluation/runs → 202 JobOut. Test-split runs are logged and counted by the server. */
export function useStartEvaluation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EvaluationCreate) => api.post<JobOut>("/evaluation/runs", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.models.all }),
  });
}

/** Evaluation id produced by a finished `evaluate` job. */
export function evaluationIdOfJob(job: Pick<JobOut, "result"> | null | undefined): number | null {
  const v = job?.result?.evaluation_id;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
