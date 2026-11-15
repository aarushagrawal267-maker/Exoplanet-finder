/** Stars: search, dossier and light-curve download (`/api/targets/*`). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import type { JobOut, TargetDetailOut, TargetOut, TargetSearchResult } from "../schemas";
import { qk } from "./keys";

export const searchTargets = (q: string, signal?: AbortSignal, limit = 12) =>
  api.get<TargetSearchResult[]>("/targets/search", { q, limit }, signal);

export function useTargetSearch(q: string, options: { limit?: number } = {}) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: qk.targets.search(trimmed),
    queryFn: ({ signal }) => searchTargets(trimmed, signal, options.limit),
    enabled: trimmed.length >= 1,
    staleTime: 60_000,
  });
}

export function useTarget(kepid: number | null) {
  return useQuery({
    queryKey: qk.targets.detail(kepid ?? -1),
    queryFn: ({ signal }) => api.get<TargetDetailOut>(`/targets/${kepid}`, undefined, signal),
    enabled: kepid !== null && Number.isFinite(kepid),
  });
}

/** Result of POST /api/targets/{kepid}/download: 200 → the cached target, 202 → the download job. */
export type DownloadResult = { kind: "available"; target: TargetOut } | { kind: "job"; job: JobOut };

export function isJob(body: unknown): body is JobOut {
  return Boolean(body && typeof body === "object" && "status" in body && "kind" in body && "id" in body && !("kepid" in body));
}

export async function downloadTarget(kepid: number): Promise<DownloadResult> {
  const body = await api.post<TargetOut | JobOut>(`/targets/${kepid}/download`);
  return isJob(body) ? { kind: "job", job: body } : { kind: "available", target: body as TargetOut };
}

export function useDownloadTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kepid: number) => downloadTarget(kepid),
    onSuccess: (res, kepid) => {
      if (res.kind === "available") void invalidateStar(qc, kepid);
    },
  });
}

/** Everything that depends on a star's light-curve status. */
export function invalidateStar(qc: ReturnType<typeof useQueryClient>, kepid: number) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: qk.targets.detail(kepid) }),
    qc.invalidateQueries({ queryKey: qk.lightcurves.all }),
    qc.invalidateQueries({ queryKey: qk.catalog.all }),
    qc.invalidateQueries({ queryKey: qk.system.summary }),
  ]);
}
