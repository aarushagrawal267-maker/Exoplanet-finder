/**
 * Signal Explorer — the NASA catalogue (DR24 TCEs, KOIs, confirmed planets) as a server-paginated,
 * filterable, sortable table, catalogue statistics per category, and a detail panel per signal with
 * its light curve. All filters live in the URL so a view can be shared.
 */
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { ArrowRight, Filter, Radar, RotateCcw, Star, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCatalogStats, useSignals } from "@/api/endpoints/catalog";
import { useTarget } from "@/api/endpoints/targets";
import type { SignalOut, SignalQuery } from "@/api/schemas";
import { TransitIcon } from "@/components/brand/TransitIcon";
import { CategoryHistogram } from "@/components/charts/CategoryHistogram";
import {
  AvLabelBadge,
  CATEGORY_INFO,
  CATEGORY_ORDER,
  CategoryBadge,
  categoryLabel,
  ConflictBadge,
  KoiBadge,
  LcStatusBadge,
} from "@/components/science/CatalogueLabels";
import { LightCurveViewer } from "@/components/science/LightCurveViewer";
import { signalName } from "@/components/science/StarSignalPicker";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, missingAsUndefined } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { KeyValueList, type KeyValueItem } from "@/components/ui/KeyValueList";
import { NumberInput } from "@/components/ui/NumberInput";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { ProvenanceChip } from "@/components/ui/ProvenanceChip";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { ToggleChips } from "@/components/ui/ToggleChips";
import { cn } from "@/lib/cn";
import { formatBkjd, formatDateTime, formatDays, formatHours, formatInt, formatKepid, formatNumber, formatPpm } from "@/lib/format";
import { useDebouncedValue, useMediaQuery } from "@/lib/hooks";
import { useUrlState } from "@/lib/urlState";

const AV_OPTIONS = [
  { value: "PC", label: "PC", title: "Planet candidate" },
  { value: "AFP", label: "AFP", title: "Astrophysical false positive" },
  { value: "NTP", label: "NTP", title: "Non-transiting phenomenon" },
  { value: "UNK", label: "UNK", title: "Unknown" },
  { value: "none", label: "No label", title: "Not a DR24 TCE" },
];
const KOI_OPTIONS = [
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "CANDIDATE", label: "Candidate" },
  { value: "FALSE POSITIVE", label: "False positive" },
  { value: "none", label: "Not a KOI" },
];
const SORTABLE = new Set([
  "signal_key",
  "kepid",
  "period_days",
  "duration_hours",
  "depth_ppm",
  "model_snr",
  "planet_radius_re",
  "category",
  "kepoi_name",
  "kepler_name",
  "av_training_set",
  "koi_disposition",
]);
const PAGE_SIZES = [25, 50, 100, 200];

const triState = (v: string | null): boolean | undefined => (v === "yes" ? true : v === "no" ? false : undefined);

function useSignalFilters() {
  const u = useUrlState();
  const limit = PAGE_SIZES.includes(u.int("limit") ?? 0) ? (u.int("limit") as number) : 50;
  const sort = u.str("sort");
  const query: SignalQuery = {
    search: u.str("q") || undefined,
    category: u.list("cat").join(",") || undefined,
    av_label: u.list("av").join(",") || undefined,
    koi_disposition: u.list("koi").join(",") || undefined,
    has_lightcurve: triState(u.str("lc")),
    conflict: triState(u.str("conflict")),
    min_period: u.num("pmin") ?? undefined,
    max_period: u.num("pmax") ?? undefined,
    min_snr: u.num("snrmin") ?? undefined,
    sort: sort && SORTABLE.has(sort) ? sort : "signal_key",
    order: u.str("order") === "desc" ? "desc" : "asc",
    limit,
    offset: Math.max(0, u.int("offset") ?? 0),
  };
  const active = ["q", "cat", "av", "koi", "lc", "conflict", "pmin", "pmax", "snrmin"].filter((k) => u.str(k)).length;
  return { u, query, active };
}

function Filters({ u, onReset }: { u: ReturnType<typeof useUrlState>; onReset: () => void }) {
  const [search, setSearch] = useState(u.str("q") ?? "");
  const debounced = useDebouncedValue(search, 300);
  useEffect(() => {
    if ((u.str("q") ?? "") !== debounced) u.set({ q: debounced, offset: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  // Follow external URL changes (reset, back button).
  const q = u.str("q") ?? "";
  useEffect(() => {
    setSearch((s) => (s === q ? s : q));
  }, [q]);

  const setList = (key: string) => (v: string[]) => u.set({ [key]: v.join(","), offset: null });
  const setNum = (key: string) => (v: number | null) => u.set({ [key]: v, offset: null });
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Field label="Search">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="KIC id, Kepler-90, K00351.01, TCE key…" type="search" />
        </Field>
        <Field label="Light curve">
          <Select
            value={u.str("lc") ?? ""}
            onChange={(v) => u.set({ lc: v, offset: null })}
            options={[
              { value: "", label: "Any" },
              { value: "yes", label: "Downloaded" },
              { value: "no", label: "Not downloaded" },
            ]}
          />
        </Field>
        <Field label="Label conflict">
          <Select
            value={u.str("conflict") ?? ""}
            onChange={(v) => u.set({ conflict: v, offset: null })}
            options={[
              { value: "", label: "Any" },
              { value: "yes", label: "Only conflicts" },
              { value: "no", label: "No conflict" },
            ]}
          />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div>
          <div className="mb-1.5 text-sm font-medium text-fg">Category</div>
          <ToggleChips
            label="Catalogue category"
            value={u.list("cat")}
            onChange={setList("cat")}
            options={CATEGORY_ORDER.map((c) => ({ value: c, label: CATEGORY_INFO[c]?.label ?? c, title: CATEGORY_INFO[c]?.help }))}
          />
        </div>
        <div>
          <div className="mb-1.5 text-sm font-medium text-fg">DR24 Autovetter label</div>
          <ToggleChips label="DR24 Autovetter label" value={u.list("av")} onChange={setList("av")} options={AV_OPTIONS} />
        </div>
        <div>
          <div className="mb-1.5 text-sm font-medium text-fg">KOI disposition</div>
          <ToggleChips label="KOI disposition" value={u.list("koi")} onChange={setList("koi")} options={KOI_OPTIONS} />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Period from" className="w-[150px]">
          <NumberInput value={u.num("pmin")} onChange={setNum("pmin")} min={0} step={0.1} precision={2} unit="d" allowEmpty hideSteppers placeholder="0" />
        </Field>
        <Field label="Period to" className="w-[150px]">
          <NumberInput value={u.num("pmax")} onChange={setNum("pmax")} min={0} step={0.1} precision={2} unit="d" allowEmpty hideSteppers placeholder="∞" />
        </Field>
        <Field label="Min. model SNR" className="w-[140px]">
          <NumberInput value={u.num("snrmin")} onChange={setNum("snrmin")} step={1} precision={1} allowEmpty hideSteppers placeholder="any" />
        </Field>
        <Button variant="ghost" size="md" icon={<RotateCcw />} onClick={onReset} className="mb-[22px]">
          Reset filters
        </Button>
      </div>
    </div>
  );
}

function useColumns(): ColumnDef<SignalOut>[] {
  return useMemo<ColumnDef<SignalOut>[]>(
    () => [
      {
        id: "signal_key",
        accessorKey: "signal_key",
        header: "Signal",
        meta: { mono: true },
        cell: (c) => {
          const r = c.row.original;
          const name = r.kepler_name ?? (r.signal_key.startsWith("KOI-") ? null : r.kepoi_name);
          return (
            <span className="text-fg">
              {r.signal_key}
              {name ? <span className="ml-2 font-sans text-sm text-fg-secondary">{name}</span> : null}
            </span>
          );
        },
      },
      { id: "kepid", accessorKey: "kepid", header: "KIC", meta: { mono: true }, cell: (c) => c.getValue<number>() },
      { id: "period_days", accessorFn: missingAsUndefined((r: SignalOut) => r.period_days), header: "Period", meta: { numeric: true, headerLabel: "Orbital period, days" }, cell: (c) => formatDays(c.getValue<number | undefined>()) },
      { id: "duration_hours", accessorFn: missingAsUndefined((r: SignalOut) => r.duration_hours), header: "T₁₄", meta: { numeric: true, headerLabel: "Transit duration, hours" }, cell: (c) => formatHours(c.getValue<number | undefined>()) },
      { id: "depth_ppm", accessorFn: missingAsUndefined((r: SignalOut) => r.depth_ppm), header: "Depth", meta: { numeric: true, headerLabel: "Transit depth, ppm" }, cell: (c) => formatPpm(c.getValue<number | undefined>()) },
      { id: "model_snr", accessorFn: missingAsUndefined((r: SignalOut) => r.model_snr), header: "SNR", meta: { numeric: true, headerLabel: "Catalogue model SNR" }, cell: (c) => formatNumber(c.getValue<number | undefined>(), { digits: 1 }) },
      { id: "planet_radius_re", accessorFn: missingAsUndefined((r: SignalOut) => r.planet_radius_re), header: "Rₚ (R⊕)", meta: { numeric: true, headerLabel: "Catalogue planet radius, Earth radii" }, cell: (c) => formatNumber(c.getValue<number | undefined>(), { digits: 2 }) },
      {
        id: "category",
        accessorKey: "category",
        header: "Category",
        cell: (c) => (
          <span className="inline-flex items-center gap-1.5">
            <CategoryBadge category={c.getValue<string>()} />
            {c.row.original.label_conflict ? (
              <span title="Label conflict: the DR24 Autovetter label and the KOI disposition disagree" className="inline-flex text-warn">
                <TriangleAlert className="size-3.5" aria-hidden="true" />
                <span className="sr-only">Label conflict</span>
              </span>
            ) : null}
          </span>
        ),
      },
      { id: "av_training_set", accessorFn: (r) => r.av_training_set ?? undefined, header: "DR24", meta: { headerLabel: "DR24 Autovetter label" }, cell: (c) => <AvLabelBadge label={c.getValue<string | undefined>()} /> },
      { id: "koi_disposition", accessorFn: (r) => r.koi_disposition ?? undefined, header: "KOI", meta: { headerLabel: "KOI disposition" }, cell: (c) => <KoiBadge disposition={c.getValue<string | undefined>()} /> },
      { id: "lc", accessorKey: "lc_status", header: "Light curve", enableSorting: false, cell: (c) => <LcStatusBadge status={c.getValue<string | null>()} /> },
    ],
    [],
  );
}

function SignalDetail({ kepid, signalId, fallback }: { kepid: number; signalId: number; fallback?: SignalOut }) {
  const target = useTarget(kepid);
  const s = target.data?.signals.find((x) => x.id === signalId) ?? fallback;
  if (target.isError && !s) return <ApiErrorBanner error={target.error} onRetry={() => void target.refetch()} />;
  if (!s) return <Skeleton height={240} rounded="md" />;
  const prov = (s.provenance ?? {}) as Record<string, { table?: string; column?: string; snapshot_id?: number }>;
  const src = (field: string) => {
    const p = prov[field];
    return p ? `${p.table}.${p.column} · snapshot #${p.snapshot_id}` : undefined;
  };
  const items: KeyValueItem[] = [
    { key: "period", label: "Orbital period", value: formatDays(s.period_days), provenance: "catalogue", hint: src("period_days") },
    { key: "epoch", label: "Epoch T₀", value: formatBkjd(s.epoch_bkjd), provenance: "catalogue", hint: src("epoch_bkjd") },
    { key: "dur", label: "Duration T₁₄", value: formatHours(s.duration_hours), provenance: "catalogue", hint: src("duration_hours") },
    { key: "depth", label: "Depth", value: formatPpm(s.depth_ppm), provenance: "catalogue", hint: src("depth_ppm") },
    { key: "snr", label: "Model SNR", value: formatNumber(s.model_snr, { digits: 1 }), provenance: "catalogue", hint: src("model_snr") },
    { key: "rp", label: "Planet radius", value: s.planet_radius_re !== null && s.planet_radius_re !== undefined ? `${formatNumber(s.planet_radius_re, { digits: 2 })} R⊕` : "—", provenance: "catalogue", hint: src("planet_radius_re") },
    { key: "score", label: "KOI score", value: formatNumber(s.koi_score, { digits: 3 }), provenance: "catalogue", hint: "Display only — never a model feature" },
    {
      key: "fp",
      label: "KOI false-positive flags",
      value: s.fpflags && Object.values(s.fpflags).some((v) => v !== null && v !== undefined)
        ? `NT ${s.fpflags.nt ?? "—"} · SS ${s.fpflags.ss ?? "—"} · CO ${s.fpflags.co ?? "—"} · EC ${s.fpflags.ec ?? "—"}`
        : "—",
      hint: "Not transit-like · stellar eclipse · centroid offset · ephemeris match",
    },
  ];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <CategoryBadge category={s.category} />
        {s.koi_disposition ? <KoiBadge disposition={s.koi_disposition} prefix /> : null}
        {s.av_training_set ? <AvLabelBadge label={s.av_training_set} prefix /> : null}
        <ConflictBadge conflict={s.label_conflict} compact />
        <LcStatusBadge status={target.data?.target.lc_status ?? s.lc_status} />
        {target.data?.reserved_showcase ? <Badge tone="nebula" title="Forced into test splits; never trained on">Reserved showcase</Badge> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to={`/targets/${s.kepid}?signal=${s.id}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
          <Star aria-hidden="true" /> Target dossier
        </Link>
        <Link to={`/transit?kepid=${s.kepid}&signal=${s.id}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
          <TransitIcon aria-hidden="true" /> Transit analysis
        </Link>
        <Link to={`/detect?kepid=${s.kepid}&signal=${s.id}`} className={buttonClasses({ variant: "model", size: "sm" })}>
          <Radar aria-hidden="true" /> Planet detection
        </Link>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="eyebrow text-fg-secondary">Catalogue values</span>
          <ProvenanceChip kind="catalogue" size="xs" source="NASA Exoplanet Archive" />
        </div>
        <KeyValueList items={items} columns={2} dense />
      </div>
      <div>
        <div className="eyebrow mb-3 text-fg-secondary">Light curve · {formatKepid(s.kepid)}</div>
        <LightCurveViewer kepid={s.kepid} signalId={s.id} panelHeight={200} onDownloaded={() => void target.refetch()} />
      </div>
    </div>
  );
}

function StatsPanel() {
  const stats = useCatalogStats();
  const [mode, setMode] = useState<"count" | "share">("share");
  if (stats.isPending) return <Skeleton height={320} rounded="md" />;
  if (stats.isError) return <ApiErrorBanner error={stats.error} onRetry={() => void stats.refetch()} />;
  const s = stats.data;
  const groups: Array<{ title: string; data: Record<string, number>; label: (k: string) => string }> = [
    { title: "Category", data: s.categories, label: categoryLabel },
    { title: "DR24 Autovetter label", data: s.av_labels, label: (k) => (k === "none" ? "No label" : k) },
    { title: "KOI disposition", data: s.koi_dispositions, label: (k) => (k === "none" ? "Not a KOI" : k.charAt(0) + k.slice(1).toLowerCase()) },
  ];
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {groups.map((g) => (
          <Card key={g.title}>
            <div className="eyebrow mb-3 text-fg-secondary">{g.title}</div>
            <dl className="flex flex-col gap-1.5 text-sm">
              {Object.entries(g.data)
                .sort((a, b) => b[1] - a[1])
                .map(([k, n]) => (
                  <div key={k} className="flex justify-between gap-3 border-b border-hairline pb-1.5 last:border-0">
                    <dt className="text-fg-secondary">{g.label(k)}</dt>
                    <dd className="num text-fg">{formatInt(n)}</dd>
                  </div>
                ))}
            </dl>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-secondary">
          <span className="num text-fg">{formatInt(s.total)}</span> signals · <span className="num text-fg">{formatInt(s.with_lightcurve)}</span> on stars with a cached light curve ·{" "}
          <span className="num text-warn">{formatInt(s.label_conflicts)}</span> label conflicts
        </p>
        <SegmentedControl<"count" | "share">
          aria-label="Histogram scale"
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: "share", label: "% of category" },
            { value: "count", label: "Counts" },
          ]}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {s.histograms.map((h) => (
          <Card key={h.key} className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-fg">{h.label.replace(/^log10 /, "").replace(/^./, (c) => c.toUpperCase())}</span>
              <ProvenanceChip kind="catalogue" size="xs" />
            </div>
            <CategoryHistogram histogram={h} categories={CATEGORY_ORDER} categoryLabel={categoryLabel} mode={mode} />
          </Card>
        ))}
      </div>
      <p className="text-xs text-fg-secondary">
        {s.note} Snapshots:{" "}
        {Object.entries(s.snapshots_retrieved_at)
          .map(([k, v]) => `${k} ${formatDateTime(v)}`)
          .join(" · ")}
        .
      </p>
    </div>
  );
}

export default function SignalExplorerPage() {
  const { u, query, active } = useSignalFilters();
  const signals = useSignals(query);
  const columns = useColumns();
  const wide = useMediaQuery("(min-width: 1024px)");
  const [filtersOpen, setFiltersOpen] = useState<boolean | null>(null);
  const showFilters = filtersOpen ?? wide;
  const tab = u.str("tab") === "stats" ? "stats" : "table";
  const selectedId = u.int("signal");
  const selectedKepid = u.int("kepid");
  const selectedTarget = useTarget(selectedKepid);
  const selectedRow = signals.data?.items.find((r) => r.id === selectedId) ?? selectedTarget.data?.signals.find((r) => r.id === selectedId);

  const sorting: SortingState = [{ id: query.sort ?? "signal_key", desc: query.order === "desc" }];
  const onSortingChange = (updater: SortingState | ((old: SortingState) => SortingState)) => {
    const next = typeof updater === "function" ? updater(sorting) : updater;
    const first = next[0];
    u.set({ sort: first?.id ?? null, order: first?.desc ? "desc" : null, offset: null });
  };
  const reset = () => u.set({ q: null, cat: null, av: null, koi: null, lc: null, conflict: null, pmin: null, pmax: null, snrmin: null, offset: null });

  const page = signals.data;
  const table = (
    <div className="flex flex-col gap-4">
      <Card padding="none" className="overflow-visible">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left lg:hidden"
          aria-expanded={showFilters}
          onClick={() => setFiltersOpen(!showFilters)}
        >
          <span className="flex items-center gap-2 text-sm font-medium text-fg">
            <Filter className="size-4 text-fg-secondary" aria-hidden="true" /> Filters
            {active ? <Badge tone="cosmic">{active} active</Badge> : null}
          </span>
          <span className="text-xs text-fg-secondary">{showFilters ? "Hide" : "Show"}</span>
        </button>
        <div className={cn("px-5 pb-5 lg:pt-5", showFilters ? "block" : "hidden")}>
          <Filters u={u} onReset={reset} />
        </div>
      </Card>

      {signals.isError ? <ApiErrorBanner error={signals.error} onRetry={() => void signals.refetch()} /> : null}

      <DataTable
        caption="Catalogue signals"
        data={page?.items ?? []}
        columns={columns}
        getRowId={(r) => String(r.id)}
        manualSorting
        sorting={sorting}
        onSortingChange={onSortingChange}
        loading={signals.isPending}
        maxHeight="min(62vh, 640px)"
        selectedRowId={selectedId !== null ? String(selectedId) : null}
        onRowClick={(r) => u.set({ signal: r.id, kepid: r.kepid }, { replace: false })}
        toolbar={
          <span className="flex items-center gap-2">
            {page ? (
              <span>
                <span className="num text-fg">{formatInt(page.total)}</span> signals
              </span>
            ) : null}
            {signals.isFetching && !signals.isPending ? <Badge tone="cosmic">Loading…</Badge> : null}
            <ProvenanceChip kind="catalogue" size="xs" source="Values exactly as published by the NASA Exoplanet Archive" />
          </span>
        }
        emptyTitle="No signals match these filters"
        emptyDescription="Loosen a filter or clear the search. If the catalogue itself is empty, refresh it from the Overview page."
        emptyActions={
          active ? (
            <Button size="sm" icon={<X />} onClick={reset}>
              Clear filters
            </Button>
          ) : (
            <Link to="/" className={buttonClasses({ size: "sm" })}>
              Overview <ArrowRight aria-hidden="true" />
            </Link>
          )
        }
      />
      {page ? (
        <Pagination
          total={page.total}
          offset={page.offset}
          limit={page.limit}
          noun="signals"
          pageSizes={PAGE_SIZES}
          busy={signals.isFetching}
          onChange={(offset, limit) => u.set({ offset: offset || null, limit: limit === 50 ? null : limit })}
        />
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Observe · 02"
        title="Signal Explorer"
        description="Every Kepler DR24 threshold-crossing event, KOI and confirmed planet in the local catalogue, with NASA's own labels. Select a signal to see its light curve."
      />
      <Tabs
        aria-label="Signal Explorer views"
        value={tab}
        onChange={(id) => u.set({ tab: id === "stats" ? "stats" : null })}
        items={[
          { id: "table", label: "Signals", content: table },
          { id: "stats", label: "Category statistics", content: <StatsPanel /> },
        ]}
      />
      <Drawer
        open={selectedId !== null}
        onClose={() => u.set({ signal: null, kepid: null })}
        width={920}
        title={selectedRow ? signalName(selectedRow) : selectedId !== null ? `Signal ${selectedId}` : ""}
        description={
          selectedRow ? (
            <span className="num">
              {selectedRow.signal_key} · {formatKepid(selectedRow.kepid)}
              {selectedRow.kepler_host_name ? ` · ${selectedRow.kepler_host_name}` : ""}
            </span>
          ) : undefined
        }
      >
        {selectedId !== null && selectedKepid !== null ? (
          <SignalDetail kepid={selectedKepid} signalId={selectedId} fallback={selectedRow} />
        ) : selectedId !== null ? (
          <p className="text-sm text-fg-secondary">This link is missing the star (kepid). Select the signal from the table again.</p>
        ) : null}
      </Drawer>
    </div>
  );
}
