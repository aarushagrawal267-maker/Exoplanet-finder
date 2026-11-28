/**
 * LightCurvePlot — flux versus time for one or more linked panels (e.g. raw PDCSAP → trend →
 * flattened), sharing a single time axis so zooming one zooms all.
 *
 * Rendering choices:
 *  - Cadences are WebGL points (scattergl) at low opacity: a Kepler quarter has ~4,400 long-cadence
 *    points and a full mission ~65,000, which SVG cannot draw interactively.
 *  - The optional binned line is SVG (so it also appears in the range slider, which ignores GL
 *    traces) and summarises the trend under the scatter.
 *  - Transit windows (T14 around each predicted mid-transit time) are shaded bands spanning every
 *    panel, so the eye can check whether dips line up with the ephemeris.
 */
import { useMemo } from "react";
import type { Data, Layout, Shape } from "plotly.js";
import { binMedian } from "@/lib/binning";
import { colors } from "@/styles/tokens";
import { Plot } from "./Plot";
import { chartColors, MONO, plotlyAxis, plotlyLayout, withAlpha } from "./theme";

export interface LightCurvePanel {
  id: string;
  /** Panel label drawn at its top-left, e.g. "PDCSAP flux". */
  label: string;
  time: ArrayLike<number>;
  flux: ArrayLike<number>;
  /** Pre-binned line, or "auto" to median-bin for display, or false for none (default "auto"). */
  binned?: { time: number[]; flux: number[] } | "auto" | false;
  /** Point colour (defaults to secondary ink). */
  color?: string;
  /** Overlay line drawn on top (e.g. the fitted trend on the raw panel). */
  overlay?: { time: ArrayLike<number>; flux: ArrayLike<number>; label: string; color?: string };
  yTitle?: string;
}

export interface TransitWindow {
  start: number;
  end: number;
}

export interface LightCurvePlotProps {
  panels: LightCurvePanel[];
  /** Explicit transit windows (same time system as `time`). */
  transitWindows?: TransitWindow[];
  /** Or derive windows from an ephemeris: period & epoch in days, duration (T14) in hours. */
  ephemeris?: { period: number; epoch: number; durationHours: number };
  /** Time system label for the axis, e.g. "BKJD" (= BJD − 2,454,833). */
  timeSystem?: string;
  rangeSlider?: boolean;
  /** Height of each panel in px (the slider adds ~60 px). */
  panelHeight?: number;
  /** Accessible summary. */
  ariaLabel?: string;
  className?: string;
}

/** Maximum shaded windows; beyond this the bands would cost more than they help. */
const MAX_BANDS = 600;

/**
 * Insert nulls where consecutive x values are further apart than `maxGap`, so line traces break
 * at data gaps (e.g. between Kepler quarters) instead of drawing a misleading straight segment.
 */
export function breakAtGaps(x: ArrayLike<number>, y: ArrayLike<number>, maxGap: number): { x: Array<number | null>; y: Array<number | null> } {
  const ox: Array<number | null> = [];
  const oy: Array<number | null> = [];
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    if (i > 0 && (x[i] as number) - (x[i - 1] as number) > maxGap) {
      ox.push(null);
      oy.push(null);
    }
    ox.push(x[i] as number);
    oy.push(y[i] as number);
  }
  return { x: ox, y: oy };
}

/** Median spacing of sorted samples (robust cadence estimate). */
function medianStep(x: ArrayLike<number>): number {
  const d: number[] = [];
  for (let i = 1; i < x.length; i += 1) d.push((x[i] as number) - (x[i - 1] as number));
  d.sort((a, b) => a - b);
  return d.length ? (d[d.length >> 1] as number) : 0;
}

function toArray(a: ArrayLike<number>): number[] {
  return Array.isArray(a) ? (a as number[]) : Array.from(a);
}

function range(a: ArrayLike<number>): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < a.length; i += 1) {
    const v = a[i] as number;
    if (Number.isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return [lo, hi];
}

/** Transit windows [Tc − T14/2, Tc + T14/2] for every epoch Tc = T0 + n·P inside [tMin, tMax]. */
export function transitWindowsFromEphemeris(
  ephemeris: { period: number; epoch: number; durationHours: number },
  tMin: number,
  tMax: number,
): TransitWindow[] {
  const { period, epoch, durationHours } = ephemeris;
  if (!(period > 0) || !Number.isFinite(epoch) || !(tMax > tMin)) return [];
  const half = durationHours / 24 / 2;
  const nStart = Math.ceil((tMin - half - epoch) / period);
  const nEnd = Math.floor((tMax + half - epoch) / period);
  const out: TransitWindow[] = [];
  for (let n = nStart; n <= nEnd && out.length < MAX_BANDS; n += 1) {
    const c = epoch + n * period;
    out.push({ start: c - half, end: c + half });
  }
  return out;
}

export function LightCurvePlot({
  panels,
  transitWindows,
  ephemeris,
  timeSystem = "BKJD",
  rangeSlider = true,
  panelHeight = 220,
  ariaLabel,
  className,
}: LightCurvePlotProps) {
  const n = Math.max(1, panels.length);
  const height = n * panelHeight + (rangeSlider ? 72 : 24);

  const { data, layout } = useMemo(() => {
    const gap = n > 1 ? 0.05 : 0;
    const span = (1 - gap * (n - 1)) / n;
    let tMin = Number.POSITIVE_INFINITY;
    let tMax = Number.NEGATIVE_INFINITY;
    const traces: Data[] = [];
    const layoutAxes: Record<string, unknown> = {};
    const annotations: NonNullable<Layout["annotations"]> = [];

    panels.forEach((p, i) => {
      const yName = i === 0 ? "y" : `y${i + 1}`;
      const axisKey = i === 0 ? "yaxis" : `yaxis${i + 1}`;
      // Panel 0 at the top.
      const top = 1 - i * (span + gap);
      const domain: [number, number] = [Math.max(0, top - span), top];
      const t = toArray(p.time);
      const f = toArray(p.flux);
      const [lo, hi] = range(t);
      tMin = Math.min(tMin, lo);
      tMax = Math.max(tMax, hi);

      traces.push({
        type: "scattergl",
        mode: "markers",
        x: t,
        y: f,
        xaxis: "x",
        yaxis: yName,
        name: p.label,
        marker: { size: 2.5, color: withAlpha(p.color ?? chartColors.points, 0.42) },
        hovertemplate: `%{x:.4f} ${timeSystem}<br>%{y:.6f}<extra>${p.label}</extra>`,
      } as Data);

      const binned =
        p.binned === false
          ? null
          : p.binned === undefined || p.binned === "auto"
            ? (() => {
                const b = binMedian(t, f, { nBins: Math.min(1500, Math.max(50, Math.round(t.length / 12))) });
                return { time: b.x, flux: b.y };
              })()
            : p.binned;
      if (binned && binned.time.length > 1) {
        const line = breakAtGaps(binned.time, binned.flux, Math.max(3 * medianStep(binned.time), 0.5));
        traces.push({
          type: "scatter",
          mode: "lines",
          x: line.x,
          y: line.y,
          xaxis: "x",
          yaxis: yName,
          name: `${p.label} (binned)`,
          line: { color: chartColors.binned, width: 1.5 },
          connectgaps: false,
          hoverinfo: "skip",
        } as Data);
      }
      if (p.overlay) {
        const line = breakAtGaps(p.overlay.time, p.overlay.flux, Math.max(5 * medianStep(p.overlay.time), 0.5));
        traces.push({
          type: "scatter",
          mode: "lines",
          x: line.x,
          y: line.y,
          xaxis: "x",
          yaxis: yName,
          name: p.overlay.label,
          line: { color: p.overlay.color ?? chartColors.binned, width: 1.75 },
          hovertemplate: `%{x:.4f} ${timeSystem}<br>%{y:.6f}<extra>${p.overlay.label}</extra>`,
        } as Data);
      }

      layoutAxes[axisKey] = plotlyAxis({
        domain,
        anchor: "x",
        title: { text: p.yTitle ?? "" },
        tickformat: ".4~f",
        fixedrange: false,
      });
      annotations.push({
        xref: "paper",
        yref: "paper",
        x: 0,
        y: domain[1],
        xanchor: "left",
        yanchor: "bottom",
        yshift: 2,
        showarrow: false,
        text: p.label.toUpperCase(),
        font: { family: MONO, size: 10, color: chartColors.tick },
      });
    });

    const windows =
      transitWindows ?? (ephemeris && Number.isFinite(tMin) ? transitWindowsFromEphemeris(ephemeris, tMin, tMax) : []);
    const shapes: Partial<Shape>[] = windows.slice(0, MAX_BANDS).map((w) => ({
      type: "rect",
      xref: "x",
      yref: "paper",
      x0: w.start,
      x1: w.end,
      y0: 0,
      y1: 1,
      fillcolor: chartColors.transitBand,
      line: { width: 0 },
      layer: "below",
    }));

    const bottomAxis = n === 1 ? "y" : `y${n}`;
    const l = plotlyLayout({
      height,
      margin: { l: 64, r: 16, t: 22, b: rangeSlider ? 8 : 40 },
      shapes,
      annotations,
      xaxis: plotlyAxis({
        anchor: bottomAxis,
        title: { text: `Time (${timeSystem})` },
        tickformat: ".1f",
        rangeslider: rangeSlider
          ? { visible: true, thickness: 0.09, bgcolor: colors.space, bordercolor: colors.hairline, borderwidth: 1 }
          : undefined,
      }) as Layout["xaxis"],
      ...(layoutAxes as Partial<Layout>),
    });
    return { data: traces, layout: l };
  }, [panels, transitWindows, ephemeris, timeSystem, rangeSlider, n, height]);

  return (
    <Plot
      className={className}
      data={data}
      layout={layout}
      height={height}
      ariaLabel={ariaLabel ?? `Light curve: ${panels.map((p) => p.label).join(", ")} versus time (${timeSystem})`}
    />
  );
}
