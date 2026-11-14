/**
 * TransitDepthsPlot — the depth measured at each individual transit (with ±1σ error bars) versus
 * its mid-transit time. A real planet gives a flat band around the folded depth; alternating
 * depths hint at an eclipsing binary at twice the period, and isolated deep events at systematics.
 * Odd and even transit numbers use different marker shapes so the alternation is visible without
 * relying on colour.
 */
import { useMemo } from "react";
import type { Data, Shape } from "plotly.js";
import { Plot } from "./Plot";
import { chartColors, plotlyAxis, plotlyLayout } from "./theme";

export interface TransitDepthPoint {
  index: number;
  epoch: number;
  depth_ppm: number | null;
  err_ppm: number | null;
}

export interface TransitDepthsPlotProps {
  transits: TransitDepthPoint[];
  /** Folded (all-transit) depth for the reference line, ppm. */
  meanDepth?: number | null;
  timeSystem?: string;
  height?: number;
  className?: string;
}

export function TransitDepthsPlot({ transits, meanDepth, timeSystem = "BKJD", height = 240, className }: TransitDepthsPlotProps) {
  const { data, layout } = useMemo(() => {
    const ok = transits.filter((t) => t.depth_ppm !== null && Number.isFinite(t.depth_ppm));
    const trace = (parity: 0 | 1): Data =>
      ({
        type: "scatter",
        mode: "markers",
        name: parity === 0 ? "Even transits" : "Odd transits",
        x: ok.filter((t) => t.index % 2 === parity).map((t) => t.epoch),
        y: ok.filter((t) => t.index % 2 === parity).map((t) => t.depth_ppm),
        error_y: {
          type: "data",
          array: ok.filter((t) => t.index % 2 === parity).map((t) => t.err_ppm ?? 0),
          color: "rgba(154,166,196,0.55)",
          thickness: 1,
          width: 0,
        },
        marker: { size: 7, symbol: parity === 0 ? "circle" : "diamond", color: parity === 0 ? chartColors.binned : chartColors.model, line: { width: 1, color: "#0F1629" } },
        customdata: ok.filter((t) => t.index % 2 === parity).map((t) => t.index),
        hovertemplate: `transit #%{customdata}<br>%{x:.4f} ${timeSystem}<br>%{y:,.0f} ppm<extra></extra>`,
      }) as Data;
    const shapes: Partial<Shape>[] =
      meanDepth && Number.isFinite(meanDepth)
        ? [{ type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: meanDepth, y1: meanDepth, line: { color: chartColors.text, width: 1, dash: "dash" } }]
        : [];
    return {
      data: [trace(0), trace(1)],
      layout: plotlyLayout({
        height,
        shapes,
        showlegend: true,
        legend: { orientation: "h", x: 0, y: 1.12, font: { size: 11, color: chartColors.tick }, bgcolor: "rgba(0,0,0,0)" },
        margin: { l: 64, r: 16, t: 28, b: 40 },
        xaxis: plotlyAxis({ title: { text: `Mid-transit time (${timeSystem})` }, tickformat: ".0f" }) as never,
        yaxis: plotlyAxis({ title: { text: "Depth (ppm)" }, tickformat: ",.0f" }) as never,
      }),
    };
  }, [transits, meanDepth, timeSystem, height]);
  return <Plot className={className} data={data} layout={layout} height={height} ariaLabel={`Depth of ${transits.length} individual transits versus time, odd and even transits marked differently`} />;
}
