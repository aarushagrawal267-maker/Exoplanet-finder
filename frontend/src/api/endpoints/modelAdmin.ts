/**
 * Model administration (`/api/models/{id}`, activate, delete). The read-only list lives in
 * `models.ts` (shared with the science pages); every mutation here invalidates it.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import type { ModelVersionOut } from "../schemas";
import type { ModelDeleteOut, ModelDetailOut } from "../schemasOps";
import { qk } from "./keys";
import { qkOps } from "./keysOps";

export function useModelDetail(id: number | null) {
  return useQuery({
    queryKey: qkOps.modelAdmin.detail(id ?? -1),
    queryFn: ({ signal }) => api.get<ModelDetailOut>(`/models/${id}`, undefined, signal),
    enabled: id !== null,
  });
}

function invalidateModels(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: qk.models.all }),
    qc.invalidateQueries({ queryKey: qkOps.modelAdmin.all }),
    qc.invalidateQueries({ queryKey: qkOps.experiments.all }),
    qc.invalidateQueries({ queryKey: qk.system.all }),
  ]);
}

export function useActivateModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<ModelVersionOut>(`/models/${id}/activate`),
    onSuccess: () => invalidateModels(qc),
  });
}

/** DELETE /api/models/{id} (409 `model_is_active` for the only model unless `force`). */
export function useDeleteModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, force = false }: { id: number; force?: boolean }) => api.delete<ModelDeleteOut>(`/models/${id}`, force ? { force: true } : undefined),
    onSuccess: () => Promise.all([invalidateModels(qc), qc.invalidateQueries({ queryKey: qkOps.evaluation.all }), qc.invalidateQueries({ queryKey: qk.predictions.all })]),
  });
}
