/**
 * Trained model versions, read-only (`GET /api/models`): the science pages only need the list to
 * choose which models score a signal. Training, activation and deletion live with the Model
 * Training / Evaluation pages.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "../client";
import type { ModelVersionOut } from "../schemas";
import { qk } from "./keys";

export const fetchModels = (includeFixtures = true, signal?: AbortSignal) =>
  api.get<ModelVersionOut[]>("/models", { include_fixtures: includeFixtures }, signal);

export function useModels(includeFixtures = true) {
  return useQuery({
    queryKey: qk.models.list(includeFixtures),
    queryFn: ({ signal }) => fetchModels(includeFixtures, signal),
    staleTime: 30_000,
  });
}
