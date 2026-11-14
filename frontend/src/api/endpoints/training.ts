/**
 * Training (`/api/training/*`): model cards, the measured per-epoch time estimate, and starting a
 * single run or the full four-model suite (both background jobs).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import type { EstimateOut, ModelCardOut, ModelTypeId, TrainingRunCreate, TrainingRunOut, TrainingSuiteCreate, TrainingSuiteOut } from "../schemasOps";
import { qkOps } from "./keysOps";

export function useModelTypes() {
  return useQuery({
    queryKey: qkOps.training.modelTypes,
    queryFn: ({ signal }) => api.get<ModelCardOut[]>("/training/model-types", undefined, signal),
    staleTime: Number.POSITIVE_INFINITY, // model cards are static for a backend version
  });
}

/**
 * GET /api/training/estimate — the server runs a few real training steps, so this can take
 * several seconds for a CNN; cached for 10 minutes per (model type, dataset).
 */
export function useTrainingEstimate(modelType: ModelTypeId | null, datasetId: number | null) {
  return useQuery({
    queryKey: qkOps.training.estimate(modelType ?? "", datasetId ?? -1),
    queryFn: ({ signal }) => api.get<EstimateOut>("/training/estimate", { model_type: modelType, dataset_id: datasetId }, signal),
    enabled: Boolean(modelType) && datasetId !== null,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export function useStartTraining() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TrainingRunCreate) => api.post<TrainingRunOut>("/training/runs", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkOps.experiments.all }),
  });
}

export function useStartSuite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TrainingSuiteCreate) => api.post<TrainingSuiteOut>("/training/suite", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkOps.experiments.all }),
  });
}
