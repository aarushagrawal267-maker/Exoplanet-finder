/**
 * Live progress of one background job (catalogue refresh, light-curve download, batch scoring…),
 * following `/api/jobs/{id}/events` with a polling fallback (see `useJob`). Shows status, progress
 * with ETA, the latest message, a cancel button while it runs, and the error or a short result
 * summary when it ends.
 */
import { CheckCircle2, OctagonAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { useCancelJob, useJob } from "@/api/endpoints/jobs";
import type { JobOut, JobStatus } from "@/api/schemas";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { cn } from "@/lib/cn";
import { formatDuration, formatInt, formatNumber, formatRelativeTime, toDate } from "@/lib/format";

export const JOB_STATUS: Record<JobStatus, { label: string; tone: BadgeTone }> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "cosmic" },
  succeeded: { label: "Done", tone: "planet" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "uncertain" },
};

/** Up to `max` scalar result fields, humanised ("n_scored" → "n scored"). */
export function resultSummary(result: Record<string, unknown> | null | undefined, max = 6): Array<{ key: string; label: string; value: string }> {
  if (!result) return [];
  const out: Array<{ key: string; label: string; value: string }> = [];
  for (const [key, v] of Object.entries(result)) {
    if (out.length >= max) break;
    let value: string | null = null;
    if (typeof v === "number" && Number.isFinite(v)) value = Number.isInteger(v) ? formatInt(v) : formatNumber(v, { digits: 2 });
    else if (typeof v === "string" && v.length <= 60) value = v;
    else if (typeof v === "boolean") value = v ? "yes" : "no";
    if (value !== null) out.push({ key, label: key.replace(/_/g, " "), value });
  }
  return out;
}

export interface JobProgressProps {
  jobId: string;
  /** The JobOut returned by the request that started the job (shown immediately). */
  initial?: JobOut | null;
  onDone?: (job: JobOut) => void;
  onDismiss?: () => void;
  /** Extra content under a successful job (e.g. "View results"). */
  successAction?: ReactNode;
  className?: string;
}

export function JobProgress({ jobId, initial, onDone, onDismiss, successAction, className }: JobProgressProps) {
  const { job, query, connection, active } = useJob(jobId, { onDone, initial });
  const cancel = useCancelJob();
  const st = job ? JOB_STATUS[job.status] : null;
  const elapsed = job?.started_at ? (Date.now() - toDate(job.started_at).getTime()) / 1000 : null;
  const summary = job?.status === "succeeded" ? resultSummary(job.result) : [];

  return (
    <section className={cn("rounded-lg border border-hairline-strong bg-space/70 p-4", className)} aria-label={`Job: ${job?.title ?? jobId}`} aria-busy={active}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow text-fg-secondary">{job ? job.kind.replace(/_/g, " ") : "Background job"}</div>
          <p className="mt-0.5 text-sm font-medium text-fg">{job?.title ?? "Starting…"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {st ? (
            <Badge tone={st.tone} dot>
              {st.label}
            </Badge>
          ) : null}
          {active && job ? (
            <Button size="sm" variant="ghost" icon={<X />} loading={cancel.isPending} onClick={() => cancel.mutate(jobId)} aria-label={`Cancel ${job.title}`}>
              <span className="hidden sm:inline">Cancel</span>
            </Button>
          ) : null}
          {!active && onDismiss ? (
            <Button size="sm" variant="ghost" iconOnly icon={<X />} onClick={onDismiss} aria-label="Dismiss job" />
          ) : null}
        </div>
      </div>

      {active ? (
        <ProgressBar
          className="mt-3"
          value={job && job.status === "running" ? job.progress : null}
          label={job?.message ?? (job?.status === "queued" ? "Waiting for a worker…" : "Working…")}
          etaSeconds={job?.eta_s ?? undefined}
          detail={elapsed !== null ? `${formatDuration(elapsed)} elapsed${connection === "open" ? " · live" : " · polling"}` : undefined}
        />
      ) : null}

      {job?.status === "succeeded" ? (
        <div className="mt-3 flex flex-col gap-2">
          <p className="flex items-center gap-1.5 text-sm text-fg">
            <CheckCircle2 className="size-4 text-signal-planet" aria-hidden="true" />
            {job.message && job.message !== "Completed" ? job.message : "Completed"}
            {job.finished_at ? <span className="text-xs text-fg-secondary">· {formatRelativeTime(job.finished_at)}</span> : null}
          </p>
          {summary.length ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
              {summary.map((s) => (
                <div key={s.key} className="flex min-w-0 justify-between gap-2 border-b border-hairline py-1">
                  <dt className="truncate text-fg-secondary">{s.label}</dt>
                  <dd className="num text-fg">{s.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {successAction}
        </div>
      ) : null}
      {job?.status === "failed" ? (
        <p className="mt-3 flex items-start gap-1.5 text-sm text-danger">
          <OctagonAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{job.error ?? job.message ?? "The job failed."}</span>
        </p>
      ) : null}
      {job?.status === "cancelled" ? <p className="mt-3 text-sm text-fg-secondary">Cancelled{job.message ? ` — ${job.message}` : ""}.</p> : null}
      {query.isError && !job ? <ApiErrorBanner className="mt-3" error={query.error} onRetry={() => void query.refetch()} /> : null}
      {cancel.isError ? <ApiErrorBanner className="mt-3" error={cancel.error} /> : null}
    </section>
  );
}
