/**
 * Job tray: top-bar button + popover listing background jobs (catalogue refresh, downloads,
 * dataset builds, training, evaluation, batch prediction), plus toast notifications when a job
 * finishes or fails.
 *
 * Props-driven: the caller supplies the jobs (in the app: `useJobFeed`, which follows the
 * `/api/jobs/stream` SSE feed with a polling fallback) and the cancel handler. Each job links to
 * the page that shows its subject (`jobHref`). A notification is raised whenever a job seen in an
 * active state (queued / running) arrives in a final one; failures stay until dismissed and show
 * the error text.
 */
import { ArrowRight, CheckCircle2, CircleSlash2, ListChecks, OctagonAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useInRouterContext } from "react-router-dom";
import { jobHref, parseApiTime } from "@/api/endpoints/jobStream";
import type { JobOut, JobStatus } from "@/api/types";
import { errorParts } from "@/components/ui/ApiErrorBanner";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Portal } from "@/components/ui/overlay";
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

const KIND_LABEL: Record<string, string> = {
  build_dataset: "dataset build",
  train: "training",
  train_suite: "training suite",
  evaluate: "evaluation",
  batch_predict: "batch prediction",
  catalog_refresh: "catalogue refresh",
  download: "light-curve download",
};

const isActive = (s: JobStatus) => s === "running" || s === "queued";
const kindLabel = (kind: string) => KIND_LABEL[kind] ?? kind.replace(/_/g, " ");
const when = (iso: string | null | undefined) => (iso ? formatRelativeTime(new Date(parseApiTime(iso))) : "");

export interface JobTrayProps {
  jobs: JobOut[];
  /** Cancel a job. May return a promise: a rejection is shown in the panel (e.g. a 409). */
  onCancel?: (jobId: string) => void | Promise<unknown>;
  /** Custom "open" action; by default each job links to its page (inside a router). */
  onOpenJob?: (job: JobOut) => void;
  /** Live-feed connection state; shown in the panel footer. */
  connection?: "live" | "connecting" | "offline";
  /** Raise toast notifications when jobs finish (default true). */
  notify?: boolean;
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

/** Router link when a router is mounted (always in the app), plain text otherwise (isolated tests). */
function JobLink({ to, className, children, onClick }: { to: string | null; className?: string; children: ReactNode; onClick?: () => void }) {
  const inRouter = useInRouterContext();
  if (!to || !inRouter) return <span className={className}>{children}</span>;
  return (
    <Link to={to} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}

// ------------------------------------------------------------------------------------------------
// Notifications
// ------------------------------------------------------------------------------------------------
interface Toast {
  key: string;
  job: JobOut;
}

const TOAST_TTL: Partial<Record<JobStatus, number>> = { succeeded: 9_000, cancelled: 6_000 };

/** Track job statuses across renders; return jobs that moved from active to a final state. */
function useFinishedTransitions(jobs: JobOut[], enabled: boolean): [Toast[], (key: string) => void] {
  const seen = useRef(new Map<string, JobStatus>());
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const fresh: Toast[] = [];
    for (const job of jobs) {
      const before = seen.current.get(job.id);
      if (before !== undefined && isActive(before) && !isActive(job.status)) fresh.push({ key: `${job.id}:${job.status}`, job });
      seen.current.set(job.id, job.status);
    }
    if (fresh.length) setToasts((t) => [...t.filter((x) => !fresh.some((f) => f.key === x.key)), ...fresh].slice(-4));
  }, [jobs, enabled]);
  // Keep toasts in sync with later updates of the same job (e.g. its error text arriving).
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const live = toasts.map((t) => ({ ...t, job: byId.get(t.job.id) ?? t.job }));
  const dismiss = useCallback((key: string) => setToasts((t) => t.filter((x) => x.key !== key)), []);
  return [live, dismiss];
}

function JobToast({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const { job } = toast;
  const ttl = TOAST_TTL[job.status];
  // The parent re-renders on every job update: keep the timer independent of callback identity.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (!ttl) return undefined;
    const id = window.setTimeout(() => dismissRef.current(), ttl);
    return () => window.clearTimeout(id);
  }, [ttl, toast.key]);
  const href = jobHref(job);
  const failed = job.status === "failed";
  const icon =
    job.status === "succeeded" ? (
      <CheckCircle2 className="size-4 text-signal-planet" aria-hidden="true" />
    ) : failed ? (
      <OctagonAlert className="size-4 text-danger" aria-hidden="true" />
    ) : (
      <CircleSlash2 className="size-4 text-signal-uncertain" aria-hidden="true" />
    );
  const headline = job.status === "succeeded" ? "Finished" : failed ? "Failed" : "Cancelled";
  return (
    <li
      role={failed ? "alert" : undefined}
      className={cn(
        "card-surface pointer-events-auto flex animate-rise-in items-start gap-3 bg-surface-raised p-3 shadow-[0_16px_48px_-12px_rgb(0_0_0/0.7)]",
        failed && "border-danger/40",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-fg">
          <span className="font-semibold">{headline}</span>
          <span className="text-fg-secondary"> · {kindLabel(job.kind)}</span>
        </p>
        <p className="truncate text-fg-secondary" title={job.title}>
          {job.title}
        </p>
        {failed && (job.error || job.message) ? <p className="mt-1 line-clamp-4 break-words text-xs text-danger">{job.error ?? job.message}</p> : null}
        {href ? (
          <JobLink to={href} onClick={onDismiss} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-cosmic hover:underline">
            Open <ArrowRight className="size-3" aria-hidden="true" />
          </JobLink>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="-mr-1 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-md text-fg-secondary hover:bg-fg/[0.06] hover:text-fg"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </li>
  );
}

function ToastRegion({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (key: string) => void }) {
  return (
    <Portal>
      <ol
        aria-label="Job notifications"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col gap-2 sm:left-auto sm:w-[360px]"
      >
        {toasts.map((t) => (
          <JobToast key={t.key} toast={t} onDismiss={() => onDismiss(t.key)} />
        ))}
      </ol>
    </Portal>
  );
}

// ------------------------------------------------------------------------------------------------
// Tray
// ------------------------------------------------------------------------------------------------
export function JobTray({ jobs, onCancel, onOpenJob, connection, notify = true, className }: JobTrayProps) {
  const active = jobs.filter((j) => isActive(j.status));
  const running = jobs.filter((j) => j.status === "running");
  const meanProgress = running.length ? running.reduce((s, j) => s + (j.progress ?? 0), 0) / running.length : 0;
  const label = active.length ? `Background jobs: ${active.length} active` : "Background jobs";
  const [toasts, dismiss] = useFinishedTransitions(jobs, notify);
  const [cancelError, setCancelError] = useState<{ id: string; error: unknown } | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const requestCancel = (id: string) => {
    if (!onCancel) return;
    setCancelError(null);
    const out: unknown = onCancel(id);
    if (out && typeof (out as Promise<unknown>).then === "function") {
      setCancelling(id);
      (out as Promise<unknown>).catch((error: unknown) => setCancelError({ id, error })).finally(() => setCancelling(null));
    }
  };

  return (
    <>
      <Popover
        label="Background jobs"
        width={400}
        // Phones: span the viewport under the top bar instead of hanging off the trigger's edge.
        // (Mobile-first: the Tailwind config's raw `short` screen disables `max-*` variants.)
        className={cn("fixed inset-x-3 top-[60px] !w-auto sm:absolute sm:left-auto sm:right-0 sm:top-full sm:!w-[400px]", className)}
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
          <div className="flex max-h-[min(520px,75vh)] flex-col">
            <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-fg">Background jobs</h2>
                <p className="text-xs text-fg-secondary">
                  <span className="num">{active.length}</span> active · <span className="num">{jobs.length - active.length}</span> recent
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
                  const live = isActive(job.status);
                  const href = onOpenJob ? null : jobHref(job);
                  const titleClass = "block truncate text-sm font-medium text-fg";
                  const err = cancelError?.id === job.id ? errorParts(cancelError.error) : null;
                  return (
                    <li key={job.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          {onOpenJob ? (
                            <button type="button" onClick={() => onOpenJob(job)} className={cn("max-w-full text-left hover:underline", titleClass)}>
                              {job.title}
                            </button>
                          ) : (
                            <JobLink to={href} onClick={close} className={cn(titleClass, href && "hover:underline")}>
                              {job.title}
                            </JobLink>
                          )}
                          <span className="eyebrow mt-0.5 block text-fg-secondary">
                            {kindLabel(job.kind)} · <span className="normal-case tracking-normal">{when(live ? (job.started_at ?? job.created_at) : (job.finished_at ?? job.created_at))}</span>
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Badge tone={st.tone} dot>
                            {st.label}
                          </Badge>
                          {live && onCancel ? (
                            <button
                              type="button"
                              onClick={() => requestCancel(job.id)}
                              disabled={cancelling === job.id}
                              aria-label={`Cancel ${job.title}`}
                              className="flex size-7 items-center justify-center rounded-sm text-fg-secondary hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                            >
                              <X className="size-3.5" aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {job.status === "running" ? (
                        <ProgressBar
                          className="mt-2.5"
                          size="sm"
                          value={job.progress}
                          label={job.message ?? undefined}
                          etaSeconds={job.eta_s ?? undefined}
                          showPercent
                        />
                      ) : job.status === "queued" ? (
                        <ProgressBar className="mt-2.5" size="sm" value={null} label="Waiting for a worker…" showPercent={false} />
                      ) : job.status === "failed" && (job.error || job.message) ? (
                        <p className="mt-1.5 line-clamp-3 break-words text-xs text-danger">{job.error ?? job.message}</p>
                      ) : job.message ? (
                        <p className="mt-1.5 truncate text-xs text-fg-secondary">{job.message}</p>
                      ) : null}
                      {err ? (
                        <p role="alert" className="mt-1.5 text-xs text-danger">
                          {err.detail}
                          {err.hint ? <span className="block text-fg-secondary">{err.hint}</span> : null}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {connection ? (
              <div className="flex items-center gap-1.5 border-t border-hairline px-4 py-2 text-xs text-fg-secondary">
                <span className={cn("size-1.5 rounded-full", connection === "live" ? "bg-cosmic" : connection === "connecting" ? "bg-warn" : "bg-fg-muted")} aria-hidden="true" />
                {connection === "live" ? "Live updates" : connection === "connecting" ? "Connecting to job feed…" : "Live stream unavailable — updating by polling"}
              </div>
            ) : null}
          </div>
        )}
      </Popover>
      {notify && toasts.length ? <ToastRegion toasts={toasts} onDismiss={dismiss} /> : null}
    </>
  );
}
