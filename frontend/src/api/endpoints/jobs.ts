/**
 * Background jobs (`/api/jobs/*`). `useJob` follows one job live: the Server-Sent-Event stream
 * `/api/jobs/{id}/events` (snapshot → progress … → done) pushes updates into the query cache, and
 * polling `GET /api/jobs/{id}` is the fallback (fast while the stream is down, slow while it is up)
 * so progress keeps moving even when a proxy buffers or drops the stream.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "../client";
import type { JobOut, JobStatus } from "../schemas";
import { useSSE } from "../useSSE";
import { qk } from "./keys";

export const ACTIVE_STATUSES: ReadonlySet<JobStatus> = new Set(["queued", "running"]);
export const isJobActive = (job: Pick<JobOut, "status"> | null | undefined) => !job || ACTIVE_STATUSES.has(job.status);

export const fetchJob = (id: string, signal?: AbortSignal) => api.get<JobOut>(`/jobs/${id}`, undefined, signal);

interface ProgressEvent {
  progress?: number;
  message?: string | null;
  status?: JobStatus;
  eta_s?: number | null;
}
interface DoneEvent {
  status: JobStatus;
  result?: Record<string, unknown> | null;
  error?: string | null;
  message?: string | null;
}

export interface UseJobOptions {
  /** Called once when the job reaches a final status (succeeded / failed / cancelled). */
  onDone?: (job: JobOut) => void;
  /** Seed the cache with the JobOut returned by the POST that started the job. */
  initial?: JobOut | null;
}

export function useJob(jobId: string | null, { onDone, initial }: UseJobOptions = {}) {
  const qc = useQueryClient();
  const key = qk.jobs.one(jobId ?? "");
  const sseLive = useRef(false);

  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchJob(jobId as string, signal),
    enabled: Boolean(jobId),
    initialData: initial && initial.id === jobId ? initial : undefined,
    initialDataUpdatedAt: 0, // always confirm the seeded job with one GET
    refetchInterval: (q) => (q.state.data && !isJobActive(q.state.data) ? false : sseLive.current ? 10_000 : 1_500),
    retry: 2,
  });
  const job = query.data ?? null;
  const active = Boolean(jobId) && isJobActive(job);

  const merge = (patch: Partial<JobOut>) =>
    qc.setQueryData<JobOut>(key, (old) => (old ? { ...old, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } : old));

  const sse = useSSE(active ? `/jobs/${jobId}/events` : null, {
    closeOn: "done",
    maxRetries: 3,
    events: {
      snapshot: (d) => {
        if (d && typeof d === "object" && "id" in d) qc.setQueryData<JobOut>(key, d as JobOut);
      },
      progress: (d) => {
        const p = (d ?? {}) as ProgressEvent;
        merge({ progress: p.progress, message: p.message ?? undefined, status: p.status, eta_s: p.eta_s });
      },
      done: (d) => {
        const p = (d ?? {}) as DoneEvent;
        merge({
          status: p.status,
          result: p.result ?? null,
          error: p.error ?? null,
          message: p.message ?? undefined,
          ...(p.status === "succeeded" ? { progress: 1, eta_s: null } : {}),
        });
        void qc.invalidateQueries({ queryKey: key });
      },
    },
  });
  sseLive.current = sse.status === "open";

  // Fire onDone exactly once per job when it leaves the active states.
  const doneFor = useRef<string | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    if (job && jobId && job.id === jobId && !isJobActive(job) && doneFor.current !== jobId) {
      doneFor.current = jobId;
      onDoneRef.current?.(job);
    }
  }, [job, jobId]);

  return { job, query, connection: sse.status, active };
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<JobOut>(`/jobs/${id}/cancel`),
    onSuccess: (job) => qc.setQueryData(qk.jobs.one(job.id), job),
  });
}
