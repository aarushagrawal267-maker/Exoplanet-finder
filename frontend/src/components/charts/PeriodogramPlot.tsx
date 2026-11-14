/**
 * PeriodogramPlot — Box Least Squares power versus trial period (log-scaled period axis).
 *
 * The strongest peak marks the best-fitting period; dotted guides at P/2 and 2P flag the usual
 * aliases (a BLS peak at half or twice the true period is common when odd/even transits differ or
 * data gaps hide every other event).
 */
import { useMemo } from "react";
import type { Data, Layout, Shape } from "plotly.js";
import { formatDays } from "@/lib/format";
import { Plot } from "./Plot";
import { chartColors, MONO, plotlyAxis, plotlyLayout } from "./theme";

export interface PeriodogramPlotProps {
  periods: ArrayLike<number>;
  power: ArrayLike<number>;
  /** Best period (days). Defaults to the argmax of `power`. */
  bestPeriod?: number;
  /** Additional periods to mark (e.g. the catalogue period), with labels. */
  markers?: Array<{ period: number; label: string }>;
  showAliases?: boolean;
  powerLabel?: string;
  height?: number;
  ariaLabel?: string;
  className?: string;
}

/** 1–2–5 ticks covering [lo, hi] for a log period axis. */
export function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  if (!(lo > 0) || !(hi > lo)) return out;
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e += 1) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= lo * 0.999 && v <= hi * 1.001) out.push(Number(v.toPrecision(3)));
    }
  }
  return out;
}

export function PeriodogramPlot({
  periods,
  power,
  bestPeriod,
  markers = [],
  showAliases = true,
  powerLabel = "BLS power",
  height = 280,
  ariaLabel,
  className,
}: PeriodogramPlotProps) {
  const { data, layout, best } = useMemo(() => {
    const p = Array.from(periods);
    const w = Array.from(power);
    let best = bestPeriod;
    if (best === undefined && w.length) {
      let iMax = 0;
      w.forEach((v, i) => {
        if (v > (w[iMax] as number)) iMax = i;
      });
      best = p[iMax];
    }
    const traces: Data[] = [
      {
        type: "scatter",
        mode: "lines",
        x: p,
        y: w,
        name: powerLabel,
        line: { color: chartColors.binned, width: 1.25 },
        hovertemplate: "P = %{x:.5f} d<br>power %{y:.4g}<extra></extra>",
      } as Data,
    ];
    const vline = (x: number, color: string, dash: string, width = 1): Partial<Shape> => ({
      type: "line",
      xref: "x",
      yref: "paper",
      x0: x,
      x1: x,
      y0: 0,
      y1: 1,
      line: { color, width, dash: dash as never },
      layer: "below",
    });
    const shapes: Partial<Shape>[] = [];
    const annotations: NonNullable<Layout["annotations"]> = [];
    const pMin = Math.min(...p);
    const pMax = Math.max(...p);
    if (best !== undefined && Number.isFinite(best)) {
      shapes.push(vline(best, chartColors.text, "solid", 1));
      annotations.push({
        x: Math.log10(best),
        xref: "x",
        yref: "paper",
        y: 1,
        yanchor: "bottom",
        showarrow: false,
        text: `P = ${formatDays(best)}`,
        font: { family: MONO, size: 11, color: chartColors.text },
      });
      if (showAliases) {
        // Alias labels sit just inside the plot top, on the far side of their guide from the
        // best period (P/2 to the left, 2P to the right). Centring them above the plot made them
        // collide with the "P = …" label whenever the plot is narrow (phones, two-up layouts).
        for (const [f, lab, side] of [
          [0.5, "P/2", "right"],
          [2, "2P", "left"],
        ] as const) {
          const x = best * f;
          if (x < pMin || x > pMax) continue;
          shapes.push(vline(x, chartColors.reference, "dot"));
          annotations.push({
            x: Math.log10(x),
            xref: "x",
            yref: "paper",
            y: 1,
            yanchor: "top",
            xanchor: side,
            xshift: side === "right" ? -3 : 3,
            showarrow: false,
            text: lab,
            font: { family: MONO, size: 10, color: chartColors.tick },
          });
        }
      }
    }
    markers.forEach((m) => {
      shapes.push(vline(m.period, chartColors.model, "dash"));
      annotations.push({
        x: Math.log10(m.period),
        xref: "x",
        yref: "paper",
        y: 0.86,
        yanchor: "top",
        xanchor: "left",
        xshift: 4,
        showarrow: false,
        text: m.label,
        font: { family: MONO, size: 10, color: chartColors.model },
      });
    });
    return {
      best,
      data: traces,
      layout: plotlyLayout({
        height,
        margin: { l: 56, r: 16, t: 28, b: 40 },
        shapes,
        annotations,
        xaxis: plotlyAxis({ type: "log", title: { text: "Trial period (days)" }, tickvals: logTicks(pMin, pMax), tickformat: "~g" }) as never,
        yaxis: plotlyAxis({ title: { text: powerLabel }, tickformat: "~g", rangemode: "tozero" }) as never,
      }),
    };
  }, [periods, power, bestPeriod, markers, showAliases, powerLabel, height]);

  return (
    <Plot
      className={className}
      data={data}
      layout={layout}
      height={height}
      ariaLabel={ariaLabel ?? `Periodogram: ${powerLabel} versus trial period${best ? `, peak at ${formatDays(best)}` : ""}`}
    />
  );
}
