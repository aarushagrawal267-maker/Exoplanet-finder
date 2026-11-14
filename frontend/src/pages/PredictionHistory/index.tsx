/**
 * Prediction History — every stored prediction (single scores and batch runs), filterable by star,
 * model, input type and batch job, with a detail drawer showing the stored model input views, the
 * quality report, the measured features and all warnings recorded at prediction time.
 */
import type { ColumnDef } from "@tanstack/react-table";
import { Radar, Star, X } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useModels } from "@/api/endpoints/models";
import { usePrediction, usePredictions } from "@/api/endpoints/predictions";
import type { PredictionOut, PredictionQuery } from "@/api/schemas";
import { asGrade, toQualityReport } from "@/components/science/adapters";
import { CatalogueLabelsPanel } from "@/components/science/CatalogueLabels";
import { GradeMark } from "@/components/science/GradeMark";
import { EphemerisLine } from "@/components/science/LightCurveViewer";
import { FeatureList, ModelInputViews, PredictionVerdict, WarningList } from "@/components/science/PredictionParts";
import { QualityReport } from "@/components/science/QualityReport";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ClassBadge } from "@/components/ui/ClassBadge";
import { DataTable } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { ProvenanceChip } from "@/components/ui/ProvenanceChip";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDateTime, formatKepid, formatProbability, formatRelativeTime } from "@/lib/format";
import { useUrlState } from "@/lib/urlState";
import { predictionClass } from "../_shared/prediction";

const PAGE_SIZES = [25, 50, 100];
const SOURCE_TYPES = [
  { value: "", label: "All inputs" },
  { value: "catalog", label: "Catalogue signals" },
  { value: "fits", label: "Uploaded FITS" },
  { value: "csv", label: "Uploaded tables" },
];

function useColumns(): ColumnDef<PredictionOut>[] {
  return useMemo<ColumnDef<PredictionOut>[]>(
    () => [
      { id: "created", header: "When", enableSorting: false, cell: (c) => <span title={formatDateTime(c.row.original.created_at)}>{formatRelativeTime(c.row.original.created_at)}</span> },
      {
        id: "input",
        header: "Input",
        enableSorting: false,
        cell: (c) => {
          const p = c.row.original;
          return (
            <span className="text-fg">
              {p.catalog_labels?.kepler_name ?? p.signal_key ?? p.input_name}
              {p.signal_key && p.catalog_labels?.kepler_name ? <span className="num ml-2 text-xs text-fg-secondary">{p.signal_key}</span> : null}
            </span>
          );
        },
      },
      { id: "kepid", header: "KIC", meta: { mono: true }, enableSorting: false, cell: (c) => c.row.original.kepid ?? "—" },
      {
        id: "model",
        header: "Model",
        enableSorting: false,
        cell: (c) => (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-fg">{c.row.original.model_name}</span>
            {c.row.original.is_fixture_model ? <Badge tone="warn">Fixture</Badge> : null}
          </span>
        ),
      },
      { id: "p", header: "P(planet-like)", meta: { numeric: true, headerLabel: "Calibrated probability" }, enableSorting: false, cell: (c) => <span className="text-fg">{formatProbability(c.row.original.probability)}</span> },
      { id: "unc", header: () => <span className="normal-case">±σ</span>, meta: { numeric: true }, enableSorting: false, cell: (c) => formatProbability(c.row.original.uncertainty) },
      { id: "cls", header: "Verdict", enableSorting: false, cell: (c) => <ClassBadge cls={predictionClass(c.row.original)} /> },
      {
        id: "grade",
        header: "Grade",
        enableSorting: false,
        cell: (c) => {
          const g = asGrade(c.row.original.quality_grade);
          return g ? <GradeMark grade={g} size="sm" /> : <span className="text-fg-secondary">—</span>;
        },
      },
      {
        id: "split",
        header: "Split",
        enableSorting: false,
        cell: (c) => {
          const s = c.row.original.seen_in_split;
          return s ? <Badge tone={s === "train" ? "warn" : s === "val" ? "uncertain" : "neutral"}>{s}</Badge> : <span className="text-fg-secondary">unseen</span>;
        },
      },
      { id: "src", header: "Source", enableSorting: false, cell: (c) => <Badge mono>{c.row.original.source_type}{c.row.original.batch_job_id ? " · batch" : ""}</Badge> },
    ],
    [],
  );
}

function PredictionDetail({ id }: { id: number }) {
  const q = usePrediction(id);
  if (q.isPending) return <Skeleton height={320} rounded="md" />;
  if (q.isError) return <ApiErrorBanner error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data;
  const eph = (p.ephemeris ?? {}) as { period_days?: number; epoch?: number; duration_hours?: number; depth_ppm?: number | null; source?: string; label?: string; time_system?: string };
  const quality = toQualityReport(p.quality);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        {p.kepid ? (
          <Link to={`/targets/${p.kepid}${p.signal_id ? `?signal=${p.signal_id}` : ""}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
            <Star aria-hidden="true" /> Target dossier
          </Link>
        ) : null}
        {p.kepid && p.signal_id ? (
          <Link to={`/detect?kepid=${p.kepid}&signal=${p.signal_id}&models=${p.model_version_id}`} className={buttonClasses({ variant: "model", size: "sm" })}>
            <Radar aria-hidden="true" /> Score again
          </Link>
        ) : null}
      </div>
      <PredictionVerdict p={p} catalogLabels={p.catalog_labels} showLink={false} />
      {eph.period_days && eph.epoch !== undefined && eph.duration_hours ? (
        <EphemerisLine
          ephemeris={{
            period_days: eph.period_days,
            epoch: eph.epoch,
            duration_hours: eph.duration_hours,
            depth_ppm: eph.depth_ppm ?? null,
            source: eph.source === "catalogue" || eph.source === "measured" || eph.source === "estimate" ? eph.source : "manual",
            label: eph.label ?? "",
            time_system: eph.time_system ?? "BKJD",
          }}
        />
      ) : null}
      <section aria-label="Stored model input">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="eyebrow text-fg-secondary">Stored model input</span>
          {p.views_source ? <span className="text-xs text-fg-secondary">{p.views_source}</span> : null}
        </div>
        {p.views ? (
          <ModelInputViews views={p.views} period={eph.period_days} durationHours={eph.duration_hours} />
        ) : (
          <p className="text-sm text-fg-secondary">The model input views were not stored with this prediction (batch runs store only the score).</p>
        )}
      </section>
      {quality ? <QualityReport report={quality} /> : null}
      <CatalogueLabelsPanel labels={p.catalog_labels} />
      <section aria-label="Measured features">
        <div className="mb-2 flex items-center gap-2">
          <span className="eyebrow text-fg-secondary">Measured features</span>
          <ProvenanceChip kind="measured" size="xs" />
        </div>
        <FeatureList features={p.features} />
      </section>
      <WarningList warnings={p.warnings} />
      <p className="text-xs text-fg-secondary">
        {p.disclaimer} Stored {formatDateTime(p.created_at)} · pipeline v<span className="num">{p.pipeline_version ?? "—"}</span>
        {p.batch_job_id ? (
          <>
            {" "}
            · batch job <span className="num">{p.batch_job_id.slice(0, 8)}</span>
          </>
        ) : null}
        .
      </p>
    </div>
  );
}

export default function PredictionHistoryPage() {
  const u = useUrlState();
  const models = useModels(true);
  const limit = PAGE_SIZES.includes(u.int("limit") ?? 0) ? (u.int("limit") as number) : 50;
  const src = u.str("src");
  const query: PredictionQuery = {
    kepid: u.int("kepid"),
    model_version_id: u.int("model"),
    source_type: src === "catalog" || src === "fits" || src === "csv" ? src : null,
    signal_id: u.int("signal"),
    batch_job_id: u.str("batch"),
    limit,
    offset: Math.max(0, u.int("offset") ?? 0),
  };
  const preds = usePredictions(query);
  const columns = useColumns();
  const page = preds.data;
  const selectedId = u.int("id");
  const filtered = Boolean(query.kepid || query.model_version_id || query.source_type || query.signal_id || query.batch_job_id);
  const clear = () => u.set({ kepid: null, model: null, src: null, signal: null, batch: null, offset: null });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Detect · 03" title="Prediction History" description="Every score you have made, with the model, input, threshold and data quality recorded at the time. Select a row to see the stored model input and warnings." />
      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="KIC id">
            <Input
              mono
              inputMode="numeric"
              placeholder="e.g. 11442793"
              defaultValue={query.kepid ?? ""}
              key={query.kepid ?? "none"}
              onBlur={(e) => u.set({ kepid: e.target.value.replace(/\D/g, "") || null, offset: null })}
              onKeyDown={(e) => {
                if (e.key === "Enter") u.set({ kepid: (e.target as HTMLInputElement).value.replace(/\D/g, "") || null, offset: null });
              }}
            />
          </Field>
          <Field label="Model">
            <Select
              value={u.str("model") ?? ""}
              onChange={(v) => u.set({ model: v, offset: null })}
              options={[{ value: "", label: "All models" }, ...(models.data ?? []).map((m) => ({ value: String(m.id), label: `${m.name}${m.is_fixture ? " (fixture)" : ""}` }))]}
            />
          </Field>
          <Field label="Input">
            <Select value={src ?? ""} onChange={(v) => u.set({ src: v, offset: null })} options={SOURCE_TYPES} />
          </Field>
          <div className="flex items-end">
            <Button variant="ghost" icon={<X />} onClick={clear} disabled={!filtered}>
              Clear filters
            </Button>
          </div>
        </div>
        {query.signal_id || query.batch_job_id ? (
          <p className="mt-3 flex flex-wrap gap-2 text-xs text-fg-secondary">
            {query.signal_id ? <Badge mono>signal #{query.signal_id}</Badge> : null}
            {query.batch_job_id ? <Badge mono>batch {query.batch_job_id.slice(0, 8)}</Badge> : null}
          </p>
        ) : null}
      </Card>

      {preds.isError ? <ApiErrorBanner error={preds.error} onRetry={() => void preds.refetch()} /> : null}
      <DataTable
        caption="Stored predictions"
        data={page?.items ?? []}
        columns={columns}
        getRowId={(r) => String(r.id)}
        loading={preds.isPending}
        manualSorting
        maxHeight="min(64vh, 680px)"
        selectedRowId={selectedId !== null ? String(selectedId) : null}
        onRowClick={(r) => u.set({ id: r.id }, { replace: false })}
        toolbar={<span>{page ? <><span className="num text-fg">{page.total.toLocaleString("en-US")}</span> predictions, newest first</> : null}</span>}
        emptyTitle={filtered ? "No predictions match these filters" : "No predictions yet"}
        emptyDescription={filtered ? "Clear a filter to see more." : "Score a catalogue signal or an uploaded light curve in Planet Detection, or run a batch in the Candidate Explorer."}
        emptyActions={
          filtered ? (
            <Button size="sm" icon={<X />} onClick={clear}>
              Clear filters
            </Button>
          ) : (
            <Link to="/detect" className={buttonClasses({ variant: "model", size: "sm" })}>
              <Radar aria-hidden="true" /> Planet Detection
            </Link>
          )
        }
      />
      {page && page.total > 0 ? (
        <Pagination total={page.total} offset={page.offset} limit={page.limit} noun="predictions" pageSizes={PAGE_SIZES} busy={preds.isFetching} onChange={(offset, l) => u.set({ offset: offset || null, limit: l === 50 ? null : l })} />
      ) : null}

      <Drawer
        open={selectedId !== null}
        onClose={() => u.set({ id: null })}
        width={880}
        title={selectedId !== null ? `Prediction #${selectedId}` : ""}
        description={(() => {
          const row = page?.items.find((p) => p.id === selectedId);
          return row ? (
            <span className="num">
              {row.signal_key ?? row.input_name}
              {row.kepid ? ` · ${formatKepid(row.kepid)}` : ""} · {row.model_name}
            </span>
          ) : undefined;
        })()}
      >
        {selectedId !== null ? <PredictionDetail id={selectedId} /> : null}
      </Drawer>
    </div>
  );
}
