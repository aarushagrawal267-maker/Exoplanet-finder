/**
 * Chart helpers and the DOM-rendered (non-Plotly) charts. Plotly charts are exercised in the
 * browser by the Playwright smoke test; here we test the pure geometry they are built on.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChartLegend } from "./ChartParts";
import { ConfusionMatrix } from "./ConfusionMatrix";
import { breakAtGaps, transitWindowsFromEphemeris } from "./LightCurvePlot";
import { MetricBars } from "./MetricBars";
import { logTicks } from "./PeriodogramPlot";
import { MODEL_PALETTE, patternFill, seriesStyle, SERIES_PALETTE, withAlpha } from "./theme";
import { epochTicks } from "./TrainingCurves";

describe("theme helpers", () => {
  it("keeps a fixed colour and dash per model type, independent of rank", () => {
    expect(seriesStyle("random_forest", 0)).toBe(MODEL_PALETTE.random_forest);
    expect(seriesStyle(undefined, 5)).toMatchObject({ color: SERIES_PALETTE[1], dash: "dash" });
  });
  it("converts hex to rgba", () => {
    expect(withAlpha("#6E9BFF", 0.5)).toBe("rgba(110, 155, 255, 0.5)");
    expect(withAlpha("#fff", 1)).toBe("rgba(255, 255, 255, 1)");
  });
  it("gives every dash slot a distinct bar texture (identity never by colour alone)", () => {
    const fills = (["solid", "dash", "dot", "dashdot"] as const).map((d) => patternFill("#6E9BFF", d));
    expect(fills[0]).toEqual({ backgroundColor: "#6E9BFF" });
    const images = fills.slice(1).map((f) => f.backgroundImage);
    expect(images.every(Boolean)).toBe(true);
    expect(new Set(images).size).toBe(3);
  });
});

describe("light-curve geometry", () => {
  it("breaks line traces at data gaps instead of bridging them", () => {
    const out = breakAtGaps([0, 1, 2, 10, 11], [1, 1, 1, 1, 1], 3);
    expect(out.x).toEqual([0, 1, 2, null, 10, 11]);
    expect(out.y).toEqual([1, 1, 1, null, 1, 1]);
  });
  it("derives T14 windows around each predicted mid-transit inside the data span", () => {
    // P = 2 d, T0 = 1, T14 = 4.8 h (0.2 d): centres at 1, 3, 5 within [0, 6].
    const w = transitWindowsFromEphemeris({ period: 2, epoch: 1, durationHours: 4.8 }, 0, 6);
    expect(w.map((x) => [Number(x.start.toFixed(3)), Number(x.end.toFixed(3))])).toEqual([
      [0.9, 1.1],
      [2.9, 3.1],
      [4.9, 5.1],
    ]);
  });
  it("returns no windows for a degenerate ephemeris", () => {
    expect(transitWindowsFromEphemeris({ period: 0, epoch: 1, durationHours: 3 }, 0, 10)).toEqual([]);
  });
});

describe("axis ticks", () => {
  it("places 1–2–5 ticks on the log period axis", () => {
    expect(logTicks(0.5, 30)).toEqual([0.5, 1, 2, 5, 10, 20]);
    expect(logTicks(0, 10)).toEqual([]);
  });
  it("uses round epoch steps", () => {
    expect(epochTicks(50)).toEqual([1, 10, 20, 30, 40, 50]);
    expect(epochTicks(8)).toEqual([1, 2, 4, 6, 8]);
  });
});

describe("MetricBars", () => {
  const models = [
    { id: "a", label: "Two-view CNN", modelType: "cnn_two_view" },
    { id: "b", label: "Random forest", modelType: "random_forest" },
  ];
  it("prints every value, names each bar for screen readers and textures bars per model", () => {
    render(
      <MetricBars
        models={models}
        groups={[{ metric: "PR-AUC", values: [{ modelId: "a", value: 0.91, ci: [0.88, 0.94] }, { modelId: "b", value: null }] }]}
      />,
    );
    expect(screen.getByRole("figure", { name: "Metric comparison across 2 models" })).toBeInTheDocument();
    expect(screen.getByText("0.910")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument(); // missing value, never "0"
    expect(screen.getByText("Two-view CNN:", { exact: false })).toHaveClass("sr-only");
    const bars = screen.getAllByTestId("metric-bar");
    expect(bars[0]).toHaveStyle({ width: "91%" });
    // Random forest (dash slot) is hatched, not just a different colour.
    expect((bars[1] as HTMLElement).style.backgroundImage).toContain("repeating-linear-gradient");
  });
});

describe("ChartLegend", () => {
  it("renders a textured swatch marker when a fill is given", () => {
    const { container } = render(
      <ChartLegend items={[{ key: "x", label: "Model X", color: "#fff", marker: "swatch", fill: patternFill("#ffffff", "dot") }]} />,
    );
    expect(screen.getByText("Model X")).toBeInTheDocument();
    const swatch = container.querySelector("li > span[aria-hidden='true']") as HTMLElement;
    expect(swatch.style.backgroundImage).toContain("radial-gradient");
  });
});

describe("ConfusionMatrix", () => {
  it("summarises the counts for assistive tech and labels correctness in text", () => {
    render(<ConfusionMatrix tp={225} fn={48} fp={2} tn={625} threshold={0.5} />);
    expect(
      screen.getByRole("figure", {
        name: "Confusion matrix at threshold 0.500: 225 true positives, 48 false negatives, 2 false positives, 625 true negatives",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("correct")).toHaveLength(2);
    expect(screen.getAllByText("error")).toHaveLength(2);
    expect(screen.getByText("82.4%")).toBeInTheDocument(); // 225 / 273 of actual planet-like
  });
});
