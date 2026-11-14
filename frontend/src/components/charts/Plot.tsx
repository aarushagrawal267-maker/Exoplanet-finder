/**
 * Lazily-loaded Plotly component (react-plotly.js factory pattern + plotly.js-dist-min).
 *
 * Plotly is ~4.6 MB minified, so it is fetched only when the first chart mounts, in its own
 * chunk; a chart-shaped skeleton shows meanwhile. Load failures render an ErrorState instead of
 * crashing the page.
 */
import { Component, lazy, Suspense, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import type { PlotParams } from "react-plotly.js";
import { ChartSkeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { useMediaQuery } from "@/lib/hooks";
import { plotlyConfig } from "./theme";

type Factory = (plotly: object) => ComponentType<PlotParams>;

/** CJS/ESM interop: the default export may be nested one level deep after pre-bundling. */
function unwrapDefault<T>(mod: unknown): T {
  let m = mod as { default?: unknown };
  for (let i = 0; i < 2 && m && typeof m === "object" && "default" in m && m.default; i += 1) {
    m = m.default as { default?: unknown };
  }
  return m as T;
}

const LazyPlotly = lazy(async () => {
  const [factoryModule, plotlyModule] = await Promise.all([import("react-plotly.js/factory"), import("plotly.js-dist-min")]);
  const createPlotlyComponent = unwrapDefault<Factory>(factoryModule);
  const Plotly = unwrapDefault<object>(plotlyModule);
  return { default: createPlotlyComponent(Plotly) };
});

class ChartErrorBoundary extends Component<{ children: ReactNode; height: number }, { error: unknown }> {
  override state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Chart failed to render", error, info.componentStack);
  }
  override render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: this.props.height }} className="flex items-center">
          <ErrorState
            compact
            className="w-full"
            title="This chart could not be drawn"
            cause="The plotting library failed to load or rejected the data."
            fix="Reload the page. If it persists, check the browser console for details."
            error={this.state.error}
            onRetry={() => this.setState({ error: null })}
          />
        </div>
      );
    }
    return this.props.children;
  }
}

export interface PlotProps extends Omit<PlotParams, "style" | "useResizeHandler"> {
  height: number;
  /** Accessible description of what the chart shows. */
  ariaLabel: string;
  className?: string;
}

export function Plot({ height, ariaLabel, className, config, ...rest }: PlotProps) {
  // On touch screens Plotly's "hover" mode bar has no hover to hide behind: it stays pinned over
  // the right edge of the data. Drop it there (pinch / drag zoom and double-tap reset still work).
  const touch = useMediaQuery("(hover: none)");
  return (
    <ChartErrorBoundary height={height}>
      <Suspense fallback={<ChartSkeleton height={height} label={`Loading: ${ariaLabel}`} />}>
        <figure role="figure" aria-label={ariaLabel} className={className} style={{ margin: 0 }}>
          <LazyPlotly
            {...rest}
            config={{ ...plotlyConfig, ...(touch ? { displayModeBar: false } : null), ...config }}
            useResizeHandler
            style={{ width: "100%", height }}
          />
        </figure>
      </Suspense>
    </ChartErrorBoundary>
  );
}
