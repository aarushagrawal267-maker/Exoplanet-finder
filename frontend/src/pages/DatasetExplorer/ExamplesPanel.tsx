/**
 * Dataset examples: server-paginated table with split / label / included / exclusion-reason
 * filters, and a preview of the selected example's model input views (global + local).
 */
import type { ColumnDef } from "@tanstack/react-table";
import { ExternalLink, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDatasetExamples, useExampleViews } from "@/api/endpoints/datasets";
import type { DatasetExampleOut, DatasetExampleQuery } from "@/api/schemasOps";
import type { QualityGrade } from "@/api/types";
import { ViewPairPlot } from "@/components/charts/ViewPairPlot";
import { GradeMark } from "@/components/science/GradeMark";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ClassBadge, classFromLabel } from "@/components/ui/ClassBadge";
import { DataTable } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import { ChartSkeleton } from "@/components/ui/Skeleton";
import { formatDays, formatHours, formatInt, formatKepid, formatNumber, formatPpm } from "@/lib/format";
import { SPLIT_LABEL } from "../_ops/metrics";

const isGrade = (g: unknown): g is QualityGrade => g === "A" || g === "B" || g === "C" || g === "D";

export type ExamplesFilter = Omit<DatasetExampleQuery, "limit" | "offset">;

export interface ExamplesPanelProps {
  datasetId: number;
  reasons: Record<string, string | null>;
  filter: ExamplesFilter;
  onFilterChange: (f: ExamplesFilter) => void;
  selected: number | null;
  onSelect: (signalId: number | null) => void;
}

export function ViewPreview({ datasetId, signalId, onClose }: { datasetId: number; signalId: number; onClose?: () => void }) {
  const views = useExampleViews(datasetId, signalId);
  const v = views.data;
  const quality = (v?.quality ?? {}) as Record<string, unknown>;
  const issues = Array.isArray(quality.issues) ? (quality.issues as string[]) : [];
  return (
    <Card className="flex flex-col gap-3" aria-label="Model input views of the selected example">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow text-fg-secondary">Model input views</div>
          <p className="num mt-0.5 text-md text-fg">{v?.signal_key ?? `signal ${signalId}`}</p>
          {v ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-fg-secondary">
              <ClassBadge cls={classFromLabel(v.label === 1 ? 1 : v.label === 0 ? 0 : null)} />
              {v.split ? <Badge>{SPLIT_LABEL[v.split] ?? v.split}</Badge> : null}
              {!v.included ? <Badge tone="warn">excluded{v.exclusion_reason ? `: ${v.exclusion_reason}` : ""}</Badge> : null}
              {isGrade(quality.grade) ? <GradeMark grade={quality.grade} size="sm" /> : null}
              <span>source: {v.source === "dataset_arrays" ? "dataset arrays" : "view cache"}</span>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {v ? (
            <Link to={`/targets/${v.kepid}`} className={buttonClasses({ variant: "ghost", size: "sm" })}>
              {formatKepid(v.kepid)} <ExternalLink aria-hidden="true" />
            </Link>
          ) : null}
          {onClose ? <Button variant="ghost" size="sm" iconOnly icon={<X />} aria-label="Close preview" onClick={onClose} /> : null}
        </div>
      </div>
      {views.isLoading ? <ChartSkeleton height={260} label="Loading model views" /> : null}
      {views.isError ? <ApiErrorBanner error={views.error} onRetry={() => void views.refetch()} /> : null}
      {v ? (
        <ViewPairPlot
          global={v.global.map((x) => (x === null ? Number.NaN : x))}
          local={v.local.map((x) => (x === null ? Number.NaN : x))}
          globalX={v.global_phase.map((x) => (x === null ? Number.NaN : x))}
          localX={v.local_phase.map((x) => (x === null ? Number.NaN : x * 24))}
          globalXTitle="Days from mid-transit"
          localXTitle="Hours from mid-transit"
          height={250}
          ariaLabel={`Global view (${v.global.length} bins) and local view (${v.local.length} bins) of ${v.signal_key}`}
        />
      ) : null}
      {v ? (
        <p className="text-xs text-fg-secondary">
          Flux normalised so the out-of-transit baseline is 0 and the transit minimum −1.
          {issues.length ? <> Quality issues: <span className="text-fg">{issues.join(", ").replace(/_/g, " ")}</span>.</> : " No quality issues flagged."}
        </p>
      ) : null}
    </Card>
  );
}

export function ExamplesPanel({ datasetId, reasons, filter, onFilterChange, selected, onSelect }: ExamplesPanelProps) {
  const [page, setPage] = useState({ offset: 0, limit: 50 });
  const query: DatasetExampleQuery = { ...filter, limit: page.limit, offset: page.offset };
  const examples = useDatasetExamples(datasetId, query);
  const setFilter = (f: ExamplesFilter) => {
    setPage((p) => ({ ...p, offset: 0 }));
    onFilterChange(f);
  };

  const columns = useMemo<ColumnDef<DatasetExampleOut>[]>(
    () => [
      {
        id: "signal",
        header: "Signal",
        accessorFn: (r) => r.signal_key,
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="num text-fg">{row.original.signal_key}</span>
            {row.original.kepler_name || row.original.kepoi_name ? <span className="text-xs text-fg-secondary">{row.original.kepler_name ?? row.original.kepoi_name}</span> : null}
          </span>
        ),
        enableSorting: false,
      },
      {
        id: "kepid",
        header: "Star",
        accessorFn: (r) => r.kepid,
        cell: ({ row }) => (
          <Link to={`/targets/${row.original.kepid}`} className="num text-cosmic hover:underline" onClick={(e) => e.stopPropagation()}>
            {formatKepid(row.original.kepid)}
          </Link>
        ),
        enableSorting: false,
      },
      {
        id: "label",
        header: "Label",
        cell: ({ row }) =>
          row.original.label === 1 || row.original.label === 0 ? <ClassBadge cls={classFromLabel(row.original.label)} /> : <span className="text-fg-secondary">unlabelled</span>,
        enableSorting: false,
      },
      {
        id: "split",
        header: "Split / status",
        cell: ({ row }) =>
          row.original.included ? (
            <span>{SPLIT_LABEL[row.original.split ?? ""] ?? row.original.split ?? "—"}</span>
          ) : (
            <span className="text-warn" title={row.original.exclusion_label ?? undefined}>
              excluded · {(row.original.exclusion_reason ?? "").replace(/_/g, " ")}
            </span>
          ),
        enableSorting: false,
      },
      {
        id: "grade",
        header: "Quality",
        cell: ({ row }) => (isGrade(row.original.quality_grade) ? <GradeMark grade={row.original.quality_grade} size="sm" /> : <span className="text-fg-secondary">—</span>),
        enableSorting: false,
        meta: { align: "center" },
      },
      { id: "period", header: "Period", accessorFn: (r) => r.period_days, cell: ({ getValue }) => formatDays(getValue() as number | null), enableSorting: false, meta: { numeric: true } },
      { id: "duration", header: "Duration", accessorFn: (r) => r.duration_hours, cell: ({ getValue }) => formatHours(getValue() as number | null), enableSorting: false, meta: { numeric: true } },
      { id: "depth", header: "Depth", accessorFn: (r) => r.depth_ppm, cell: ({ getValue }) => formatPpm(getValue() as number | null), enableSorting: false, meta: { numeric: true } },
      { id: "snr", header: "SNR", accessorFn: (r) => r.model_snr, cell: ({ getValue }) => formatNumber(getValue() as number | null, { digits: 1 }), enableSorting: false, meta: { numeric: true, headerLabel: "Catalogue model SNR" } },
      { id: "av", header: "AV / KOI", cell: ({ row }) => <span className="num text-xs text-fg-secondary">{[row.original.av_training_set, row.original.koi_disposition].filter(Boolean).join(" · ") || "—"}</span>, enableSorting: false },
    ],
    [],
  );

  const reasonOptions = Object.keys(reasons).map((k) => ({ value: k, label: `${k.replace(/_/g, " ")}` }));
  const data = examples.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <DataTable
        caption="Dataset examples"
        data={data}
        columns={columns}
        getRowId={(r) => String(r.signal_id)}
        selectedRowId={selected !== null ? String(selected) : null}
        onRowClick={(r) => onSelect(r.signal_id)}
        loading={examples.isLoading}
        maxHeight={460}
        emptyTitle="No examples match these filters"
        emptyDescription="Clear a filter to see more examples."
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              size="sm"
              aria-label="Split"
              className="w-[132px]"
              value={filter.split ?? ""}
              onChange={(v) => setFilter({ ...filter, split: v === "train" || v === "val" || v === "test" ? v : undefined })}
              options={[
                { value: "", label: "All splits" },
                { value: "train", label: "Train" },
                { value: "val", label: "Validation" },
                { value: "test", label: "Test" },
              ]}
            />
            <Select
              size="sm"
              aria-label="Label"
              className="w-[168px]"
              value={filter.label === undefined || filter.label === null ? "" : String(filter.label)}
              onChange={(v) => setFilter({ ...filter, label: v === "1" ? 1 : v === "0" ? 0 : undefined })}
              options={[
                { value: "", label: "Both classes" },
                { value: "1", label: "Planet-like (1)" },
                { value: "0", label: "False-positive-like (0)" },
              ]}
            />
            <Select
              size="sm"
              aria-label="Included"
              className="w-[140px]"
              value={filter.included === undefined || filter.included === null ? "" : filter.included ? "yes" : "no"}
              onChange={(v) => setFilter({ ...filter, included: v === "" ? undefined : v === "yes", reason: v === "yes" ? undefined : filter.reason })}
              options={[
                { value: "", label: "Included + excluded" },
                { value: "yes", label: "Included" },
                { value: "no", label: "Excluded" },
              ]}
            />
            {reasonOptions.length ? (
              <Select
                size="sm"
                aria-label="Exclusion reason"
                className="w-[200px]"
                value={filter.reason ?? ""}
                onChange={(v) => setFilter({ ...filter, reason: v || undefined, included: v ? false : filter.included })}
                options={[{ value: "", label: "Any exclusion reason" }, ...reasonOptions]}
              />
            ) : null}
            <span className="num text-xs">{examples.data ? `${formatInt(examples.data.total)} matching` : ""}</span>
          </div>
        }
      />
      {examples.isError ? <ApiErrorBanner error={examples.error} onRetry={() => void examples.refetch()} /> : null}
      {examples.data && examples.data.total > 0 ? (
        <Pagination
          total={examples.data.total}
          offset={page.offset}
          limit={page.limit}
          pageSizes={[25, 50, 100]}
          noun="examples"
          busy={examples.isFetching}
          onChange={(offset, limit) => setPage({ offset, limit })}
        />
      ) : null}
      {selected !== null ? <ViewPreview datasetId={datasetId} signalId={selected} onClose={() => onSelect(null)} /> : <p className="text-sm text-fg-secondary">Select a row to see the global and local views the models are trained on.</p>}
    </div>
  );
}
