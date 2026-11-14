/**
 * PhaseFoldPlot — the light curve folded on the orbital period, centred on mid-transit.
 *
 * x is the time from mid-transit in hours (phase in days × 24), so a transit's duration can be
 * read directly. Folding stacks every transit, so a real signal emerges from the noise as the
 * binned medians (cosmic line) trace a coherent U/box-shaped dip. The in-transit window
 * (|Δt| < T14/2) is shaded.
 */
import { useMemo } from "react";
import type { Data, Shape } from "plotly.js";
import { binMedian } from "@/lib/binning";
import { Plot } from "./Plot";
import { chartColors, plotlyAxis, plotlyLayout, withAlpha } from "./theme";

export interface PhaseFoldPlotProps {
  /** Phase in DAYS from mid-transit, in [−P/2, P/2). */
  phase: ArrayLike<number>;
  flux: ArrayLike<number>;
  /** Pre-computed bins (phase in days), or "auto" (default). */
  binned?: { phase: number[]; flux: number[] } | "auto" | false;
  /** Transit duration T14 in hours (shades the window and sets the default zoom). */
  durationHours?: number;
  /** Visible half-width in transit durations (default 3 → ±3·T14); null shows the full orbit. */
  zoomDurations?: number | null;
  /** Optional model light curve, phase in days. */
  model?: { phase: number[]; flux: number[]; label?: string };
  /** Show flux as relative flux (default) or as ppm offset from 1. */
  units?: "relative" | "ppm";
  height?: number;
  ariaLabel?: string;
  className?: string;
}

export function PhaseFoldPlot({
  phase,
  flux,
  binned = "auto",
  durationHours,
  zoomDurations = 3,
  model,
  units = "relative",
  height = 320,
  ariaLabel,
  className,
}: PhaseFoldPlotProps) {
  const { data, layout } = useMemo(() => {
    const toY = (v: number) => (units === "ppm" ? (v - 1) * 1e6 : v);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < Math.min(phase.length, flux.length); i += 1) {
      xs.push((phase[i] as number) * 24);
      ys.push(toY(flux[i] as number));
    }
    const half = durationHours && zoomDurations ? durationHours * zoomDurations : null;

    const traces: Data[] = [
      {
        type: "scattergl",
        mode: "markers",
        x: xs,
        y: ys,
        name: "Cadences",
        marker: { size: 3, color: withAlpha(chartColors.points, 0.35) },
        hovertemplate: units === "ppm" ? "%{x:.2f} h<br>%{y:.0f} ppm<extra></extra>" : "%{x:.2f} h<br>%{y:.6f}<extra></extra>",
      } as Data,
    ];

    let bx: number[] = [];
    let by: number[] = [];
    if (binned === "auto") {
      const lo = half ? -half : undefined;
      const hi = half ? half : undefined;
      const nBins = half && durationHours ? Math.max(30, Math.round(((2 * half) / durationHours) * 12)) : 200;
      const b = binMedian(xs, ys, { nBins, xMin: lo, xMax: hi });
      bx = b.x;
      by = b.y;
    } else if (binned) {
      bx = binned.phase.map((p) => p * 24);
      by = binned.flux.map(toY);
    }
    if (bx.length > 1) {
      traces.push({
        type: "scatter",
        mode: "lines+markers",
        x: bx,
        y: by,
        name: "Binned median",
        line: { color: chartColors.binned, width: 2 },
        marker: { size: 4, color: chartColors.binned },
        hovertemplate: units === "ppm" ? "%{x:.2f} h<br>median %{y:.0f} ppm<extra></extra>" : "%{x:.2f} h<br>median %{y:.6f}<extra></extra>",
      } as Data);
    }
    if (model) {
      traces.push({
        type: "scatter",
        mode: "lines",
        x: model.phase.map((p) => p * 24),
        y: model.flux.map(toY),
        name: model.label ?? "Model",
        line: { color: chartColors.model, width: 1.75, dash: "dash" },
        hoverinfo: "skip",
      } as Data);
    }

    const shapes: Partial<Shape>[] = durationHours
      ? [
          {
            type: "rect",
            xref: "x",
            yref: "paper",
            x0: -durationHours / 2,
            x1: durationHours / 2,
            y0: 0,
            y1: 1,
            fillcolor: chartColors.transitBand,
            line: { width: 0 },
            layer: "below",
          },
        ]
      : [];

    return {
      data: traces,
      layout: plotlyLayout({
        height,
        shapes,
        showlegend: false,
        xaxis: plotlyAxis({
          title: { text: "Hours from mid-transit" },
          range: half ? [-half, half] : undefined,
          zeroline: true,
          zerolinecolor: chartColors.axis,
        }) as never,
        yaxis: plotlyAxis({
          title: { text: units === "ppm" ? "Flux offset (ppm)" : "Relative flux" },
          tickformat: units === "ppm" ? ",.0f" : ".4~f",
        }) as never,
      }),
    };
  }, [phase, flux, binned, durationHours, zoomDurations, model, units, height]);

  return (
    <Plot
      className={className}
      data={data}
      layout={layout}
      height={height}
      ariaLabel={ariaLabel ?? "Phase-folded light curve: flux versus hours from mid-transit, with binned medians"}
    />
  );
}
