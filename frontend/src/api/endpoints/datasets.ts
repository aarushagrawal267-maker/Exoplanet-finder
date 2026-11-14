/**
 * Datasets (`/api/datasets*`): tier estimates, build (a background job), list, detail with
 * statistics, paginated examples, per-example model views, the class gallery and deletion.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import type { JobOut } from "../schemas";
import type {
  DatasetCreate,
  DatasetDeleteOut,
  DatasetDetailOut,
  DatasetExamplePage,
  DatasetExampleQuery,
  DatasetOut,
  ExampleViewsOut,
  GalleryOut,
  LabelMode,
  TierOut,
} from "../schemasOps";
import { qk } from "./keys";
import { qkOps } from "./keysOps";

export const fetchDatasets = (signal?: AbortSignal) => api.get<DatasetOut[]>("/datasets", undefined, signal);

/** Dataset id of a `build_dataset` job (the API puts it in `params.dataset_id`). */
export function datasetIdOfJob(job: Pick<JobOut, "params"> | null | undefined): number | null {
  const v = job?.params?.dataset_id;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function useDatasetTiers(labelMode: LabelMode) {
  return useQuery({
    queryKey: qkOps.datasets.tiers(labelMode),
    queryFn: ({ signal }) => api.get<TierOut[]>("/datasets/tiers", { label_mode: labelMode }, signal),
    staleTime: 60_000,
  });
}

/** All datasets. Polls every 4 s while one is building so its status flips without a reload. */
export function useDatasets() {
  return useQuery({
    queryKey: qkOps.datasets.list,
    queryFn: ({ signal }) => fetchDatasets(signal),
    refetchInterval: (q) => (q.state.data?.some((d) => d.status === "building") ? 4_000 : false),
  });
}

export function useDataset(id: number | null) {
  return useQuery({
    queryKey: qkOps.datasets.detail(id ?? -1),
    queryFn: ({ signal }) => api.get<DatasetDetailOut>(`/datasets/${id}`, undefined, signal),
    enabled: id !== null,
    refetchInterval: (q) => (q.state.data?.status === "building" ? 4_000 : false),
  });
}

export function useDatasetExamples(id: number | null, query: DatasetExampleQuery) {
  return useQuery({
    queryKey: qkOps.datasets.examples(id ?? -1, query),
    queryFn: ({ signal }) => api.get<DatasetExamplePage>(`/datasets/${id}/examples`, query, signal),
    enabled: id !== null,
    placeholderData: keepPreviousData,
  });
}

export function useExampleViews(id: number | null, signalId: number | null) {
  return useQuery({
    queryKey: qkOps.datasets.views(id ?? -1, signalId ?? -1),
    queryFn: ({ signal }) => api.get<ExampleViewsOut>(`/datasets/${id}/examples/${signalId}/views`, undefined, signal),
    enabled: id !== null && signalId !== null,
    staleTime: Number.POSITIVE_INFINITY, // the views of a built dataset never change
  });
}

export function useDatasetGallery(id: number | null, perClass = 6, seed = 0, enabled = true) {
  return useQuery({
    queryKey: qkOps.datasets.gallery(id ?? -1, perClass, seed),
    queryFn: ({ signal }) => api.get<GalleryOut>(`/datasets/${id}/gallery`, { per_class: perClass, seed }, signal),
    enabled: id !== null && enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** POST /api/datasets → 202 JobOut (`build_dataset`; the new id is in `params.dataset_id`). */
export function useBuildDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DatasetCreate) => api.post<JobOut>("/datasets", body),
    onSuccess: () =>
      Promise.all([qc.invalidateQueries({ queryKey: qkOps.datasets.all }), qc.invalidateQueries({ queryKey: qk.system.all })]),
  });
}

/** DELETE /api/datasets/{id} (409 `dataset_in_use` unless `force`, which also deletes dependants). */
export function useDeleteDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, force = false }: { id: number; force?: boolean }) => api.delete<DatasetDeleteOut>(`/datasets/${id}`, force ? { force: true } : undefined),
    onSuccess: (_out, { id }) => {
      qc.removeQueries({ queryKey: qkOps.datasets.detail(id) });
      return Promise.all([
        qc.invalidateQueries({ queryKey: qkOps.datasets.all }),
        qc.invalidateQueries({ queryKey: qkOps.experiments.all }),
        qc.invalidateQueries({ queryKey: qkOps.evaluation.all }),
        qc.invalidateQueries({ queryKey: qk.models.all }),
        qc.invalidateQueries({ queryKey: qk.system.all }),
      ]);
    },
  });
}
