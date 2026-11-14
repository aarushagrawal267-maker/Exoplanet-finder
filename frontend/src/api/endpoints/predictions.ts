/** Predictions: score, history, candidates and batch scoring (`/api/predictions*`). */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import type {
  BatchIn,
  CandidatePage,
  CandidateQuery,
  JobOut,
  PredictIn,
  PredictionDetailOut,
  PredictionPage,
  PredictionQuery,
  PredictResponse,
} from "../schemas";
import { qk } from "./keys";

export const predict = (body: PredictIn) => api.post<PredictResponse>("/predictions", body);

export function usePredict() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: predict,
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.predictions.all }),
        qc.invalidateQueries({ queryKey: qk.system.summary }),
        qc.invalidateQueries({ queryKey: qk.targets.all }),
      ]),
  });
}

export function usePredictions(query: PredictionQuery) {
  return useQuery({
    queryKey: qk.predictions.list(query),
    queryFn: ({ signal }) => api.get<PredictionPage>("/predictions", query, signal),
    placeholderData: keepPreviousData,
  });
}

export function usePrediction(id: number | null) {
  return useQuery({
    queryKey: qk.predictions.detail(id ?? -1),
    queryFn: ({ signal }) => api.get<PredictionDetailOut>(`/predictions/${id}`, undefined, signal),
    enabled: id !== null && Number.isFinite(id),
    staleTime: Number.POSITIVE_INFINITY, // a stored prediction never changes
  });
}

export function useCandidates(query: CandidateQuery) {
  return useQuery({
    queryKey: qk.predictions.candidates(query),
    queryFn: ({ signal }) => api.get<CandidatePage>("/predictions/candidates", query, signal),
    placeholderData: keepPreviousData,
  });
}

/** POST /api/predictions/batch → 202 JobOut (409 no_model / nothing_to_score). */
export function useStartBatch() {
  return useMutation({ mutationFn: (body: BatchIn) => api.post<JobOut>("/predictions/batch", body) });
}
