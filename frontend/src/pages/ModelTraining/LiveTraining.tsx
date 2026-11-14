/**
 * Live view of a training job (`train` or `train_suite`): progress with ETA, per-epoch training
 * and validation loss and validation PR-AUC / ROC-AUC curves fed by the job's SSE `epoch` events
 * (falling back to polling the experiment's stored epochs), the log tail, and cancel. When the job
 * ends it summarises each model's validation metrics with links to evaluate it.
 */
import { CheckCircle2, ExternalLink, Gauge, OctagonAlert, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useExperiment } from "@/api/endpoints/experiments";
import { useCancelJob, useJob } from "@/api/endpoints/jobs";
import type { JobOut } from "@/api/schemas";
import type { EpochOut } from "@/api/schemasOps";
import { TrainingCurves, type EpochPoint } from "@/components/charts/TrainingCurves";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ChartSkeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { formatDuration, formatInt } from "@/lib/format";
import { EpochChart, MetricTile, StatusBadge } from "../_ops/components";
import { apiDate, isBaseline, metricOf, modelTypeLabel } from "../_ops/metrics";

interface EpochEvent {
  experiment_id?: number;
  model_type?: string;
  member?: number;
  epoch?: number;
  global_epoch?: number;
  train_loss?: number | null;
  val_loss?: number | null;
  val_pr_auc?: number | null;
  val_roc_auc?: number | null;
  val_accuracy?: number | null;
  best_epoch?: number | null;
  n_members?: number;
  max_epochs?: number;
}

interface LiveState {
  points: Record<number, EpochPoint & { val_accuracy?: number | null }>;
  maxEpochs?: number;
  members?: number;
  bestGlobal?: number | null;
}

/** Experiment ids of a training job (`params.experiment_id` or `params.experiment_ids`). */
export function experimentIdsOfJob(job: Pick<JobOut, "params"> | null | undefined): number[] {
  const p = job?.params ?? {};
  if (Array.isArray(p.experiment_ids)) return (p.experiment_ids as unknown[]).filter((x): x is number => typeof x === "number");
  return typeof p.experiment_id === "number" ? [p.experiment_id] : [];
}

/** Merge stored epochs (polling) with live SSE epochs; live values win for the same epoch. */
export function mergeEpochs(stored: EpochOut[] | undefined, live: LiveState["points"] | undefined): EpochPoint[] {
  const out = new Map<number, EpochPoint>();
  for (const e of stored ?? []) out.set(e.epoch, { epoch: e.epoch, train_loss: e.train_loss, val_loss: e.val_loss, val_pr_auc: e.val_pr_auc, val_roc_auc: e.val_roc_auc });
  for (const [k, p] of Object.entries(live ?? {})) out.set(Number(k), { ...out.get(Number(k)), ...p });
  return [...out.values()].sort((a, b) => a.epoch - b.epoch);
}

function LogTail({ base, live }: { base: string | null | undefined; live: string[] }) {
  const lines = useMemo(() => {
    const b = (base ?? "").split("\n").filter(Boolean);
    const seen = new Set(b);
    return [...b, ...live.filter((l) => !seen.has(l))].slice(-200);
  }, [base, live]);
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  return (
    <details className="group" open>
      <summary className="eyebrow cursor-pointer text-fg-secondary hover:text-fg">Log ({lines.length} lines)</summary>
      <pre ref={ref} tabIndex={0} aria-label="Training log" className="num mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-hairline bg-void p-3 text-2xs leading-5 text-fg-secondary">
        {lines.length ? lines.join("\n") : "No log lines yet."}
      </pre>
    </details>
  );
}

function ExperimentCurves({ id, live, running }: { id: number; live: LiveState | undefined; running: boolean }) {
  const exp = useExperiment(id);
  const e = exp.data;
  const points = mergeEpochs(e?.epochs, live?.points);
  const cfg = (e?.config ?? {}) as Record<string, unknown>;
  const maxEpochs = (live?.maxEpochs ?? (typeof cfg.max_epochs === "number" ? cfg.max_epochs : undefined)) ?? undefined;
  const members = live?.members ?? (typeof cfg.ensemble_size === "number" ? cfg.ensemble_size : 1);
  const best = e?.best_epoch ?? live?.bestGlobal ?? null;
  const baseline = isBaseline(e?.model_type);
  const vm = (e?.val_metrics ?? {}) as Record<string, unknown>;

  if (exp.isError) return <ApiErrorBanner error={exp.error} onRetry={() => void exp.refetch()} />;
  if (!e) return <ChartSkeleton height={220} label="Loading training curves" />;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2 text-sm text-fg-secondary">
        <StatusBadge status={e.status} />
        <span>{e.name}</span>
        {e.model_version_id ? <Badge tone="nebula">model #{e.model_version_id}</Badge> : null}
        {e.epochs_run ? (
          <span className="num">
            {formatInt(e.epochs_run)} epochs run{e.best_epoch ? ` · best ${e.best_epoch}` : ""}
          </span>
        ) : null}
        {e.duration_s ? <span className="num">· {formatDuration(e.duration_s)}</span> : null}
      </div>
      {baseline ? (
        <p className="text-sm text-fg-secondary">
          {running && !points.length
            ? "Grid search with grouped cross-validation on the training split… baselines fit in one step, so there are no epoch curves."
            : "Baselines fit in one step (grid search with grouped cross-validation), so there are no epoch curves; the validation metrics are below."}
        </p>
      ) : points.length ? (
        <>
          <TrainingCurves history={points} bestEpoch={best} maxEpochs={maxEpochs ? maxEpochs * members : undefined} />
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <EpochChart series={[{ id: String(id), label: e.name, modelType: e.model_type, points }]} metric="val_roc_auc" height={180} />
          </div>
          {members > 1 ? <p className="text-xs text-fg-secondary">Ensemble of {members} members: their epochs are numbered one after the other.</p> : null}
        </>
      ) : (
        <p className="text-sm text-fg-secondary">{running ? "Waiting for the first epoch…" : "No epochs were recorded."}</p>
      )}
      {e.status === "succeeded" ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow text-fg-secondary">Validation metrics</span>
            <Badge tone="uncertain">optimistic: threshold and calibration tuned on validation</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {["pr_auc", "roc_auc", "f1", "ece"].map((k) => (
              <MetricTile key={k} metric={k} value={metricOf(vm, k)} emphasis={k === "pr_auc"} />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {e.model_version_id ? (
              <Link to={`/evaluation?model=${e.model_version_id}`} className={buttonClasses({ variant: "model", size: "sm" })}>
                <Gauge aria-hidden="true" /> Evaluate this model
              </Link>
            ) : null}
            <Link to={`/experiments?id=${e.id}`} className={buttonClasses({ variant: "ghost", size: "sm" })}>
              Experiment details <ExternalLink aria-hidden="true" />
            </Link>
          </div>
        </div>
      ) : null}
      {e.status === "failed" && e.error ? (
        <p className="flex items-start gap-1.5 text-sm text-danger">
          <OctagonAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {e.error}
        </p>
      ) : null}
    </div>
  );
}

export interface LiveTrainingProps {
  jobId: string;
  initial?: JobOut | null;
  onDismiss: () => void;
}

export function LiveTraining({ jobId, initial, onDismiss }: LiveTrainingProps) {
  const [live, setLive] = useState<Record<number, LiveState>>({});
  const [logLines, setLogLines] = useState<string[]>([]);
  const { job, query, connection, active } = useJob(jobId, {
    initial,
    events: {
      epoch: (d) => {
        const ev = (d ?? {}) as EpochEvent;
        const id = ev.experiment_id;
        const g = ev.global_epoch ?? ev.epoch;
        if (typeof id !== "number" || typeof g !== "number") return;
        setLive((prev) => {
          const cur = prev[id] ?? { points: {} };
          const offset = typeof ev.epoch === "number" ? g - ev.epoch : 0;
          return {
            ...prev,
            [id]: {
              points: { ...cur.points, [g]: { epoch: g, train_loss: ev.train_loss, val_loss: ev.val_loss, val_pr_auc: ev.val_pr_auc, val_roc_auc: ev.val_roc_auc, val_accuracy: ev.val_accuracy } },
              maxEpochs: ev.max_epochs ?? cur.maxEpochs,
              members: ev.n_members ?? cur.members,
              bestGlobal: typeof ev.best_epoch === "number" ? offset + ev.best_epoch : cur.bestGlobal,
            },
          };
        });
      },
      log: (d) => {
        const line = (d as { line?: unknown } | null)?.line;
        if (typeof line === "string") setLogLines((l) => [...l.slice(-300), line]);
      },
    },
  });
  const cancel = useCancelJob();
  const ids = experimentIdsOfJob(job);
  const [tab, setTab] = useState<string | null>(null);
  // Follow the experiment being trained in a suite unless the user picked a tab.
  const current = useMemo(() => {
    const ids2 = Object.keys(live).map(Number);
    return ids2.length ? Math.max(...ids2) : ids[0];
  }, [live, ids]);
  const shown = tab !== null ? Number(tab) : current;
  const started = apiDate(job?.started_at);
  const elapsed = started && active ? (Date.now() - started.getTime()) / 1000 : null;

  return (
    <Card aria-label="Training progress" aria-busy={active}>
      <CardHeader
        eyebrow={job ? (job.kind === "train_suite" ? "Training suite" : "Training run") : "Training job"}
        title={job?.title ?? "Starting…"}
        actions={
          <>
            {job ? <StatusBadge status={job.status} /> : null}
            {active ? (
              <Button size="sm" variant="danger" icon={<X />} loading={cancel.isPending} onClick={() => cancel.mutate(jobId)}>
                Cancel
              </Button>
            ) : (
              <Button size="sm" variant="ghost" iconOnly icon={<X />} aria-label="Close training view" onClick={onDismiss} />
            )}
          </>
        }
      />
      <div className="flex flex-col gap-5">
        {active ? (
          <ProgressBar
            tone="model"
            value={job?.status === "running" ? job.progress : null}
            label={job?.message ?? (job?.status === "queued" ? "Queued: waiting for the training worker…" : "Working…")}
            etaSeconds={job?.eta_s ?? undefined}
            detail={elapsed !== null ? `${formatDuration(elapsed)} elapsed · ${connection === "open" ? "live" : "polling"}` : undefined}
          />
        ) : null}
        {job?.status === "succeeded" ? (
          <p className="flex items-center gap-1.5 text-sm text-fg">
            <CheckCircle2 className="size-4 text-signal-planet" aria-hidden="true" /> Training finished
            {job.finished_at ? <span className="text-fg-secondary">· {formatDuration(((apiDate(job.finished_at)?.getTime() ?? 0) - (started?.getTime() ?? 0)) / 1000)}</span> : null}
          </p>
        ) : null}
        {job?.status === "failed" ? (
          <p className="flex items-start gap-1.5 text-sm text-danger">
            <OctagonAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">{job.error ?? "The training job failed."}</span>
          </p>
        ) : null}
        {job?.status === "cancelled" ? <p className="text-sm text-fg-secondary">Training was cancelled; no model was registered for unfinished runs.</p> : null}
        {cancel.isError ? <ApiErrorBanner error={cancel.error} /> : null}
        {query.isError && !job ? <ApiErrorBanner error={query.error} onRetry={() => void query.refetch()} /> : null}

        {ids.length > 1 ? (
          <Tabs
            aria-label="Models in this suite"
            value={String(shown)}
            onChange={setTab}
            items={ids.map((id, i) => ({
              id: String(id),
              label: `${i + 1}. ${modelTypeLabel(((job?.params?.model_types as string[] | undefined) ?? [])[i])}`,
              content: shown === id ? <ExperimentCurves id={id} live={live[id]} running={active} /> : null,
            }))}
          />
        ) : ids[0] !== undefined ? (
          <ExperimentCurves id={ids[0]} live={live[ids[0]]} running={active} />
        ) : null}
        <LogTail base={job?.log_tail} live={logLines} />
      </div>
    </Card>
  );
}
