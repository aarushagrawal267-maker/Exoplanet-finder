/**
 * Adapters from API payloads to the science components' props, so every page maps catalogue
 * labels, quality reports and predictions the same way.
 */
import type { QualityGrade, QualityReportData, SignalClass } from "@/api/types";
import type { CatalogLabels, PredictionOut, QualityOut } from "@/api/schemas";
import type { CatalogueClassification } from "./VerdictPanel";

const GRADES = new Set(["A", "B", "C", "D"]);

export function asGrade(g: string | null | undefined): QualityGrade | null {
  return g && GRADES.has(g) ? (g as QualityGrade) : null;
}

/**
 * `QualityOut` (parallel `issues[]` codes and `messages[]`) → the QualityReport component's shape.
 * Also accepts the loosely-typed `quality` dict stored with a prediction.
 */
export function toQualityReport(q: QualityOut | Record<string, unknown> | null | undefined): QualityReportData | null {
  if (!q || typeof q !== "object") return null;
  const grade = asGrade((q as { grade?: string }).grade);
  if (!grade) return null;
  const qq = q as Partial<QualityOut>;
  const issues = Array.isArray(qq.issues) ? qq.issues : [];
  const messages = Array.isArray(qq.messages) ? qq.messages : [];
  return {
    grade,
    ok: qq.ok ?? grade !== "D",
    issues: issues.map((code, i) => ({ code: String(code), message: messages[i] ? String(messages[i]) : undefined })),
    n_transits_expected: qq.n_transits_expected ?? null,
    n_transits_observed: qq.n_transits_observed ?? undefined,
    local_empty_frac: qq.local_empty_frac ?? undefined,
    global_empty_frac: qq.global_empty_frac ?? undefined,
  };
}

/** DR24 Autovetter training labels: PC = planet candidate, AFP = astrophysical FP, NTP = non-transiting phenomenon. */
export const AV_LABELS: Record<string, { label: string; cls: SignalClass | null; help: string }> = {
  PC: { label: "PC", cls: "planet", help: "Planet candidate (DR24 Autovetter training label)" },
  AFP: { label: "AFP", cls: "false_positive", help: "Astrophysical false positive (DR24 Autovetter training label)" },
  NTP: { label: "NTP", cls: "false_positive", help: "Non-transiting phenomenon (DR24 Autovetter training label)" },
  UNK: { label: "UNK", cls: null, help: "Unknown — not used for training (DR24 Autovetter)" },
};

export function koiClass(disposition: string | null | undefined): SignalClass | null {
  if (!disposition) return null;
  const d = disposition.toUpperCase();
  if (d === "CONFIRMED") return "planet";
  if (d === "FALSE POSITIVE") return "false_positive";
  return null;
}

/** Catalogue classification shown beside a model verdict: KOI disposition first, else the DR24 label. */
export function catalogueClassification(labels: CatalogLabels | null | undefined): CatalogueClassification | null {
  if (!labels) return null;
  if (labels.koi_disposition) {
    return { disposition: labels.koi_disposition, cls: koiClass(labels.koi_disposition), source: "KOI cumulative table (NASA Exoplanet Archive)" };
  }
  if (labels.av_training_set) {
    const av = AV_LABELS[labels.av_training_set];
    return { disposition: `DR24 ${labels.av_training_set}`, cls: av?.cls ?? null, source: av?.help ?? "DR24 Autovetter" };
  }
  return null;
}

/** A prediction's split flag in the form the VerdictPanel expects. */
export function seenSplit(p: Pick<PredictionOut, "seen_in_split">): "train" | "val" | "test" | null {
  return p.seen_in_split ?? null;
}

/** Turn a nullable numeric series into numbers with NaN gaps (Plotly and the binning helpers skip NaN). */
export function nums(values: ReadonlyArray<number | null> | null | undefined): number[] {
  if (!values) return [];
  return values.map((v) => (v === null || v === undefined ? Number.NaN : v));
}

/** Drop pairs where either coordinate is missing (for line traces that must not bridge gaps with 0). */
export function pairs(x: ReadonlyArray<number | null>, y: ReadonlyArray<number | null>): { x: number[]; y: number[] } {
  const ox: number[] = [];
  const oy: number[] = [];
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i += 1) {
    const a = x[i];
    const b = y[i];
    if (a !== null && a !== undefined && b !== null && b !== undefined && Number.isFinite(a) && Number.isFinite(b)) {
      ox.push(a);
      oy.push(b);
    }
  }
  return { x: ox, y: oy };
}

/** API unit strings → typographic units for display. */
const UNIT_TEXT: Record<string, string> = {
  R_earth: "R⊕",
  R_sun: "R☉",
  M_sun: "M☉",
  sigma: "σ",
  "log10(cm s^-2)": "log₁₀(cm s⁻²)",
  "Rp/R*": "Rₚ/R★",
};

export function displayUnit(unit: string | null | undefined): string {
  if (!unit) return "";
  return UNIT_TEXT[unit] ?? unit;
}

/** Labels for the derived (estimated) quantities of a transit analysis. */
export const DERIVED_LABELS: Record<string, string> = {
  planet_radius_re: "Planet radius",
  radius_ratio: "Radius ratio Rₚ/R★",
  a_over_rstar: "Scaled orbit a/R★",
  semi_major_axis_au: "Semi-major axis",
  equilibrium_temp_k: "Equilibrium temperature",
  a_over_rstar_from_duration: "a/R★ from the transit duration",
};

export function derivedLabel(key: string): string {
  return DERIVED_LABELS[key] ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
