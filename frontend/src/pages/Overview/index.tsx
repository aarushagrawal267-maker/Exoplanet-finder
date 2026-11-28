/**
 * Overview — hero introduction, live system status from `/api/system/summary` (catalogue, light
 * curves, datasets, the model used for predictions, recent predictions, running jobs), the setup
 * checklist with actions, and quick links. Every number comes from the API; nothing is invented.
 */
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, BookOpen, CircleCheck, Cpu, Database, History, RefreshCw, Telescope } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useRefreshCatalog } from "@/api/endpoints/catalog";
import { qk } from "@/api/endpoints/keys";
import { useSystemSummary } from "@/api/endpoints/system";
import type { JobOut, ModelBrief, NextStep, SystemSummaryOut } from "@/api/schemas";
import { DipRule } from "@/components/brand/Dip";
import { TransitDiagram } from "@/components/brand/TransitDiagram";
import { JobProgress } from "@/components/jobs/JobProgress";
import { predictionModel } from "@/components/layout/useSystemStatus";
import { CATEGORY_INFO, CATEGORY_ORDER } from "@/components/science/CatalogueLabels";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { ClassBadge } from "@/components/ui/ClassBadge";
import { ErrorState } from "@/components/ui/ErrorState";
import { ProvenanceChip } from "@/components/ui/ProvenanceChip";
import { Readout } from "@/components/ui/Readout";
import { Section } from "@/components/ui/Section";
import { Skeleton } from "@/components/ui/Skeleton";
import { Stepper, type Step } from "@/components/ui/Stepper";
import { cn } from "@/lib/cn";
import { formatBytes, formatDateTime, formatInt, formatPercent, formatProbability, formatRelativeTime } from "@/lib/format";
import { predictionClass } from "../_shared/prediction";

/** Where each checklist step is done in the UI (summary `page` → route). */
const STEP_LINKS: Record<string, { path: string; label: string }> = {
  refresh_catalog: { path: "/signals", label: "Browse the catalogue" },
  download_lightcurves: { path: "/signals?lc=no", label: "Find stars to download" },
  build_dataset: { path: "/datasets", label: "Open Dataset Explorer" },
  train_model: { path: "/training", label: "Open Model Training" },
  evaluate_model: { path: "/evaluation", label: "Open Model Evaluation" },
  run_prediction: { path: "/detect", label: "Open Planet Detection" },
};

const QUICK_LINKS = [
  { path: "/signals", title: "Signal Explorer", body: "Filter 20,000+ catalogue signals, view light curves." },
  { path: "/transit", title: "Transit Analysis", body: "BLS periodogram, transit fit, odd/even and secondary checks." },
  { path: "/detect", title: "Planet Detection", body: "Score a signal or your own light curve with trained models." },
  { path: "/candidates", title: "Candidate Explorer", body: "Rank unconfirmed candidates as research leads." },
  { path: "/datasets", title: "Dataset Explorer", body: "Build labelled datasets with star-level splits." },
  { path: "/docs", title: "Research Docs", body: "Methodology, data sources and limitations." },
] as const;

const METRICS: Array<{ key: string; label: string }> = [
  { key: "pr_auc", label: "PR-AUC" },
  { key: "roc_auc", label: "ROC-AUC" },
  { key: "f1", label: "F1" },
  { key: "precision", label: "Precision" },
  { key: "recall", label: "Recall" },
];

function metric(m: Record<string, unknown> | undefined, key: string): number | null {
  const v = m?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function useCatalogRefresh() {
  const qc = useQueryClient();
  const refresh = useRefreshCatalog();
  const [job, setJob] = useState<JobOut | null>(null);
  const start = () => refresh.mutate(null, { onSuccess: (j) => setJob(j) });
  const onDone = () => {
    void qc.invalidateQueries({ queryKey: qk.system.all });
    void qc.invalidateQueries({ queryKey: qk.catalog.all });
  };
  return { refresh, job, setJob, start, onDone };
}

function StatusCard({ icon, eyebrow, title, children, footer, className }: { icon: ReactNode; eyebrow: string; title?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="mb-4 flex items-center gap-2 text-fg-secondary [&_svg]:size-4">
        {icon}
        <span className="eyebrow">{eyebrow}</span>
      </div>
      {title ? <div className="mb-3">{title}</div> : null}
      <div className="flex-1">{children}</div>
      {footer ? <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">{footer}</div> : null}
    </Card>
  );
}

function CatalogueCard({ s, refresh }: { s: SystemSummaryOut; refresh: ReturnType<typeof useCatalogRefresh> }) {
  const c = s.catalog;
  const runningRefresh = s.running_jobs.find((j) => j.kind === "catalog_refresh");
  const jobToShow = refresh.job ?? runningRefresh ?? null;
  const max = Math.max(1, ...CATEGORY_ORDER.map((k) => c.by_category[k] ?? 0));
  return (
    <StatusCard
      icon={<Telescope aria-hidden="true" />}
      eyebrow="NASA catalogue"
      title={
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <Readout label="Signals" value={formatInt(c.n_signals)} provenance="catalogue" provenanceSource="DR24 TCE + KOI cumulative + confirmed planets" />
          <Readout label="Stars" value={formatInt(c.n_targets)} size="sm" />
        </div>
      }
      footer={
        jobToShow ? null : (
          <>
            <Button size="sm" variant="secondary" icon={<RefreshCw />} loading={refresh.refresh.isPending} onClick={refresh.start}>
              Refresh catalogue
            </Button>
            <span className="text-xs text-fg-secondary">{c.last_refresh ? `Snapshot ${formatRelativeTime(c.last_refresh)}` : "Never refreshed"}</span>
          </>
        )
      }
    >
      <ul className="flex flex-col gap-2" aria-label="Signals by catalogue category">
        {CATEGORY_ORDER.map((k) => {
          const n = c.by_category[k] ?? 0;
          const info = CATEGORY_INFO[k];
          return (
            <li key={k} className="grid grid-cols-[110px_minmax(0,1fr)_64px] items-center gap-3 text-sm">
              <span className="text-fg-secondary">{info?.label ?? k}</span>
              <span className="h-1.5 rounded-full bg-hairline" aria-hidden="true">
                <span
                  className={cn("block h-full rounded-full", k === "confirmed" ? "bg-signal-planet" : k === "false_positive" ? "bg-signal-fp" : k === "candidate" ? "bg-cosmic" : "bg-signal-uncertain")}
                  style={{ width: `${(n / max) * 100}%` }}
                />
              </span>
              <span className="num text-right text-fg">{formatInt(n)}</span>
            </li>
          );
        })}
      </ul>
      {c.label_conflicts ? (
        <p className="mt-3 text-xs text-fg-secondary">
          <span className="num text-warn">{formatInt(c.label_conflicts)}</span> signals where the DR24 Autovetter label and the KOI disposition disagree.
        </p>
      ) : null}
      {jobToShow ? <JobProgress className="mt-4" jobId={jobToShow.id} initial={jobToShow} onDone={refresh.onDone} onDismiss={() => refresh.setJob(null)} /> : null}
      {refresh.refresh.isError ? <ApiErrorBanner className="mt-3" error={refresh.refresh.error} /> : null}
    </StatusCard>
  );
}

function LightCurveCard({ s }: { s: SystemSummaryOut }) {
  const l = s.lightcurves;
  const total = l.available + l.not_downloaded + l.queued + l.downloading + l.no_data + l.error;
  return (
    <StatusCard
      icon={<Database aria-hidden="true" />}
      eyebrow="Light curves"
      title={<Readout label="Stars cached" value={formatInt(l.available)} caption={total ? `${formatPercent(l.available / total, { digits: 0 })} of ${formatInt(total)} stars · ${formatBytes(l.disk_bytes)}` : formatBytes(l.disk_bytes)} />}
      footer={
        <Link to="/signals?lc=no" className={buttonClasses({ variant: "ghost", size: "sm" })}>
          Find stars to download <ArrowRight aria-hidden="true" />
        </Link>
      }
    >
      <dl className="flex flex-col gap-1.5 text-sm">
        {[
          ["Not downloaded", l.not_downloaded],
          ["Queued", l.queued],
          ["Downloading", l.downloading],
          ["No Kepler data", l.no_data],
          ["Failed", l.error],
        ].map(([label, n]) => (
          <div key={label as string} className="flex justify-between gap-2 border-b border-hairline pb-1.5">
            <dt className="text-fg-secondary">{label}</dt>
            <dd className={cn("num", (label === "Failed" && (n as number) > 0) ? "text-danger" : "text-fg")}>{formatInt(n as number)}</dd>
          </div>
        ))}
      </dl>
    </StatusCard>
  );
}

function DatasetCard({ s }: { s: SystemSummaryOut }) {
  const d = s.datasets;
  return (
    <StatusCard
      icon={<Database aria-hidden="true" />}
      eyebrow="Datasets"
      title={<Readout label="Ready" value={`${formatInt(d.n_ready)} / ${formatInt(d.count)}`} caption="built datasets" />}
      footer={
        <Link to="/datasets" className={buttonClasses({ variant: "ghost", size: "sm" })}>
          Dataset Explorer <ArrowRight aria-hidden="true" />
        </Link>
      }
    >
      {d.latest ? (
        <div className="text-sm">
          <div className="eyebrow mb-1 text-fg-secondary">Latest</div>
          <p className="font-medium text-fg">{d.latest.name}</p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-fg-secondary">
            <Badge tone={d.latest.status === "ready" ? "planet" : d.latest.status === "failed" ? "danger" : "warn"} dot>
              {d.latest.status}
            </Badge>
            <span className="num">{d.latest.tier}</span>·<span className="num">{d.latest.label_mode}</span>·
            <span className="num">{formatInt(d.latest.n_examples)} examples</span>
          </p>
        </div>
      ) : (
        <p className="text-sm text-fg-secondary">No dataset yet. Build one from labelled catalogue signals to train models.</p>
      )}
    </StatusCard>
  );
}

function ModelCard({ s }: { s: SystemSummaryOut }) {
  const m: ModelBrief | null = predictionModel(s);
  const test = m?.test_metrics && Object.keys(m.test_metrics).length ? m.test_metrics : null;
  const shown = test ?? (m?.val_metrics && Object.keys(m.val_metrics).length ? m.val_metrics : null);
  return (
    <StatusCard
      icon={<Cpu aria-hidden="true" />}
      eyebrow="Model for predictions"
      title={
        m ? (
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-md font-medium text-fg">
              {m.name}
              <ProvenanceChip kind="model" size="xs" />
            </p>
            <p className="mt-1 text-xs text-fg-secondary">
              <span className="num">{m.model_type}</span>
              {m.dataset_name ? <> · trained on {m.dataset_name}</> : null} · <span className="num">{formatInt(s.models.n_real)}</span> real model
              {s.models.n_real === 1 ? "" : "s"}
              {m.threshold !== null && m.threshold !== undefined ? (
                <>
                  {" "}
                  · threshold <span className="num">{formatProbability(m.threshold, { digits: 2 })}</span>
                </>
              ) : null}
            </p>
          </div>
        ) : null
      }
      footer={
        <>
          <Link to={m ? "/evaluation" : "/training"} className={buttonClasses({ variant: "ghost", size: "sm" })}>
            {m ? "Model Evaluation" : "Train a model"} <ArrowRight aria-hidden="true" />
          </Link>
        </>
      }
    >
      {!m ? (
        <p className="text-sm text-fg-secondary">No trained model yet. Train one on a dataset; until then Planet Detection cannot score signals.</p>
      ) : (
        <>
          {m.is_fixture ? (
            <Banner tone="fixture-model" className="mb-3" title="Fixture model">
              A pipeline-test model trained on synthetic data — its scores mean nothing.
            </Banner>
          ) : null}
          {shown ? (
            <>
              <div className="eyebrow mb-2 text-fg-secondary">{test ? "Test split (held-out stars)" : "Validation split — not yet evaluated on test"}</div>
              <dl className="grid grid-cols-3 gap-x-3 gap-y-3">
                {METRICS.map((k) => (
                  <div key={k.key}>
                    <dt className="text-xs text-fg-secondary">{k.label}</dt>
                    <dd className="num text-md text-fg">{formatProbability(metric(shown, k.key))}</dd>
                  </div>
                ))}
                <div>
                  <dt className="text-xs text-fg-secondary">n</dt>
                  <dd className="num text-md text-fg">{formatInt(metric(shown, "n"))}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="text-sm text-fg-secondary">No metrics recorded for this model.</p>
          )}
        </>
      )}
    </StatusCard>
  );
}

function RecentPredictions({ s }: { s: SystemSummaryOut }) {
  const items = s.predictions.recent.slice(0, 6);
  return (
    <Card>
      <CardHeader
        eyebrow="Recent predictions"
        title={
          <span>
            <span className="num">{formatInt(s.predictions.count)}</span> stored
          </span>
        }
        actions={
          <Link to="/predictions" className={buttonClasses({ variant: "ghost", size: "sm" })}>
            <History aria-hidden="true" /> History
          </Link>
        }
      />
      {items.length === 0 ? (
        <p className="text-sm text-fg-secondary">No predictions yet. Score a catalogue signal or an uploaded light curve in Planet Detection.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {items.map((p) => (
            <li key={p.id}>
              <Link to={`/predictions?id=${p.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:bg-fg/[0.03]">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-fg">{p.signal_key ?? p.input_name}</span>
                  <span className="block truncate text-xs text-fg-secondary">
                    {p.model_name} · {formatRelativeTime(p.created_at)}
                  </span>
                </span>
                <ClassBadge cls={predictionClass(p)} probability={p.probability} className="shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function stepStatus(step: NextStep, firstPendingKey: string | undefined): Step["status"] {
  if (step.done) return "complete";
  return step.key === firstPendingKey ? "current" : "upcoming";
}

function Checklist({ s, refresh }: { s: SystemSummaryOut; refresh: ReturnType<typeof useCatalogRefresh> }) {
  const first = s.next_steps[0];
  return (
    <Card>
      <CardHeader eyebrow="Setup checklist" title={`${s.checklist.filter((c) => c.done).length} of ${s.checklist.length} steps done`} />
      <Stepper
        orientation="vertical"
        aria-label="Setup checklist"
        steps={s.checklist.map((c) => ({
          id: c.key,
          status: stepStatus(c, first?.key),
          label: c.title,
          description: (
            <span className="flex flex-col items-start gap-2">
              <span>{c.description}</span>
              {c.key === first?.key || (c.key === "refresh_catalog" && !c.done) ? <StepAction step={c} refresh={refresh} primary /> : null}
            </span>
          ),
        }))}
      />
    </Card>
  );
}

function StepAction({ step, refresh, primary = false }: { step: NextStep; refresh: ReturnType<typeof useCatalogRefresh>; primary?: boolean }) {
  if (step.key === "refresh_catalog") {
    return (
      <Button size="sm" variant={primary ? "primary" : "secondary"} icon={<RefreshCw />} loading={refresh.refresh.isPending} disabled={Boolean(refresh.job)} onClick={refresh.start}>
        Refresh catalogue
      </Button>
    );
  }
  const link = STEP_LINKS[step.key];
  if (!link) return null;
  return (
    <Link to={link.path} className={buttonClasses({ variant: primary ? "primary" : "secondary", size: "sm" })}>
      {link.label}
      <ArrowRight aria-hidden="true" />
    </Link>
  );
}

function StatusSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => (
        <Card key={i} className="flex flex-col gap-3">
          <Skeleton width="40%" />
          <Skeleton height={28} width="60%" />
          <Skeleton height={10} />
          <Skeleton height={10} width="80%" />
        </Card>
      ))}
    </div>
  );
}

export default function OverviewPage() {
  const summary = useSystemSummary();
  const refresh = useCatalogRefresh();
  const s = summary.data;
  const next = s?.next_steps[0];
  const otherJobs = s?.running_jobs.filter((j) => j.kind !== "catalog_refresh") ?? [];

  return (
    <div className="flex flex-col gap-10">
      {/* Hero */}
      <section className="card-surface atmosphere overflow-hidden px-6 py-8 md:px-10 md:py-12" aria-labelledby="hero-title">
        {/* Two columns only from xl: with the 248 px sidebar, a 1024 px window leaves too little
            width for the schematic's labels to stay legible beside the copy. */}
        <div className="grid grid-cols-1 items-center gap-8 xl:grid-cols-[1.15fr_1fr] xl:gap-12">
          <div className="min-w-0">
            <div className="eyebrow mb-4 flex items-center gap-2 text-fg-secondary">
              <DipRule />
              Kepler transit-signal laboratory
            </div>
            <h1 id="hero-title" className="font-display text-xl text-fg md:text-2xl">
              Find transit-like signals worth a second look.
            </h1>
            <p className="mt-4 max-w-prose text-base text-fg-secondary md:text-md">
              Exoplanet Finder trains your own classifiers on NASA Kepler light curves and scores threshold-crossing events as{" "}
              <span className="text-signal-planet">planet-like</span> or <span className="text-signal-fp">false-positive-like</span>. Every
              score is a research lead to vet — not a confirmed discovery.
            </p>
            <div className="mt-7 flex flex-wrap gap-2">
              <Link to="/signals" className={buttonClasses({ variant: "primary", size: "lg" })}>
                Explore signals
                <ArrowRight aria-hidden="true" />
              </Link>
              <Link to="/detect" className={buttonClasses({ variant: "secondary", size: "lg" })}>
                Score a signal
              </Link>
              <Link to="/docs" className={buttonClasses({ variant: "ghost", size: "lg" })}>
                <BookOpen aria-hidden="true" />
                Methodology
              </Link>
            </div>
          </div>
          <div className="mx-auto w-full max-w-[420px] xl:max-w-[440px]">
            <TransitDiagram />
          </div>
        </div>
      </section>

      {summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} title={undefined} />
      ) : null}

      {next ? (
        <Banner
          tone="info"
          title={
            <span>
              Next step: {next.title}
            </span>
          }
          action={<StepAction step={next} refresh={refresh} primary />}
        >
          {next.description}
        </Banner>
      ) : s ? (
        <Banner tone="info" title="All setup steps are done">
          Score more signals in Planet Detection or rank candidates in the Candidate Explorer.
        </Banner>
      ) : null}

      <Section eyebrow="Live status" title="What is on this machine" description="Read from the local database and caches; refreshed every minute (every few seconds while jobs run).">
        {!s ? (
          summary.isPending ? <StatusSkeleton /> : null
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <CatalogueCard s={s} refresh={refresh} />
            <LightCurveCard s={s} />
            <DatasetCard s={s} />
            <ModelCard s={s} />
          </div>
        )}
      </Section>

      {s ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <Checklist s={s} refresh={refresh} />
          <div className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardHeader eyebrow="Background jobs" title={otherJobs.length ? `${otherJobs.length} running` : "Nothing running"} />
              {otherJobs.length ? (
                <div className="flex flex-col gap-3">
                  {otherJobs.map((j) => (
                    <JobProgress key={j.id} jobId={j.id} initial={j} onDone={() => void summary.refetch()} />
                  ))}
                </div>
              ) : (
                <p className="flex items-center gap-2 text-sm text-fg-secondary">
                  <CircleCheck className="size-4 text-cosmic" aria-hidden="true" /> No dataset builds, downloads, training or batch scoring in progress.
                </p>
              )}
            </Card>
            <RecentPredictions s={s} />
          </div>
        </div>
      ) : null}

      <Section eyebrow="Quick links" title="Where to go next">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {QUICK_LINKS.map((q) => (
            <li key={q.path}>
              <Link to={q.path} className="card-surface group flex h-full flex-col p-4 transition-colors duration-fast hover:border-hairline-strong">
                <span className="flex items-center justify-between text-base font-semibold text-fg">
                  {q.title}
                  <ArrowRight className="size-4 text-fg-secondary transition-transform duration-fast group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
                <span className="mt-1 text-sm text-fg-secondary">{q.body}</span>
              </Link>
            </li>
          ))}
        </ul>
        {s ? (
          <p className="mt-6 flex items-start gap-2 text-xs text-fg-secondary">
            <ProvenanceChip kind="model" size="xs" />
            <span>
              {s.disclaimer} App v<span className="num">{s.app_version}</span>, pipeline v<span className="num">{s.pipeline_version}</span>
              {s.catalog.last_refresh ? <>, catalogue snapshot {formatDateTime(s.catalog.last_refresh)}</> : null}.
            </span>
          </p>
        ) : null}
      </Section>
    </div>
  );
}
