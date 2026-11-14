/**
 * LightCurveViewer — a star's (or an upload's) processed light curve from the API:
 *
 *  - pipeline stages: raw (per-quarter normalised) → normalised with the fitted trend → flattened;
 *  - quarter / segment timeline: click a segment to zoom the time axis to it;
 *  - predicted transit windows (catalogue or manual ephemeris) shaded across every panel;
 *  - the folded + binned light curve around mid-transit (when an ephemeris is known).
 *
 * Display data are downsampled by the server (`max_points`, 10,000 per stage for overviews); the
 * number of original cadences is always stated.
 */
import { useMemo, useState } from "react";
import { ApiError } from "@/api/client";
import { useLightCurve, type LightCurveParams } from "@/api/endpoints/lightcurves";
import type { EphemerisOut, LightCurveOut, SegmentOut, Series } from "@/api/schemas";
import { LightCurvePlot, type LightCurvePanel, type TransitWindow } from "@/components/charts/LightCurvePlot";
import { PhaseFoldPlot } from "@/components/charts/PhaseFoldPlot";
import { chartColors } from "@/components/charts/theme";
import { DownloadLightCurve } from "@/components/jobs/DownloadLightCurve";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProvenanceChip } from "@/components/ui/ProvenanceChip";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ChartSkeleton } from "@/components/ui/Skeleton";
import { Switch } from "@/components/ui/Switch";
import { cn } from "@/lib/cn";
import { formatBkjd, formatDays, formatHours, formatInt, formatPpm } from "@/lib/format";
import { TransitLoader } from "@/components/brand/TransitLoader";
import { asGrade, pairs } from "./adapters";
import { GradeMark } from "./GradeMark";

export type StageView = "flat" | "normalized" | "raw" | "all";

const STAGE_OPTIONS: ReadonlyArray<{ value: StageView; label: string }> = [
  { value: "flat", label: "Flattened" },
  { value: "normalized", label: "Normalised + trend" },
  { value: "raw", label: "Raw" },
  { value: "all", label: "All stages" },
];

/** Keep only samples with t in [lo, hi]. */
function clip(series: Series | null | undefined, lo: number, hi: number): { time: number[]; flux: number[] } | null {
  if (!series) return null;
  const time: number[] = [];
  const flux: number[] = [];
  for (let i = 0; i < series.time.length; i += 1) {
    const t = series.time[i];
    if (t === null || t === undefined || t < lo || t > hi) continue;
    time.push(t);
    const f = series.flux[i];
    flux.push(f === null || f === undefined ? Number.NaN : f);
  }
  return { time, flux };
}

export function buildPanels(lc: LightCurveOut, view: StageView, range: [number, number] | null): LightCurvePanel[] {
  const [lo, hi] = range ?? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
  const s = lc.stages;
  const raw = clip(s.raw, lo, hi);
  const norm = clip(s.normalized, lo, hi);
  const trend = clip(s.trend, lo, hi);
  const flat = clip(s.flat, lo, hi);
  const panels: LightCurvePanel[] = [];
  if ((view === "raw" || view === "all") && raw) panels.push({ id: "raw", label: "Raw flux (per-quarter normalised)", ...raw, yTitle: "Relative flux" });
  if ((view === "normalized" || view === "all") && norm)
    panels.push({
      id: "normalized",
      label: "Normalised, with fitted trend",
      ...norm,
      binned: false,
      overlay: trend ? { ...trend, label: "Trend model", color: chartColors.model } : undefined,
      yTitle: "Relative flux",
    });
  if ((view === "flat" || view === "all") && flat) panels.push({ id: "flat", label: "Flattened (detrended, clipped)", ...flat, yTitle: "Relative flux" });
  return panels;
}

export function SegmentStrip({
  segments,
  selected,
  onSelect,
  isQuarter,
}: {
  segments: SegmentOut[];
  selected: number | null;
  onSelect: (id: number | null) => void;
  isQuarter: boolean;
}) {
  if (!segments.length) return null;
  const t0 = Math.min(...segments.map((s) => s.t_start));
  const t1 = Math.max(...segments.map((s) => s.t_end));
  const span = t1 - t0 || 1;
  const name = (s: SegmentOut) => (isQuarter ? `Q${s.id}` : `S${s.id}`);
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-pressed={selected === null}
        className={cn(
          "h-7 shrink-0 rounded-md border px-2 text-xs font-medium transition-colors",
          selected === null ? "border-cosmic/60 bg-cosmic/10 text-cosmic" : "border-hairline-strong text-fg-secondary hover:text-fg",
        )}
      >
        All
      </button>
      <div className="relative h-7 min-w-0 flex-1 rounded-md bg-space" role="group" aria-label={isQuarter ? "Kepler quarters" : "Data segments"}>
        {segments.map((s) => {
          const left = ((s.t_start - t0) / span) * 100;
          const width = Math.max(0.6, ((s.t_end - s.t_start) / span) * 100);
          const on = selected === s.id;
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={on}
              aria-label={`${isQuarter ? "Quarter" : "Segment"} ${s.id}: ${formatInt(s.n_used)} of ${formatInt(s.n_cadences)} cadences used, ${formatBkjd(s.t_start, { digits: 1 })} to ${formatBkjd(s.t_end, { digits: 1 })}`}
              title={`${name(s)} · ${formatInt(s.n_used)}/${formatInt(s.n_cadences)} cadences used`}
              onClick={() => onSelect(on ? null : s.id)}
              style={{ left: `${left}%`, width: `${width}%` }}
              className={cn(
                "num absolute inset-y-0.5 overflow-hidden rounded-[3px] border text-[10px] leading-none transition-colors",
                on ? "border-cosmic bg-cosmic/25 text-fg" : "border-hairline-strong bg-surface-raised text-fg-secondary hover:border-fg-muted hover:text-fg",
              )}
            >
              {width > 3.2 ? <span aria-hidden="true">{name(s)}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function EphemerisLine({ ephemeris, className }: { ephemeris: EphemerisOut; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-secondary", className)}>
      <ProvenanceChip kind={ephemeris.source} size="xs" source={ephemeris.label || undefined} />
      <span className="num">P = {formatDays(ephemeris.period_days)}</span>
      <span className="num">T₀ = {formatBkjd(ephemeris.epoch)}</span>
      <span className="num">T₁₄ = {formatHours(ephemeris.duration_hours)}</span>
      {ephemeris.depth_ppm ? <span className="num">depth {formatPpm(ephemeris.depth_ppm)}</span> : null}
      {ephemeris.label ? <span className="num truncate">{ephemeris.label}</span> : null}
    </div>
  );
}

export interface LightCurveViewerProps extends Omit<LightCurveParams, "maxPoints"> {
  /** Show the folded panel when an ephemeris is known (default true). */
  showFolded?: boolean;
  /** Initial stage view. */
  defaultView?: StageView;
  panelHeight?: number;
  /** Called when the star has no cached light curve and the user downloads it. */
  onDownloaded?: () => void;
  className?: string;
}

export function LightCurveViewer({ showFolded = true, defaultView = "flat", panelHeight = 220, onDownloaded, className, ...params }: LightCurveViewerProps) {
  const lc = useLightCurve(params);
  const [view, setView] = useState<StageView>(defaultView);
  const [segment, setSegment] = useState<number | null>(null);
  const [markers, setMarkers] = useState(true);
  const [fullOrbit, setFullOrbit] = useState(false);
  const data = lc.data;

  const seg = data?.segments.find((s) => s.id === segment) ?? null;
  const range: [number, number] | null = seg ? [seg.t_start, seg.t_end] : null;
  const panels = useMemo(() => (data ? buildPanels(data, view, range) : []), [data, view, range?.[0], range?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  const windows: TransitWindow[] = useMemo(() => {
    if (!data?.transit_times || !data.ephemeris || !markers) return [];
    const half = data.ephemeris.duration_hours / 24 / 2;
    return data.transit_times
      .filter((t): t is number => t !== null && (!range || (t >= range[0] - half && t <= range[1] + half)))
      .map((t) => ({ start: t - half, end: t + half }));
  }, [data, markers, range?.[0], range?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  const folded = useMemo(() => {
    if (!data?.folded) return null;
    const pts = pairs(data.folded.phase, data.folded.flux);
    const bins = pairs(data.folded.binned.phase, data.folded.binned.flux);
    return { phase: pts.x, flux: pts.y, binned: { phase: bins.x, flux: bins.y }, window: data.folded.binned.window_days, n: data.folded.n_original };
  }, [data]);

  if (lc.isPending) {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <ChartSkeleton height={panelHeight + 72} label="Loading light curve" />
        <div className="flex items-center gap-2 text-xs text-fg-secondary">
          <TransitLoader size={18} label="Processing" /> Cleaning, detrending and folding the light curve — a few seconds the first time, cached afterwards.
        </div>
      </div>
    );
  }
  if (lc.isError) {
    const err = lc.error;
    if (err instanceof ApiError && err.code === "not_downloaded" && params.kepid) {
      return (
        <EmptyState
          size="sm"
          className={className}
          title="Light curve not downloaded yet"
          description="This star's Kepler long-cadence photometry has not been fetched from NASA MAST. Downloading takes a few seconds to a minute and is cached locally."
          actions={<DownloadLightCurve kepid={params.kepid} onAvailable={() => { void lc.refetch(); onDownloaded?.(); }} />}
        />
      );
    }
    return <ApiErrorBanner className={className} error={err} onRetry={() => void lc.refetch()} />;
  }
  const d = data as LightCurveOut;
  const grade = asGrade(d.quality?.grade);
  const isQuarter = d.source.type === "catalog";
  const ephem = d.ephemeris ?? null;

  return (
    <div className={cn("flex min-w-0 flex-col gap-4", className)} data-testid="lightcurve-viewer">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<StageView> aria-label="Pipeline stage" size="sm" value={view} onChange={setView} options={STAGE_OPTIONS} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-secondary">
          <span className="num">{formatInt(d.n_cadences)} cadences</span>
          <span className="num">{formatInt(d.n_points_final)} after cleaning</span>
          <span className="num">{d.quarters.length ? `${d.quarters.length} quarters` : `${d.segments.length} segments`}</span>
          <span className="num">{d.time_system}</span>
          {lc.isFetching ? <Badge tone="cosmic">Updating…</Badge> : null}
        </div>
      </div>

      <SegmentStrip segments={d.segments} selected={segment} onSelect={setSegment} isQuarter={isQuarter} />

      {panels.length ? (
        <LightCurvePlot
          panels={panels}
          transitWindows={windows}
          timeSystem={d.time_system}
          panelHeight={view === "all" ? Math.round(panelHeight * 0.8) : panelHeight}
          rangeSlider={view !== "all"}
          ariaLabel={`Light curve of ${d.source.input_name}: ${panels.map((p) => p.label).join(", ")}${seg ? `, ${isQuarter ? "quarter" : "segment"} ${seg.id}` : ""}`}
        />
      ) : (
        <p className="text-sm text-fg-secondary">This stage is not available for this light curve.</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {ephem ? <EphemerisLine ephemeris={ephem} /> : <p className="text-xs text-fg-secondary">No ephemeris: choose a signal (or enter one) to mark predicted transits and fold the light curve.</p>}
        {d.transit_times?.length ? (
          <Switch size="sm" checked={markers} onChange={setMarkers} label={<span className="text-sm">Shade predicted transits <span className="num text-fg-secondary">({formatInt(d.transit_times.length)})</span></span>} />
        ) : null}
      </div>

      {showFolded && folded && ephem ? (
        <div className="flex flex-col gap-2 border-t border-hairline pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="eyebrow text-fg-secondary">Folded light curve</span>
              {grade ? <GradeMark grade={grade} size="sm" /> : null}
            </div>
            <SegmentedControl<"window" | "orbit">
              aria-label="Folded view range"
              size="sm"
              value={fullOrbit ? "orbit" : "window"}
              onChange={(v) => setFullOrbit(v === "orbit")}
              options={[
                { value: "window", label: "Transit window" },
                { value: "orbit", label: "Full orbit" },
              ]}
            />
          </div>
          <PhaseFoldPlot
            phase={folded.phase}
            flux={folded.flux}
            binned={fullOrbit ? "auto" : folded.binned}
            durationHours={ephem.duration_hours}
            zoomDurations={fullOrbit ? null : (folded.window * 24) / ephem.duration_hours}
            units="ppm"
            height={280}
            ariaLabel={`Folded light curve of ${d.source.input_name} at P = ${formatDays(ephem.period_days)}, binned medians over ±${formatHours(folded.window * 24)}`}
          />
          <p className="text-xs text-fg-secondary">
            <span className="num">{formatInt(folded.n)}</span> flattened cadences folded on the {ephem.source} ephemeris; the line is the median in{" "}
            <span className="num">{formatInt(folded.binned.phase.length)}</span> bins over ±<span className="num">{formatHours(folded.window * 24)}</span>. Shaded: the transit duration T₁₄.
          </p>
        </div>
      ) : null}

      {d.warnings.length ? (
        <ul className="flex flex-col gap-1 text-xs text-warn">
          {d.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

