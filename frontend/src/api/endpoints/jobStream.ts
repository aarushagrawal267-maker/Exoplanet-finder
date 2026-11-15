/**
 * `useJobFeed` — the live list of background jobs behind the top-bar job tray.
 *
 * Sources, merged into one id → job map:
 *  1. `GET /api/jobs?limit=N` once, to seed the most recent jobs (finished ones included);
 *  2. the SSE stream `/api/jobs/stream`: a `snapshot` of the active jobs first, then `progress`
 *     and `done` events for every job the API server runs;
 *  3. polling `GET /api/jobs?status=queued,running` — every 3 s while the stream is down, every
 *     15 s while it is up (jobs started by the command-line tool run in another process and never
 *     reach the API's event bus, so they are only seen this way).
 * A job that was active and disappears from an active-only answer has finished: its final state is
 * fetched with `GET /api/jobs/{id}`. Unknown ids seen in events are fetched the same way.
 *
 * When a job leaves the active states, the queries of the pages it affects are invalidated
 * (datasets after a build, experiments/models after training, evaluations after an evaluation).
 */
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../client";
import type { JobOut, JobStatus } from "../schemas";
import { useSSE } from "../useSSE";
import { ACTIVE_STATUSES, fetchJob, useCancelJob } from "./jobs";
import { qk } from "./keys";
import { qkOps } from "./keysOps";

export type JobFeedConnection = "live" | "connecting" | "offline";

export interface JobFeed {
  /** Active jobs (running, then queued, newest first) followed by the most recent finished ones. */
  jobs: JobOut[];
  connection: JobFeedConnection;
  /** Cancel a job; rejects with the API error (e.g. 409 for a job run by the command-line tool). */
  cancel: (id: string) => Promise<JobOut>;
  /** Last cancel failure (e.g. 409 `job_not_in_this_process` for command-line jobs). */
  cancelError: unknown;
  clearCancelError: () => void;
}

export interface UseJobFeedOptions {
  /** Finished jobs kept in the list (default 8). */
  recentLimit?: number;
  /** Set false to stop all network activity (tests, previews). Default true. */
  enabled?: boolean;
}

const isActive = (s: JobStatus | undefined) => s !== undefined && ACTIVE_STATUSES.has(s);
const MAX_FINISHED_KEPT = 40;

/** API timestamps are naive UTC ("2026-11-14T21:47:30.93"): add the zone before parsing. */
export function parseApiTime(value: string | null | undefined): number {
  if (!value) return 0;
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  const t = Date.parse(hasZone ? value : `${value}Z`);
  return Number.isFinite(t) ? t : 0;
}

/** Merge rule: a final status is never overwritten by an (older) active one; progress never goes back. */
export function mergeJob(existing: JobOut | undefined, incoming: JobOut): JobOut {
  if (!existing) return incoming;
  if (!isActive(existing.status) && isActive(incoming.status)) return existing;
  if (isActive(existing.status) && isActive(incoming.status) && existing.status === incoming.status) {
    return { ...incoming, progress: Math.max(existing.progress ?? 0, incoming.progress ?? 0) };
  }
  return incoming;
}

/** Sort for the tray: running → queued → finished; newest first within each group. */
export function orderJobs(jobs: JobOut[], recentLimit: number): JobOut[] {
  const rank = (j: JobOut) => (j.status === "running" ? 0 : j.status === "queued" ? 1 : 2);
  const sorted = [...jobs].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    const ta = parseApiTime(a.finished_at ?? a.started_at ?? a.created_at);
    const tb = parseApiTime(b.finished_at ?? b.started_at ?? b.created_at);
    return tb - ta;
  });
  const active = sorted.filter((j) => isActive(j.status));
  const finished = sorted.filter((j) => !isActive(j.status)).slice(0, recentLimit);
  return [...active, ...finished];
}

/** Invalidate the queries a finished job of `kind` affects. */
export function invalidateForJob(qc: QueryClient, kind: string): void {
  const keys: ReadonlyArray<readonly unknown[]> =
    kind === "build_dataset"
      ? [qkOps.datasets.all]
      : kind === "train" || kind === "train_suite"
        ? [qkOps.experiments.all, qk.models.all, qkOps.modelAdmin.all, qkOps.datasets.all]
        : kind === "evaluate"
          ? [qkOps.evaluation.all, qk.models.all, qkOps.modelAdmin.all, qkOps.experiments.all]
          : kind === "batch_predict"
            ? [qk.predictions.all]
            : kind === "catalog_refresh"
              ? [qk.catalog.all, qkOps.datasets.all]
              : kind === "download"
                ? [qk.targets.all]
                : [];
  for (const queryKey of [...keys, qk.system.all]) void qc.invalidateQueries({ queryKey });
}

interface ProgressPayload {
  job_id?: string;
  progress?: number;
  message?: string | null;
  status?: JobStatus;
  eta_s?: number | null;
}
interface DonePayload {
  job_id?: string;
  status?: JobStatus;
  result?: Record<string, unknown> | null;
  error?: string | null;
  message?: string | null;
}

const fetchActiveJobs = (signal?: AbortSignal) => api.get<JobOut[]>("/jobs", { status: "queued,running", limit: 100 }, signal);

/**
 * Queued / running jobs, optionally of some kinds. Shares its cache with the job feed's polling
 * query, so pages can ask "is a training job running?" without extra requests.
 */
export function useActiveJobs(kinds?: readonly string[]) {
  const q = useQuery({
    queryKey: qkOps.jobFeed.active,
    queryFn: ({ signal }) => fetchActiveJobs(signal),
    refetchInterval: 15_000,
    retry: false,
  });
  const data = useMemo(() => (kinds ? (q.data ?? []).filter((j) => kinds.includes(j.kind)) : (q.data ?? [])), [q.data, kinds]);
  return { ...q, jobs: data };
}

export function useJobFeed({ recentLimit = 8, enabled = true }: UseJobFeedOptions = {}): JobFeed {
  const qc = useQueryClient();
  const [map, setMap] = useState<Record<string, JobOut>>({});
  const mapRef = useRef(map);
  mapRef.current = map;
  const inFlight = useRef(new Set<string>());

  const upsert = useCallback((jobs: JobOut[]) => {
    if (!jobs.length) return;
    setMap((prev) => {
      const next = { ...prev };
      for (const j of jobs) next[j.id] = mergeJob(prev[j.id], j);
      // Bound memory: keep every active job and the newest finished ones.
      const finished = Object.values(next).filter((j) => !isActive(j.status));
      if (finished.length > MAX_FINISHED_KEPT) {
        for (const j of orderJobs(finished, finished.length).slice(MAX_FINISHED_KEPT)) delete next[j.id];
      }
      return next;
    });
  }, []);

  const patch = useCallback((id: string, fields: Partial<JobOut>) => {
    const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<JobOut>;
    setMap((prev) => {
      const old = prev[id];
      if (!old) return prev;
      if (!isActive(old.status) && clean.status && isActive(clean.status)) return prev; // stale event
      return { ...prev, [id]: { ...old, ...clean } };
    });
  }, []);

  /** Fetch one job's current state (deduplicated). */
  const refresh = useCallback(
    (id: string) => {
      if (inFlight.current.has(id)) return;
      inFlight.current.add(id);
      fetchJob(id)
        .then((job) => upsert([job]))
        .catch(() => undefined)
        .finally(() => inFlight.current.delete(id));
    },
    [upsert],
  );

  /** Jobs we believe active that an authoritative active-only list does not contain have finished. */
  const reconcileActive = useCallback(
    (activeIds: Set<string>) => {
      for (const j of Object.values(mapRef.current)) {
        if (isActive(j.status) && !activeIds.has(j.id)) refresh(j.id);
      }
    },
    [refresh],
  );

  // 1. Seed with the most recent jobs.
  const recent = useQuery({
    queryKey: qkOps.jobFeed.recent,
    queryFn: ({ signal }) => api.get<JobOut[]>("/jobs", { limit: Math.max(recentLimit, 10) }, signal),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  useEffect(() => {
    if (recent.data) upsert(recent.data);
  }, [recent.data, upsert]);

  // 2. Live stream.
  const sse = useSSE(enabled ? "/jobs/stream" : null, {
    maxRetries: 20,
    events: {
      snapshot: (d) => {
        const jobs = (d as { jobs?: JobOut[] } | null)?.jobs;
        if (!Array.isArray(jobs)) return;
        upsert(jobs);
        reconcileActive(new Set(jobs.map((j) => j.id)));
      },
      progress: (d) => {
        const p = (d ?? {}) as ProgressPayload;
        if (!p.job_id) return;
        if (mapRef.current[p.job_id]) {
          patch(p.job_id, { progress: p.progress, message: p.message ?? undefined, status: p.status, eta_s: p.eta_s });
        } else {
          // A job we have not seen yet: show it at once (so the tray notices it start), then fill in
          // its title and kind.
          upsert([
            {
              id: p.job_id,
              kind: "job",
              title: "Background job",
              status: p.status ?? "queued",
              progress: p.progress ?? 0,
              message: p.message ?? null,
              params: {},
              created_at: new Date().toISOString(),
              eta_s: p.eta_s ?? null,
            },
          ]);
          refresh(p.job_id);
        }
      },
      done: (d) => {
        const p = (d ?? {}) as DonePayload;
        if (!p.job_id) return;
        patch(p.job_id, {
          status: p.status,
          result: p.result ?? null,
          error: p.error ?? null,
          message: p.message ?? undefined,
          eta_s: null,
          finished_at: new Date().toISOString(),
          ...(p.status === "succeeded" ? { progress: 1 } : {}),
        });
        refresh(p.job_id); // exact finished_at, result and log tail
      },
    },
  });
  const live = sse.status === "open";

  // 3. Polling fallback (and the only source for command-line jobs).
  const active = useQuery({
    queryKey: qkOps.jobFeed.active,
    queryFn: ({ signal }) => fetchActiveJobs(signal),
    enabled,
    refetchInterval: live ? 15_000 : 3_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  useEffect(() => {
    if (!active.data) return;
    upsert(active.data);
    reconcileActive(new Set(active.data.map((j) => j.id)));
  }, [active.data, upsert, reconcileActive]);

  // Invalidate affected pages when a job leaves the active states.
  const lastStatus = useRef(new Map<string, JobStatus>());
  useEffect(() => {
    for (const j of Object.values(map)) {
      const before = lastStatus.current.get(j.id);
      if (before !== undefined && isActive(before) && !isActive(j.status)) {
        invalidateForJob(qc, j.kind);
        qc.setQueryData(qk.jobs.one(j.id), (old: JobOut | undefined) => (old && isActive(old.status) ? { ...old, ...j } : old));
      }
      lastStatus.current.set(j.id, j.status);
    }
  }, [map, qc]);

  const { mutateAsync: cancelJob, error: cancelError, reset: clearCancelError } = useCancelJob();
  const cancel = useCallback(
    (id: string) =>
      cancelJob(id).then((job) => {
        upsert([job]);
        return job;
      }),
    [cancelJob, upsert],
  );

  const jobs = useMemo(() => orderJobs(Object.values(map), recentLimit), [map, recentLimit]);
  const connection: JobFeedConnection = live ? "live" : sse.status === "connecting" || sse.status === "reconnecting" ? "connecting" : "offline";

  return { jobs, connection, cancel, cancelError, clearCancelError };
}

/** Page in the app that shows a job's subject (used by the tray and its notifications). */
export function jobHref(job: { id: string; kind: string; params?: Record<string, unknown> | null; result?: Record<string, unknown> | null }): string | null {
  const params = job.params ?? {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  switch (job.kind) {
    case "build_dataset": {
      const id = num(params.dataset_id);
      return id !== null ? `/datasets?id=${id}` : "/datasets";
    }
    case "train":
    case "train_suite":
      return `/training?job=${encodeURIComponent(job.id)}`;
    case "evaluate": {
      const ev = num(job.result?.evaluation_id);
      const model = num(params.model_version_id);
      if (ev !== null) return `/evaluation?eval=${ev}`;
      return model !== null ? `/evaluation?model=${model}` : "/evaluation";
    }
    case "batch_predict":
      return "/candidates";
    case "catalog_refresh":
      return "/signals";
    case "download": {
      const kepid = num(params.kepid);
      return kepid !== null ? `/targets/${kepid}` : null;
    }
    default:
      return null;
  }
}
