/**
 * Dataset Explorer — build labelled datasets from the NASA catalogue (tiers, label modes,
 * star-level splits) and inspect them: per-split counts, class balance, exclusions, quality,
 * histograms, provenance, examples with model-view previews and a class gallery.
 *
 * URL state: `?id=<dataset id>` opens a dataset.
 */
import type { ColumnDef } from "@tanstack/react-table";
import { Hammer } from "lucide-react";
import { useMemo, useState } from "react";
import { useDatasets } from "@/api/endpoints/datasets";
import { useJob } from "@/api/endpoints/jobs";
import type { DatasetDeleteOut, DatasetOut } from "@/api/schemasOps";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Section } from "@/components/ui/Section";
import { formatInt, formatRelativeTime } from "@/lib/format";
import { StatusBadge, useParamState } from "../_ops/components";
import { apiDate, parseId } from "../_ops/metrics";
import { BuildDataset, LABEL_MODES } from "./BuildDataset";
import { DatasetDetail } from "./DatasetDetail";

const TIER_NAME: Record<string, string> = { pilot: "Pilot", standard: "Standard", full: "Full", custom: "Custom" };

function BuildingCell({ ds }: { ds: DatasetOut }) {
  const { job } = useJob(ds.job_id ?? null);
  if (!job || job.status !== "running") return <StatusBadge status={ds.status} />;
  return (
    <div className="w-[160px]">
      <ProgressBar size="sm" value={job.progress} showPercent label={<span className="text-xs text-fg-secondary">Building</span>} />
    </div>
  );
}

function DeletedNotice({ out, onDismiss }: { out: DatasetDeleteOut; onDismiss: () => void }) {
  const extra = [
    out.experiments ? `${out.experiments} experiment(s)` : null,
    out.models ? `${out.models} model(s)` : null,
    out.evaluations ? `${out.evaluations} evaluation(s)` : null,
    out.predictions ? `${out.predictions} prediction(s)` : null,
  ].filter(Boolean);
  return (
    <Banner tone="info" title={`Dataset #${out.dataset_id} deleted`} onDismiss={onDismiss}>
      Removed {formatInt(out.examples)} example records{extra.length ? ` and ${extra.join(", ")}` : ""}.
    </Banner>
  );
}

export default function DatasetExplorerPage() {
  const [params, setParams] = useParamState();
  const selectedId = parseId(params.get("id"));
  const datasets = useDatasets();
  const [deleted, setDeleted] = useState<DatasetDeleteOut | null>(null);
  const list = datasets.data ?? [];

  const columns = useMemo<ColumnDef<DatasetOut>[]>(
    () => [
      {
        id: "name",
        header: "Dataset",
        accessorFn: (r) => r.name,
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="font-medium text-fg">{row.original.name}</span>
            <span className="text-xs text-fg-secondary">
              {TIER_NAME[row.original.tier] ?? row.original.tier} · {LABEL_MODES.find((m) => m.value === row.original.label_mode)?.label ?? row.original.label_mode} · seed{" "}
              <span className="num">{row.original.split_seed}</span>
            </span>
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (r) => r.status,
        cell: ({ row }) => (row.original.status === "building" ? <BuildingCell ds={row.original} /> : <StatusBadge status={row.original.status} />),
      },
      { id: "n", header: "Examples", accessorFn: (r) => r.n_examples, cell: ({ getValue }) => formatInt(getValue() as number), meta: { numeric: true } },
      {
        id: "splits",
        header: "Train / val / test",
        accessorFn: (r) => r.n_train,
        cell: ({ row }) => (
          <span className="num">
            {formatInt(row.original.n_train)} / {formatInt(row.original.n_val)} / {formatInt(row.original.n_test)}
          </span>
        ),
        meta: { numeric: true },
      },
      { id: "excluded", header: "Excluded", accessorFn: (r) => r.n_excluded ?? undefined, cell: ({ getValue }) => formatInt(getValue() as number | undefined), meta: { numeric: true } },
      { id: "models", header: "Models", accessorFn: (r) => r.n_models, cell: ({ getValue }) => formatInt(getValue() as number), meta: { numeric: true } },
      {
        id: "created",
        header: "Built",
        accessorFn: (r) => apiDate(r.created_at)?.getTime() ?? 0,
        cell: ({ row }) => <span className="text-fg-secondary">{formatRelativeTime(apiDate(row.original.created_at))}</span>,
        meta: { align: "right" },
      },
    ],
    [],
  );

  const open = (id: number | null) => setParams({ id }, { push: true });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Data · 01"
        title="Dataset Explorer"
        description="Build labelled datasets from the NASA catalogue with star-level train / validation / test splits, then inspect what the models will learn from."
        actions={
          selectedId === null ? (
            <Button
              variant="primary"
              icon={<Hammer />}
              onClick={() => document.getElementById("build-dataset")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              Build a dataset
            </Button>
          ) : null
        }
      />

      {deleted ? <DeletedNotice out={deleted} onDismiss={() => setDeleted(null)} /> : null}

      {selectedId !== null ? (
        <DatasetDetail
          id={selectedId}
          onBack={() => open(null)}
          onDeleted={(out) => {
            setDeleted(out);
            open(null);
          }}
        />
      ) : (
        <>
          <Section id="datasets" title="Your datasets" description="Click a dataset to see its splits, exclusions, quality, examples and provenance.">
            {datasets.isError ? (
              <ApiErrorBanner error={datasets.error} onRetry={() => void datasets.refetch()} />
            ) : !datasets.isLoading && list.length === 0 ? (
              <EmptyState
                title="No datasets yet"
                description="Build your first dataset below. The Pilot tier (about 300 labelled signals) runs end to end in a few minutes."
                actions={
                  <Button variant="primary" icon={<Hammer />} onClick={() => document.getElementById("build-dataset")?.scrollIntoView({ behavior: "smooth" })}>
                    Build a dataset
                  </Button>
                }
              />
            ) : (
              <DataTable
                caption="Datasets"
                data={list}
                columns={columns}
                loading={datasets.isLoading}
                getRowId={(r) => String(r.id)}
                onRowClick={(r) => open(r.id)}
                showDensityToggle={false}
                maxHeight={420}
                initialSorting={[{ id: "created", desc: true }]}
              />
            )}
          </Section>
          <Section id="build-dataset" title="Build a dataset" description="Pick a label mode and a tier. Counts and time estimates come from your local catalogue and cache.">
            <BuildDataset existingNames={list.map((d) => d.name)} onStarted={(id) => (id !== null ? open(id) : undefined)} />
          </Section>
        </>
      )}
    </div>
  );
}
