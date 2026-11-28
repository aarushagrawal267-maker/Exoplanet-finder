/**
 * Experiments — the log of every training run (filters: model type, dataset, status, archived),
 * one run in detail (config, environment, curves, metrics, model, evaluations, notes and tags,
 * archive, delete, report), and side-by-side comparison of two or more runs with report export.
 *
 * URL state: `?id=<experiment id>` opens a run; `?compare=<id>,<id>…` compares runs.
 */
import type { ColumnDef } from "@tanstack/react-table";
import { Cpu } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDatasets } from "@/api/endpoints/datasets";
import { useExperiments } from "@/api/endpoints/experiments";
import type { ExperimentDeleteOut, ExperimentOut, ExperimentQuery } from "@/api/schemasOps";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { buttonClasses } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/Select";
import { formatDuration, formatInt, formatRelativeTime } from "@/lib/format";
import { StatusBadge, useParamState } from "../_ops/components";
import { apiDate, fmtMetric, metricOf, MODEL_TYPES, modelTypeLabel, parseId, parseIdList } from "../_ops/metrics";
import { CompareExperiments } from "./CompareExperiments";
import { ExperimentDetail } from "./ExperimentDetail";

type ArchivedFilter = "active" | "archived" | "all";

export default function ExperimentsPage() {
  const [params, setParams] = useParamState();
  const datasets = useDatasets();
  const modelType = params.get("type") ?? "";
  const datasetId = parseId(params.get("dataset"));
  const status = params.get("status") ?? "";
  const archived = (params.get("archived") as ArchivedFilter | null) ?? "active";
  const query: ExperimentQuery = {
    model_type: modelType || undefined,
    dataset_id: datasetId ?? undefined,
    status: status || undefined,
    archived: archived === "all" ? undefined : archived === "archived",
  };
  const experiments = useExperiments(query);
  const selectedId = parseId(params.get("id"));
  const compareIds = parseIdList(params.get("compare"));
  const [deleted, setDeleted] = useState<ExperimentDeleteOut | null>(null);
  const list = experiments.data ?? [];
  const filtered = Boolean(modelType || datasetId || status || archived !== "active");

  const toggleCompare = (id: number) => {
    const next = compareIds.includes(id) ? compareIds.filter((x) => x !== id) : [...compareIds, id];
    setParams({ compare: next.join(",") });
  };

  const columns = useMemo<ColumnDef<ExperimentOut>[]>(
    () => [
      {
        id: "cmp",
        header: () => <span className="sr-only">Compare</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <input
            type="checkbox"
            className="size-4 accent-[var(--c-cosmic)]"
            aria-label={`Add experiment ${row.original.id} to the comparison`}
            checked={compareIds.includes(row.original.id)}
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggleCompare(row.original.id)}
          />
        ),
        meta: { width: 40 },
      },
      {
        id: "name",
        header: "Experiment",
        accessorFn: (r) => r.name,
        cell: ({ row }) => {
          const e = row.original;
          return (
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-fg">
                <span className="num text-fg-secondary">#{e.id}</span> {e.name}
                {e.is_active_model ? <Badge tone="planet">active</Badge> : null}
                {e.archived ? <Badge tone="uncertain">archived</Badge> : null}
              </span>
              <span className="flex flex-wrap items-center gap-1 text-xs text-fg-secondary">
                {modelTypeLabel(e.model_type)} · {e.dataset_name ?? `dataset ${e.dataset_id}`}
                {e.tags.map((t) => (
                  <span key={t} className="rounded-full border border-hairline-strong px-1.5 text-2xs text-fg">
                    {t}
                  </span>
                ))}
              </span>
            </span>
          );
        },
      },
      { id: "status", header: "Status", accessorFn: (r) => r.status, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      {
        id: "pr",
        header: "Val PR-AUC",
        accessorFn: (r) => metricOf(r.val_summary, "pr_auc") ?? undefined,
        cell: ({ getValue }) => fmtMetric(getValue() as number | undefined),
        meta: { numeric: true, headerLabel: "Validation PR-AUC (optimistic)" },
      },
      {
        id: "roc",
        header: "Val ROC-AUC",
        accessorFn: (r) => metricOf(r.val_summary, "roc_auc") ?? undefined,
        cell: ({ getValue }) => fmtMetric(getValue() as number | undefined),
        meta: { numeric: true, headerLabel: "Validation ROC-AUC (optimistic)" },
      },
      {
        id: "test",
        header: "Test PR-AUC",
        accessorFn: (r) => metricOf(r.test_metrics, "pr_auc") ?? undefined,
        cell: ({ getValue }) => fmtMetric(getValue() as number | undefined),
        meta: { numeric: true, headerLabel: "Test PR-AUC (unbiased, latest test evaluation)" },
      },
      {
        id: "epochs",
        header: "Epochs · time",
        accessorFn: (r) => r.duration_s ?? undefined,
        cell: ({ row }) => (
          <span className="flex flex-col items-end leading-tight">
            <span>{row.original.epochs_run ? `${row.original.best_epoch ?? "—"} / ${formatInt(row.original.epochs_run)}` : "—"}</span>
            <span className="text-xs text-fg-secondary">{formatDuration(row.original.duration_s)}</span>
          </span>
        ),
        meta: { numeric: true, headerLabel: "Best epoch / epochs run, and training time" },
      },
      { id: "created", header: "Started", accessorFn: (r) => r.id, cell: ({ row }) => <span className="text-fg-secondary">{formatRelativeTime(apiDate(row.original.created_at))}</span>, meta: { align: "right" } },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compareIds.join(",")],
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Models · 03"
        title="Experiments"
        description="Every training run with its configuration, environment, curves and metrics. Compare runs, keep notes, and export reports."
      />

      {deleted ? (
        <Banner tone="info" title={`Experiment #${deleted.experiment_id} deleted`} onDismiss={() => setDeleted(null)}>
          Removed {deleted.models} model(s), {deleted.evaluations} evaluation(s) and {deleted.predictions} prediction(s).
        </Banner>
      ) : null}

      <Section id="log" title="Experiment log" description="Click a run to open it; tick two or more to compare them.">
        {experiments.isError ? (
          <ApiErrorBanner error={experiments.error} onRetry={() => void experiments.refetch()} />
        ) : !experiments.isLoading && list.length === 0 && !filtered ? (
          <EmptyState
            title="No experiments yet"
            description="Every training run is logged here with its settings and results. Start one on the Model Training page."
            actions={
              <Link to="/training" className={buttonClasses({ variant: "primary" })}>
                <Cpu aria-hidden="true" /> Train a model first
              </Link>
            }
          />
        ) : (
          <DataTable
            caption="Experiments"
            data={list}
            columns={columns}
            loading={experiments.isLoading}
            getRowId={(r) => String(r.id)}
            selectedRowId={selectedId !== null ? String(selectedId) : null}
            onRowClick={(r) => setParams({ id: r.id }, { push: true })}
            showDensityToggle={false}
            maxHeight={440}
            initialSorting={[{ id: "created", desc: true }]}
            emptyTitle="No experiments match these filters"
            emptyDescription="Clear a filter to see more runs."
            toolbar={
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  size="sm"
                  aria-label="Model type"
                  className="w-[168px]"
                  value={modelType}
                  onChange={(v) => setParams({ type: v || null })}
                  options={[{ value: "", label: "All model types" }, ...MODEL_TYPES.map((t) => ({ value: t, label: modelTypeLabel(t) }))]}
                />
                <Select
                  size="sm"
                  aria-label="Dataset"
                  className="w-[180px]"
                  value={datasetId === null ? "" : String(datasetId)}
                  onChange={(v) => setParams({ dataset: v || null })}
                  options={[{ value: "", label: "All datasets" }, ...(datasets.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))]}
                />
                <Select
                  size="sm"
                  aria-label="Status"
                  className="w-[140px]"
                  value={status}
                  onChange={(v) => setParams({ status: v || null })}
                  options={[
                    { value: "", label: "Any status" },
                    { value: "succeeded", label: "Succeeded" },
                    { value: "queued,running", label: "Running / queued" },
                    { value: "failed", label: "Failed" },
                    { value: "cancelled", label: "Cancelled" },
                  ]}
                />
                <SegmentedControl<ArchivedFilter>
                  aria-label="Archived"
                  size="sm"
                  value={archived}
                  onChange={(v) => setParams({ archived: v === "active" ? null : v })}
                  options={[
                    { value: "active", label: "Current" },
                    { value: "archived", label: "Archived" },
                    { value: "all", label: "All" },
                  ]}
                />
                {compareIds.length ? <Badge tone="cosmic">{compareIds.length} selected</Badge> : null}
              </div>
            }
          />
        )}
      </Section>

      {compareIds.length >= 2 ? (
        <Section id="compare" title="Comparison">
          <CompareExperiments ids={compareIds} onRemove={toggleCompare} onClear={() => setParams({ compare: null })} />
        </Section>
      ) : compareIds.length === 1 ? (
        <p className="text-sm text-fg-secondary">Tick at least one more run to compare.</p>
      ) : null}

      {selectedId !== null ? (
        <Section id="experiment" title="Run details">
          <ExperimentDetail
            key={selectedId}
            id={selectedId}
            onClose={() => setParams({ id: null })}
            onDeleted={(out) => {
              setDeleted(out);
              setParams({ id: null, compare: compareIds.filter((x) => x !== out.experiment_id).join(",") || null });
            }}
          />
        </Section>
      ) : null}
    </div>
  );
}
