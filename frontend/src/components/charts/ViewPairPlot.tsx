/**
 * ViewPairPlot — the two fixed-length inputs the CNN actually sees (AstroNet, Shallue &
 * Vanderburg 2018):
 *  - Global view: the whole folded orbit in 2001 bins (shape of the full phase curve, secondary
 *    eclipses, out-of-transit variability).
 *  - Local view: ±2 transit durations in 201 bins (detailed transit shape: U vs V, ingress).
 * Both are normalised to median 0 and minimum −1, which is why the y axes are shared.
 * Drawn in nebula violet because they are model inputs.
 *
 * Side by side (60 / 40) when the container is wide; stacked (global above local) below
 * STACK_BELOW px, where a 40 % local panel is too narrow to read and the two x axes' tick
 * labels would run into each other.
 */
import { useMemo } from "react";
import type { Data } from "plotly.js";
import { useElementWidth } from "@/lib/hooks";
import { Plot } from "./Plot";
import { chartColors, MONO, plotlyAxis, plotlyLayout } from "./theme";

export interface ViewPairPlotProps {
  global: ArrayLike<number>;
  local: ArrayLike<number>;
  /** x for the global view; default orbital phase fraction in [−0.5, 0.5]. */
  globalX?: ArrayLike<number>;
  /** x for the local view; default transit durations in [−2, 2]. */
  localX?: ArrayLike<number>;
  globalXTitle?: string;
  localXTitle?: string;
  /** Optional comparison overlay (e.g. a class-average view), drawn dashed. */
  compare?: { global: ArrayLike<number>; local: ArrayLike<number>; label: string };
  height?: number;
  ariaLabel?: string;
  className?: string;
}

/** Container width (px) below which the two views are stacked vertically. */
const STACK_BELOW = 560;

function linspace(lo: number, hi: number, n: number): number[] {
  if (n <= 1) return [0];
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
}

export function ViewPairPlot({
  global,
  local,
  globalX,
  localX,
  globalXTitle = "Orbital phase",
  localXTitle = "Transit durations from mid-transit",
  compare,
  height = 260,
  ariaLabel,
  className,
}: ViewPairPlotProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const stacked = width > 0 && width < STACK_BELOW;
  // Stacked: each view keeps roughly the plot height it had side by side.
  const totalHeight = stacked ? Math.round(height * 1.85) : height;
  const { data, layout } = useMemo(() => {
    const gx = globalX ? Array.from(globalX) : linspace(-0.5, 0.5, global.length);
    const lx = localX ? Array.from(localX) : linspace(-2, 2, local.length);
    const traces: Data[] = [
      {
        type: "scatter",
        mode: "lines",
        x: gx,
        y: Array.from(global),
        xaxis: "x",
        yaxis: "y",
        name: "Global view",
        line: { color: chartColors.model, width: 1.25 },
        hovertemplate: "phase %{x:.3f}<br>%{y:.3f}<extra>Global</extra>",
      } as Data,
      {
        type: "scatter",
        mode: "lines+markers",
        x: lx,
        y: Array.from(local),
        xaxis: "x2",
        yaxis: "y2",
        name: "Local view",
        line: { color: chartColors.model, width: 1.5 },
        marker: { size: 3, color: chartColors.model },
        hovertemplate: "%{x:.2f} T14<br>%{y:.3f}<extra>Local</extra>",
      } as Data,
    ];
    if (compare) {
      traces.push(
        {
          type: "scatter",
          mode: "lines",
          x: gx,
          y: Array.from(compare.global),
          xaxis: "x",
          yaxis: "y",
          name: compare.label,
          line: { color: chartColors.tick, width: 1, dash: "dot" },
          hoverinfo: "skip",
        } as Data,
        {
          type: "scatter",
          mode: "lines",
          x: lx,
          y: Array.from(compare.local),
          xaxis: "x2",
          yaxis: "y2",
          name: compare.label,
          line: { color: chartColors.tick, width: 1, dash: "dot" },
          hoverinfo: "skip",
        } as Data,
      );
    }
    const label = (x: number, y: number, text: string) => ({
      xref: "paper" as const,
      yref: "paper" as const,
      x,
      y,
      xanchor: "left" as const,
      yanchor: "bottom" as const,
      yshift: 2,
      showarrow: false,
      text,
      font: { family: MONO, size: 10, color: chartColors.tick },
    });
    // Domains: side by side shares one y range; stacked gives each view its own row.
    const gDom = stacked ? { x: [0, 1], y: [0.58, 1] } : { x: [0, 0.6], y: [0, 1] };
    const lDom = stacked ? { x: [0, 1], y: [0, 0.42] } : { x: [0.66, 1], y: [0, 1] };
    return {
      data: traces,
      layout: plotlyLayout({
        height: totalHeight,
        margin: { l: 48, r: 12, t: 24, b: 40 },
        annotations: [
          label(gDom.x[0] as number, gDom.y[1] as number, `GLOBAL VIEW · ${global.length} BINS`),
          label(lDom.x[0] as number, lDom.y[1] as number, `LOCAL VIEW · ${local.length} BINS`),
        ],
        xaxis: plotlyAxis({ domain: gDom.x, anchor: "y", title: { text: globalXTitle }, range: [gx[0], gx[gx.length - 1]] }) as never,
        yaxis: plotlyAxis({ domain: gDom.y, anchor: "x", title: { text: "Normalised flux" }, tickformat: ".1f" }) as never,
        xaxis2: plotlyAxis({ domain: lDom.x, anchor: "y2", title: { text: localXTitle }, range: [lx[0], lx[lx.length - 1]] }) as never,
        yaxis2: plotlyAxis({
          domain: lDom.y,
          anchor: "x2",
          matches: "y",
          // Stacked, the local view needs its own tick labels and title.
          showticklabels: stacked,
          title: { text: stacked ? "Normalised flux" : "" },
          tickformat: ".1f",
        }) as never,
      }),
    };
  }, [global, local, globalX, localX, globalXTitle, localXTitle, compare, totalHeight, stacked]);

  return (
    <div ref={ref} className={className}>
      <Plot
        data={data}
        layout={layout}
        height={totalHeight}
        ariaLabel={ariaLabel ?? `Model input views: global view (${global.length} bins) and local view (${local.length} bins)`}
      />
    </div>
  );
}
