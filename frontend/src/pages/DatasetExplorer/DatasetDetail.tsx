/**
 * One dataset: status (live progress while building), per-split counts, class balance,
 * exclusions by reason, quality grades, period / depth histograms, provenance, examples with view
 * previews, the class gallery, and deletion (with the explicit force path when models depend on it).
 */
import { ArrowLeft, Cpu, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "@/api/client";
import { useDataset, useDeleteDataset } from "@/api/endpoints/datasets";
import type { DatasetDeleteOut, DatasetDetailOut, DatasetStats } from "@/api/schemasOps";
import { JobProgress } from "@/components/jobs/JobProgress";
import { ApiErrorBanner, hasErrorCode } from "@/components/ui/ApiErrorBanner";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { KeyValueList, type KeyValueItem } from "@/components/ui/KeyValueList";
import { ProvenanceChip } from "@/components/ui/ProvenanceChip";
import { Section } from "@/components/ui/Section";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { formatDateTime, formatDuration, formatInt, formatPercent } from "@/lib/format";
import { ConfirmDialog, MiniStat, StatusBadge } from "../_ops/components";
import { apiDate, SPLIT_LABEL } from "../_ops/metrics";
import { ClassBalance, GradeDistribution, LogHistogram } from "./charts";
import { ExamplesPanel, type ExamplesFilter } from "./ExamplesPanel";
import { Gallery } from "./Gallery";
import { LABEL_MODES } from "./BuildDataset";

const TIER_NAME: Record<string, string> = { pilot: "Pilot", standard: "Standard", full: "Full", custom: "Custom" };
const labelModeName = (m: string) => LABEL_MODES.find((x) => x.value === m)?.label ?? m;
const unitShort = (u: string) => (u === "days" ? "d" : u);

function short(hash: string | null | undefined, n = 12): string {
  return hash ? `${hash.slice(0, n)}…` : "—";
}

function SplitTable({ stats }: { stats: DatasetStats }) {
  const order = ["train", "val", "test"].filter((s) => stats.per_split[s]);
  const rows = order.map((s) => ({ key: s, label: SPLIT_LABEL[s] ?? s, ...(stats.per_split[s] as NonNullable<DatasetStats["per_split"][string]>) }));
  const total = { key: "total", label: "Total", n: stats.n_included, n_pos: stats.n_pos, n_neg: stats.n_neg, n_stars: stats.n_stars };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-separate border-spacing-0 text-sm" aria-label="Examples per split">
        <thead>
          <tr className="eyebrow text-fg-secondary">
            <th scope="col" className="border-b border-hairline py-2 pr-3 text-left font-medium">Split</th>
            <th scope="col" className="border-b border-hairline px-3 py-2 text-right font-medium">Signals</th>
            <th scope="col" className="border-b border-hairline px-3 py-2 text-right font-medium">Planet-like</th>
            <th scope="col" className="border-b border-hairline px-3 py-2 text-right font-medium">FP-like</th>
            <th scope="col" className="border-b border-hairline px-3 py-2 text-right font-medium">% planet-like</th>
            <th scope="col" className="border-b border-hairline py-2 pl-3 text-right font-medium">Stars</th>
          </tr>
        </thead>
        <tbody>
          {[...rows, total].map((r) => (
            <tr key={r.key} className={r.key === "total" ? "font-medium" : undefined}>
              <th scope="row" className="border-b border-hairline py-2 pr-3 text-left font-normal text-fg">
                {r.label}
              </th>
              <td className="num border-b border-hairline px-3 py-2 text-right text-fg">{formatInt(r.n)}</td>
              <td className="num border-b border-hairline px-3 py-2 text-right text-fg">{formatInt(r.n_pos)}</td>
              <td className="num border-b border-hairline px-3 py-2 text-right text-fg">{formatInt(r.n_neg)}</td>
              <td className="num border-b border-hairline px-3 py-2 text-right text-fg-secondary">{formatPercent(r.n ? r.n_pos / r.n : null, { digits: 0 })}</td>
              <td className="num border-b border-hairline py-2 pl-3 text-right text-fg">{formatInt(r.n_stars)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Exclusions({ stats, onShow }: { stats: DatasetStats; onShow: (reason: string) => void }) {
  const entries = Object.entries(stats.exclusions_by_reason).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <p className="text-sm text-fg-secondary">No signals were excluded.</p>;
  return (
    <ul className="flex flex-col divide-y divide-hairline">
      {entries.map(([reason, n]) => (
        <li key={reason} className="flex items-start justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm text-fg">{stats.exclusion_reason_labels[reason] ?? reason.replace(/_/g, " ")}</p>
            <p className="num text-2xs text-fg-secondary">{reason}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="num text-sm text-fg">{formatInt(n)}</span>
            <Button size="sm" variant="ghost" onClick={() => onShow(reason)} aria-label={`Show examples excluded for ${reason}`}>
              Show
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Provenance({ ds, stats }: { ds: DatasetDetailOut; stats: DatasetStats }) {
  const cfg = ds.config as Record<string, unknown>;
  const pipeline = (cfg.pipeline ?? {}) as Record<string, unknown>;
  const fractions = Array.isArray(cfg.split_fractions) ? (cfg.split_fractions as number[]).map((f) => formatPercent(f, { digits: 0 })).join(" / ") : "—";
  const manifest = (stats.manifest ?? {}) as Record<string, unknown>;
  const processing = stats.processing;
  const items: KeyValueItem[] = [
    { key: "pv", label: "Pipeline version", value: ds.pipeline_version },
    { key: "lm", label: "Label mode", value: labelModeName(ds.label_mode), mono: false },
    { key: "seed", label: "Split seed", value: ds.split_seed },
    { key: "fr", label: "Split fractions (train / val / test)", value: fractions },
    { key: "ec", label: "Label conflicts excluded", value: cfg.exclude_conflicts ? "yes" : "no", mono: false },
    { key: "dt", label: "Detrending", value: String(pipeline.detrend_method ?? "—") },
    { key: "bins", label: "Global / local bins", value: `${String(pipeline.global_bins ?? "—")} / ${String(pipeline.local_bins ?? "—")}` },
    { key: "ch", label: "Content hash (SHA-256)", value: <span title={ds.content_hash ?? undefined}>{short(ds.content_hash)}</span> },
    { key: "ah", label: "Arrays SHA-256", value: <span title={String(manifest.arrays_sha256 ?? "")}>{short(manifest.arrays_sha256 as string | undefined)}</span> },
    { key: "path", label: "Files", value: <span className="break-all text-xs" title={ds.path ?? undefined}>{ds.path ?? "—"}</span> },
    { key: "created", label: "Built", value: formatDateTime(apiDate(ds.created_at)) },
  ];
  if (processing) {
    items.push({
      key: "proc",
      label: "Processing",
      value: `${formatInt(processing.n_signals)} signals · ${formatDuration(processing.wall_s)} · ${processing.workers} worker(s)`,
      hint: `${formatInt(processing.n_from_cache)} from cache, ${formatInt(processing.n_computed)} computed, ${formatInt(processing.n_errors)} errors`,
    });
  }
  const timings = stats.timings ?? {};
  if (typeof timings.total_s === "number") items.push({ key: "time", label: "Total build time", value: formatDuration(timings.total_s) });
  return (
    <div className="flex flex-col gap-3">
      <KeyValueList items={items} dense />
      <Banner tone="info" title="Catalogue snapshots">
        The build records the NASA catalogue snapshot ids and SHA-256 checksums in <span className="num">manifest.json</span> next to the arrays; the API does not
        return them yet, so they are not shown here.
      </Banner>
    </div>
  );
}

function DeleteDataset({ ds, onDeleted }: { ds: DatasetDetailOut; onDeleted: (out: DatasetDeleteOut) => void }) {
  const [open, setOpen] = useState(false);
  const [force, setForce] = useState(false);
  const [ack, setAck] = useState(false);
  const del = useDeleteDataset();
  const inUse = hasErrorCode(del.error, "dataset_in_use");
  const close = () => {
    setOpen(false);
    setForce(false);
    setAck(false);
    del.reset();
  };
  const confirm = () => {
    del.mutate(
      { id: ds.id, force },
      {
        onSuccess: (out) => {
          close();
          onDeleted(out);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === "dataset_in_use") setForce(true);
        },
      },
    );
  };
  return (
    <>
      <Button variant="danger" size="sm" icon={<Trash2 />} onClick={() => setOpen(true)}>
        Delete
      </Button>
      <ConfirmDialog
        open={open}
        onClose={close}
        busy={del.isPending}
        title={force ? `Force-delete “${ds.name}” and everything trained on it?` : `Delete dataset “${ds.name}”?`}
        confirmLabel={force ? "Delete dataset and dependants" : "Delete dataset"}
        confirmDisabled={force && !ack}
        onConfirm={confirm}
      >
        {!force ? (
          <div className="flex flex-col gap-3 text-sm text-fg-secondary">
            <p>
              This removes its <span className="num text-fg">{formatInt(ds.n_examples)}</span> examples, the exclusion records and the array files
              {ds.path ? (
                <>
                  {" "}
                  in <span className="num break-all text-fg">{ds.path}</span>
                </>
              ) : null}
              . Cached light curves are kept. This cannot be undone.
            </p>
            {ds.n_models ? (
              <p className="text-warn">
                <span className="num">{ds.n_models}</span> model(s) were trained on this dataset; the server will refuse unless you confirm deleting them too.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <Banner tone="danger" title={del.error instanceof ApiError && inUse ? del.error.detail : "Models depend on this dataset"}>
              Force-deleting also permanently removes:
              <ul className="mt-1 list-disc pl-5">
                <li>every experiment trained on this dataset, with its epoch logs;</li>
                <li>their model versions and checkpoint files (the active model too, if it is one of them);</li>
                <li>all evaluations of those models, including logged test evaluations;</li>
                <li>every prediction made with those models.</li>
              </ul>
            </Banner>
            <label className="flex items-start gap-2 text-fg">
              <input type="checkbox" className="mt-1 accent-[var(--c-danger)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              I understand that the dataset, its experiments, models, evaluations and predictions will be deleted.
            </label>
          </div>
        )}
        {del.isError && !inUse ? <ApiErrorBanner className="mt-3" error={del.error} /> : null}
      </ConfirmDialog>
    </>
  );
}

export interface DatasetDetailProps {
  id: number;
  onBack: () => void;
  onDeleted: (out: DatasetDeleteOut) => void;
}

export function DatasetDetail({ id, onBack, onDeleted }: DatasetDetailProps) {
  const q = useDataset(id);
  const [filter, setFilter] = useState<ExamplesFilter>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState("examples");
  const ds = q.data;

  if (q.isLoading) {
    return (
      <Card className="flex flex-col gap-4" aria-busy="true">
        <Skeleton height={24} width="40%" />
        <SkeletonText lines={3} />
        <Skeleton height={160} />
      </Card>
    );
  }
  if (q.isError || !ds) {
    return (
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" icon={<ArrowLeft />} onClick={onBack} className="self-start">
          All datasets
        </Button>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  const stats = ds.stats ?? null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          eyebrow={`Dataset #${ds.id} · ${TIER_NAME[ds.tier] ?? ds.tier} tier`}
          title={<span className="font-display text-xl">{ds.name}</span>}
          actions={
            <>
              <Button variant="ghost" size="sm" icon={<ArrowLeft />} onClick={onBack}>
                <span className="hidden sm:inline">All datasets</span>
              </Button>
              <DeleteDataset ds={ds} onDeleted={onDeleted} />
            </>
          }
        >
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={ds.status} />
            <Badge>{labelModeName(ds.label_mode)}</Badge>
            {ds.is_synthetic ? <Badge tone="nebula">synthetic test data</Badge> : null}
            {!ds.compatible ? <Badge tone="warn">older pipeline {ds.pipeline_version}</Badge> : null}
            <ProvenanceChip kind="catalogue" source="NASA Exoplanet Archive labels" size="xs" />
            <ProvenanceChip kind="measured" label="Views measured" source="Model views computed by this app's pipeline" size="xs" />
          </div>
        </CardHeader>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <MiniStat label="Examples" value={formatInt(ds.n_examples)} />
          <MiniStat label="Train" value={formatInt(ds.n_train)} />
          <MiniStat label="Validation" value={formatInt(ds.n_val)} />
          <MiniStat label="Test" value={formatInt(ds.n_test)} />
          <MiniStat label="Excluded" value={formatInt(ds.n_excluded)} />
          <MiniStat label="Models" value={formatInt(ds.n_models)} sub={ds.n_models ? <Link className="text-cosmic hover:underline" to="/training">view models</Link> : undefined} />
        </div>
        {ds.status === "ready" ? (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-hairline pt-4">
            <Link to={`/training?dataset=${ds.id}`} className={buttonClasses({ variant: "model", size: "sm" })}>
              <Cpu aria-hidden="true" /> Train a model on this dataset
            </Link>
          </div>
        ) : null}
      </Card>

      {ds.status === "building" && ds.job_id ? <JobProgress jobId={ds.job_id} onDone={() => void q.refetch()} /> : null}
      {ds.status === "failed" || ds.status === "cancelled" ? (
        <Banner tone={ds.status === "failed" ? "danger" : "warn"} title={ds.status === "failed" ? "This build failed" : "This build was cancelled"}>
          {ds.error ?? "No error message was recorded."} Delete it and build again.
        </Banner>
      ) : null}

      {stats ? (
        <>
          {stats.warnings.length ? (
            <Banner tone="warn" title="Dataset warnings">
              <ul className="list-disc pl-5">
                {stats.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Banner>
          ) : null}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader title="Splits" description="Star-level split: every signal of a star is in one split only." />
              <SplitTable stats={stats} />
            </Card>
            <Card>
              <CardHeader title="Class balance" description="Planet-like vs false-positive-like signals per split (included examples)." />
              <ClassBalance perSplit={stats.per_split} />
            </Card>
            <Card>
              <CardHeader
                title="Exclusions by reason"
                description={`${formatInt(stats.n_excluded)} of ${formatInt(stats.n_selected)} selected signals were excluded.`}
              />
              <Exclusions
                stats={stats}
                onShow={(reason) => {
                  setFilter({ reason, included: false });
                  setTab("examples");
                  document.getElementById("dataset-examples")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />
            </Card>
            <Card>
              <CardHeader title="Data-quality grades" description="Grades of the processed signals (grade D signals with blocking issues are excluded)." />
              <GradeDistribution grades={stats.quality_grades} />
              {Object.keys(stats.quality_issues).length ? (
                <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Quality issues">
                  {Object.entries(stats.quality_issues)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, n]) => (
                      <Badge key={k} mono>
                        {k.replace(/_/g, " ")} · {formatInt(n)}
                      </Badge>
                    ))}
                </div>
              ) : null}
            </Card>
            {stats.period_hist ? (
              <Card>
                <CardHeader title="Orbital period" description="Catalogue periods of the included examples, per class." />
                <LogHistogram hist={stats.period_hist} title="Period" unit={unitShort(stats.period_hist.unit)} />
              </Card>
            ) : null}
            {stats.depth_hist ? (
              <Card>
                <CardHeader title="Transit depth" description="Catalogue depths of the included examples, per class." />
                <LogHistogram hist={stats.depth_hist} title="Depth" unit={unitShort(stats.depth_hist.unit)} />
              </Card>
            ) : null}
          </div>

          <Section id="dataset-examples" title="Examples and views">
            <Tabs
              aria-label="Dataset examples"
              value={tab}
              onChange={setTab}
              items={[
                {
                  id: "examples",
                  label: "Examples",
                  count: stats.n_selected,
                  content: <ExamplesPanel datasetId={ds.id} reasons={stats.exclusion_reason_labels} filter={filter} onFilterChange={setFilter} selected={selected} onSelect={setSelected} />,
                },
                {
                  id: "gallery",
                  label: "Gallery",
                  content: (
                    <div className="flex flex-col gap-4">
                      <Gallery datasetId={ds.id} selected={selected} onSelect={setSelected} />
                    </div>
                  ),
                },
                { id: "provenance", label: "Provenance", content: <Provenance ds={ds} stats={stats} /> },
              ]}
            />
          </Section>
          {stats.reserved.length ? (
            <Card>
              <CardHeader
                title="Reserved showcase stars"
                description="Always placed in the test split so demonstrations on them are genuinely unseen."
              />
              <ul className="flex flex-wrap gap-2">
                {stats.reserved.map((r) => (
                  <li key={r.kepid}>
                    <Link to={`/targets/${r.kepid}`} className="inline-flex items-center gap-1.5 rounded-md border border-hairline px-2.5 py-1 text-sm text-fg hover:border-hairline-strong">
                      {r.name ?? `KIC ${r.kepid}`}
                      <span className="num text-xs text-fg-secondary">
                        {r.n_included}/{r.n_signals} included
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      ) : ds.status === "ready" ? (
        <Banner tone="warn" title="No statistics recorded for this dataset">
          The dataset is ready but the server returned no statistics.
        </Banner>
      ) : null}
    </div>
  );
}
