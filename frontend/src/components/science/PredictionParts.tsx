/**
 * Building blocks for showing a model prediction, shared by Planet Detection (fresh results) and
 * Prediction History (stored results): the verdict with its context, the model input views, the
 * measured features and the warnings.
 */
import { ExternalLink, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import type { CatalogLabels, PredictionOut, ViewsOut } from "@/api/schemas";
import { ViewPairPlot } from "@/components/charts/ViewPairPlot";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { formatDays, formatHours, formatNumber, formatPpm } from "@/lib/format";
import { asGrade, catalogueClassification, nums } from "./adapters";
import { VerdictPanel } from "./VerdictPanel";

const SPLIT_NOTE: Record<"train" | "val" | "test", string> = {
  train: "star in the model's training split",
  val: "star in the model's validation split",
  test: "star in the model's held-out test split",
};

export function PredictionVerdict({ p, catalogLabels, showLink = true }: { p: PredictionOut; catalogLabels?: CatalogLabels | null; showLink?: boolean }) {
  const threshold = p.threshold ?? 0.5;
  const labels = catalogLabels ?? p.catalog_labels;
  return (
    <div className="flex flex-col gap-2" data-testid="prediction-verdict">
      <VerdictPanel
        probability={p.probability}
        threshold={threshold}
        uncertainty={p.uncertainty}
        memberProbabilities={p.member_probabilities}
        qualityGrade={asGrade(p.quality_grade)}
        catalogue={catalogueClassification(labels)}
        modelName={p.model_name}
        isFixtureModel={p.is_fixture_model}
        seenInSplit={p.seen_in_split ?? null}
      />
      <p className="num flex flex-wrap gap-x-3 gap-y-1 px-1 text-xs text-fg-secondary">
        <span>
          threshold {formatNumber(threshold, { digits: 3 })} ({p.threshold_mode === "fixed_0.5" ? "fixed 0.5" : p.threshold_mode === "validation_f1" ? "F1-optimal on validation" : (p.threshold_mode ?? (p.threshold === null ? "default 0.5" : "model"))})
        </span>
        <span>raw {formatNumber(p.raw_probability, { digits: 3 })} → calibrated {formatNumber(p.probability, { digits: 3 })}</span>
        <span>{p.uncertainty_method ? `uncertainty: ${p.uncertainty_method.replace(/_/g, " ")}` : "no uncertainty estimate for this model type"}</span>
        <span>{p.seen_in_split ? SPLIT_NOTE[p.seen_in_split] : "star not in the model's dataset"}</span>
        {p.inference_ms !== null && p.inference_ms !== undefined ? <span>{formatNumber(p.inference_ms, { digits: 0 })} ms</span> : null}
        {showLink ? (
          <Link to={`/predictions?id=${p.id}`} className="inline-flex items-center gap-1 font-sans text-cosmic hover:underline">
            Stored as prediction #{p.id} <ExternalLink className="size-3" aria-hidden="true" />
          </Link>
        ) : null}
      </p>
    </div>
  );
}

/** Model input views with physical x axes (orbital phase; transit durations) when the ephemeris is known. */
export function ModelInputViews({ views, period, durationHours }: { views: ViewsOut; period?: number | null; durationHours?: number | null }) {
  const gx = period ? nums(views.global_phase).map((x) => x / period) : undefined;
  const lx = durationHours ? nums(views.local_phase).map((x) => (x * 24) / durationHours) : undefined;
  return (
    <div>
      <ViewPairPlot
        global={nums(views.global)}
        local={nums(views.local)}
        globalX={gx && gx.length === views.global.length ? gx : undefined}
        localX={lx && lx.length === views.local.length ? lx : undefined}
        height={260}
      />
      <p className="mt-2 text-xs text-fg-secondary">
        What the models see: the folded light curve binned into a global view (whole orbit) and a local view (±2 transit durations), normalised so the
        baseline is 0 and the transit floor −1.
      </p>
    </div>
  );
}

const FEATURES: Record<string, { label: string; fmt: (v: number) => string }> = {
  depth_ppm: { label: "Depth", fmt: (v) => formatPpm(v) },
  log_depth: { label: "log₁₀ depth", fmt: (v) => formatNumber(v, { digits: 3 }) },
  duration_hours: { label: "Duration T₁₄", fmt: (v) => formatHours(v) },
  duration_over_period: { label: "Duration / period", fmt: (v) => formatNumber(v, { digits: 4 }) },
  log_period: { label: "log₁₀ period", fmt: (v) => `${formatNumber(v, { digits: 3 })} (${formatDays(10 ** v)})` },
  snr: { label: "Transit SNR", fmt: (v) => formatNumber(v, { digits: 1 }) },
  n_transits_observed: { label: "Transits observed", fmt: (v) => formatNumber(v, { digits: 0 }) },
  odd_even_sigma: { label: "Odd/even difference", fmt: (v) => `${formatNumber(v, { digits: 2 })}σ` },
  secondary_sigma: { label: "Secondary significance", fmt: (v) => `${formatNumber(v, { digits: 2 })}σ` },
  secondary_depth_ratio: { label: "Secondary / primary depth", fmt: (v) => formatNumber(v, { digits: 4 }) },
  shape_ratio: { label: "Ingress / T₁₄ (V-shape)", fmt: (v) => formatNumber(v, { digits: 3 }) },
  local_asymmetry: { label: "Local-view asymmetry", fmt: (v) => formatNumber(v, { digits: 3 }) },
  oot_scatter_ppm: { label: "Out-of-transit scatter", fmt: (v) => formatPpm(v) },
  local_view_min_width: { label: "Local-view dip width", fmt: (v) => `${formatNumber(v, { digits: 2 })} T₁₄` },
  global_secondary_min: { label: "Global-view minimum near phase 0.5", fmt: (v) => formatNumber(v, { digits: 3 }) },
};

export function FeatureList({ features }: { features: Record<string, number | null> | null | undefined }) {
  const entries = Object.entries(features ?? {});
  if (!entries.length) return <p className="text-sm text-fg-secondary">No physical features were stored with this prediction.</p>;
  return (
    <KeyValueList
      columns={2}
      dense
      items={entries.map(([k, v]) => ({
        key: k,
        label: FEATURES[k]?.label ?? k.replace(/_/g, " "),
        value: v === null || !Number.isFinite(v) ? "—" : (FEATURES[k]?.fmt(v) ?? formatNumber(v, { digits: 3 })),
        provenance: "measured" as const,
      }))}
    />
  );
}

export function WarningList({ warnings, label = "Warnings" }: { warnings: string[]; label?: string }) {
  if (!warnings.length) return null;
  return (
    <ul className="flex flex-col gap-2" aria-label={label}>
      {warnings.map((w) => (
        <li key={w} className="flex gap-2 text-sm text-fg-secondary">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
          <span>{w}</span>
        </li>
      ))}
    </ul>
  );
}
