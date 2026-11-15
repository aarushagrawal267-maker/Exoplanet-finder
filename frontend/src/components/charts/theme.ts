/**
 * Shared chart theme for Plotly and Recharts — "Observatory Night" dark template.
 *
 * Colour roles:
 *  - Data points: low-opacity secondary ink, so tens of thousands of cadences read as a cloud.
 *  - Binned / summary lines: cosmic blue.
 *  - Model inputs and outputs: nebula violet.
 *  - Class colours (teal planet-like / amber false-positive-like) are reserved for class meaning.
 *  - Model comparison series use MODEL_PALETTE, validated for colour-vision deficiency on the
 *    #0F1629 surface (worst adjacent CVD ΔE 10.1, all pairs ≥ 8.9; see below) and always paired
 *    with a distinct dash pattern + legend label, so identity is never colour alone.
 */
import type { Config, Layout } from "plotly.js";
import type { ModelType } from "@/api/types";
import { colors, fonts } from "@/styles/tokens";

export const chartColors = {
  background: "rgba(0,0,0,0)",
  surface: colors.surface,
  grid: "rgba(31, 42, 71, 0.75)", // hairline
  axis: colors["hairline-strong"],
  tick: colors["text-secondary"],
  title: colors["text-secondary"],
  text: colors["text-primary"],
  points: colors["text-secondary"],
  binned: colors.cosmic,
  model: colors.nebula,
  planet: colors["signal-planet"],
  fp: colors["signal-fp"],
  uncertain: colors["signal-uncertain"],
  transitBand: "rgba(110, 155, 255, 0.09)",
  transitBandEdge: "rgba(110, 155, 255, 0.28)",
  reference: colors["text-muted"],
} as const;

export const MONO = fonts.mono.join(", ");
export const SANS = fonts.sans.join(", ");

/**
 * Categorical palette for comparing models. Order validated with the dataviz palette checker
 * (dark mode, surface #0F1629, --pairs all): CVD worst ΔE 10.1 (protan), all four ≥ 3:1 contrast.
 * Blue and violet were deliberately NOT both used: they collapse under deuteranopia (ΔE 0.7).
 */
export const SERIES_PALETTE = ["#6E9BFF", "#E07FB8", "#B5D36B", "#C7B8FF"] as const;
export const SERIES_DASH = ["solid", "dash", "dot", "dashdot"] as const;
export type Dash = (typeof SERIES_DASH)[number];

/** SVG stroke-dasharray for each dash name (Recharts / custom SVG). */
export const DASHARRAY: Record<Dash, string | undefined> = {
  solid: undefined,
  dash: "7 4",
  dot: "2 3",
  dashdot: "8 3 2 3",
};

export interface SeriesStyle {
  color: string;
  dash: Dash;
  label: string;
}

/** Fixed colour + dash per model type: colour follows the entity, never its rank. */
export const MODEL_PALETTE: Record<ModelType, SeriesStyle> = {
  cnn_two_view: { color: SERIES_PALETTE[0], dash: SERIES_DASH[0], label: "Two-view CNN" },
  random_forest: { color: SERIES_PALETTE[1], dash: SERIES_DASH[1], label: "Random forest" },
  logreg: { color: SERIES_PALETTE[2], dash: SERIES_DASH[2], label: "Logistic regression" },
  cnn_single: { color: SERIES_PALETTE[3], dash: SERIES_DASH[3], label: "Global-view CNN" },
};

/** Style for a series: by model type when known, otherwise by stable slot index. */
export function seriesStyle(modelType: string | undefined, index: number): SeriesStyle {
  if (modelType && modelType in MODEL_PALETTE) return MODEL_PALETTE[modelType as ModelType];
  const i = ((index % SERIES_PALETTE.length) + SERIES_PALETTE.length) % SERIES_PALETTE.length;
  return { color: SERIES_PALETTE[i] as string, dash: SERIES_DASH[i] as Dash, label: `Series ${index + 1}` };
}

/**
 * Area fill for bars / swatches that mirrors a series' dash slot, so bar charts carry model
 * identity by texture as well as colour (lines use the dash pattern itself):
 * solid → flat fill, dash → diagonal hatching, dot → dot screen, dashdot → vertical ticks.
 */
export function patternFill(color: string, dash: Dash): { backgroundColor: string; backgroundImage?: string; backgroundSize?: string } {
  const faint = withAlpha(color, 0.38);
  switch (dash) {
    case "dash":
      return { backgroundColor: faint, backgroundImage: `repeating-linear-gradient(135deg, ${color} 0 4px, transparent 4px 7px)` };
    case "dot":
      return { backgroundColor: faint, backgroundImage: `radial-gradient(circle, ${color} 1.3px, transparent 1.7px)`, backgroundSize: "4px 4px" };
    case "dashdot":
      return { backgroundColor: faint, backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 5px, transparent 5px 7px)` };
    default:
      return { backgroundColor: color };
  }
}

/** Hex → rgba() with alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const n = Number.parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const axisBase = {
  showgrid: true,
  gridcolor: chartColors.grid,
  gridwidth: 1,
  zeroline: false,
  showline: true,
  linecolor: chartColors.axis,
  linewidth: 1,
  ticks: "outside" as const,
  ticklen: 4,
  tickcolor: chartColors.axis,
  tickfont: { family: MONO, size: 11, color: chartColors.tick },
  title: { font: { family: SANS, size: 12, color: chartColors.title }, standoff: 8 },
  automargin: true,
  hoverformat: ".5~f",
};

/** Plotly axis defaults (merge per axis). */
export function plotlyAxis(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...axisBase, ...overrides, title: { ...axisBase.title, ...((overrides.title as object) ?? {}) } };
}

/** Plotly layout defaults: transparent background, mono ticks, recessive grid. */
export function plotlyLayout(overrides: Partial<Layout> = {}): Partial<Layout> {
  return {
    autosize: true,
    paper_bgcolor: chartColors.background,
    plot_bgcolor: chartColors.background,
    font: { family: SANS, size: 12, color: chartColors.text },
    margin: { l: 56, r: 16, t: 24, b: 40 },
    showlegend: false,
    hovermode: "closest",
    hoverlabel: {
      bgcolor: colors["surface-raised"],
      bordercolor: colors["hairline-strong"],
      font: { family: MONO, size: 11, color: colors["text-primary"] },
      align: "left",
    },
    dragmode: "zoom",
    modebar: { bgcolor: "rgba(0,0,0,0)", color: colors["text-muted"], activecolor: colors.cosmic, orientation: "v" },
    ...overrides,
  };
}

/** Plotly config: lean mode bar, no logo, responsive, PNG export at 2×. */
export const plotlyConfig: Partial<Config> = {
  displaylogo: false,
  responsive: true,
  displayModeBar: "hover",
  scrollZoom: false,
  modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toggleSpikelines", "hoverClosestCartesian", "hoverCompareCartesian"],
  toImageButtonOptions: { format: "png", scale: 2 },
};

/** Recharts shared props. */
export const rcAxis = {
  stroke: chartColors.axis,
  tick: { fill: chartColors.tick, fontFamily: MONO, fontSize: 11 },
  tickLine: { stroke: chartColors.axis },
  axisLine: { stroke: chartColors.axis },
} as const;

export const rcGrid = {
  stroke: chartColors.grid,
  strokeDasharray: "0",
  vertical: false,
} as const;
