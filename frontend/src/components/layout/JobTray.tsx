/**
 * Job tray: top-bar button + popover listing background jobs (catalogue refresh, downloads,
 * dataset builds, training, evaluation, batch prediction). Props-driven: the caller supplies jobs
 * (later fed by the `/api/jobs/stream` SSE feed) and the cancel handler.
 */
import { ListChecks, X } from "lucide-react";
import type { JobOut, JobStatus } from "@/api/types";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Popover } from "@/components/ui/Popover";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";

const STATUS: Record<JobStatus, { label: string; tone: BadgeTone }> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "cosmic" },
  succeeded: { label: "Done", tone: "planet" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "uncertain" },
};

export interface JobTrayProps {
  jobs: JobOut[];
  onCancel?: (jobId: string) => void;
  onOpenJob?: (job: JobOut) => void;
  /** Live-feed connection state; shown in the panel footer. */
  connection?: "live" | "connecting" | "offline";
  className?: string;
}

function ProgressRing({ value }: { value: number }) {
  const r = 8;
  const c = 2 * Math.PI * r;
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="-rotate-90">
      <circle cx="10" cy="10" r={r} fill="none" stroke="var(--c-hairline-strong)" strokeWidth="2" />
      <circle cx="10" cy="10" r={r} fill="none" stroke="var(--c-cosmic)" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${c * Math.min(1, Math.max(0, value))} ${c}`} />
    </svg>
  );
}

export function JobTray({ jobs, onCancel, onOpenJob, connection, className }: JobTrayProps) {
  const active = jobs.filter((j) => j.status === "running" || j.status === "queued");
  const running = jobs.filter((j) => j.status === "running");
  const meanProgress = running.length ? running.reduce((s, j) => s + (j.progress ?? 0), 0) / running.length : 0;
  const label = active.length ? `Background jobs: ${active.length} active` : "Background jobs";

  return (
    <Popover
      label="Background jobs"
      width={380}
      className={className}
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-label={label}
          className="relative flex h-9 items-center gap-2 rounded-md px-2.5 text-fg-secondary transition-colors hover:bg-fg/[0.06] hover:text-fg aria-expanded:bg-fg/[0.06] aria-expanded:text-fg"
        >
          {running.length ? <ProgressRing value={meanProgress} /> : <ListChecks className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />}
          <span className="hidden text-sm lg:inline">Jobs</span>
          {active.length ? (
            <span className="num flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-cosmic px-1 text-[11px] font-medium text-void">
              {active.length}
            </span>
          ) : null}
        </button>
      )}
    >
      {(close) => (
        <div className="flex max-h-[min(480px,70vh)] flex-col">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-fg">Background jobs</h2>
              <p className="text-xs text-fg-secondary">
                <span className="num">{active.length}</span> active · <span className="num">{jobs.length - active.length}</span> finished
              </p>
            </div>
            <button type="button" onClick={close} aria-label="Close jobs panel" className="flex size-7 items-center justify-center rounded-md text-fg-secondary hover:bg-fg/[0.06] hover:text-fg">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          {jobs.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-fg">No background jobs</p>
              <p className="mt-1 text-xs text-fg-secondary">Catalogue refreshes, downloads, dataset builds and training runs appear here while they run.</p>
            </div>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-hairline overflow-y-auto">
              {jobs.map((job) => {
                const st = STATUS[job.status];
                const live = job.status === "running" || job.status === "queued";
                return (
                  <li key={job.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={onOpenJob ? () => onOpenJob(job) : undefined}
                        disabled={!onOpenJob}
                        className={cn("min-w-0 text-left", onOpenJob && "hover:underline")}
                      >
                        <span className="block truncate text-sm font-medium text-fg">{job.title}</span>
                        <span className="eyebrow mt-0.5 block text-fg-secondary">
                          {job.kind.replace(/_/g, " ")} · <span className="normal-case tracking-normal">{formatRelativeTime(job.started_at ?? job.created_at)}</span>
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge tone={st.tone} dot>
                          {st.label}
                        </Badge>
                        {live && onCancel ? (
                          <button
                            type="button"
                            onClick={() => onCancel(job.id)}
                            aria-label={`Cancel ${job.title}`}
                            className="flex size-6 items-center justify-center rounded-sm text-fg-secondary hover:bg-danger/10 hover:text-danger"
                          >
                            <X className="size-3.5" aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {job.status === "running" ? (
                      <ProgressBar className="mt-2.5" size="sm" value={job.progress} etaSeconds={job.eta_s ?? undefined} detail={job.message ?? undefined} showPercent={false} />
                    ) : job.status === "failed" && job.error ? (
                      <p className="mt-1.5 line-clamp-2 text-xs text-danger">{job.error}</p>
                    ) : job.message ? (
                      <p className="mt-1.5 truncate text-xs text-fg-secondary">{job.message}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {connection ? (
            <div className="flex items-center gap-1.5 border-t border-hairline px-4 py-2 text-xs text-fg-secondary">
              <span className={cn("size-1.5 rounded-full", connection === "live" ? "bg-cosmic" : connection === "connecting" ? "bg-warn" : "bg-fg-muted")} aria-hidden="true" />
              {connection === "live" ? "Live updates" : connection === "connecting" ? "Connecting to job feed…" : "Job feed offline"}
            </div>
          ) : null}
        </div>
      )}
    </Popover>
  );
}
