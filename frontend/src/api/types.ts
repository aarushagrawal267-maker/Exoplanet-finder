/**
 * Front-end types mirroring the REST API (docs/dev/API.md). Only the shapes the shared
 * components need live here; page-specific payloads are added alongside their pages.
 */

/** Where a scientific value came from. "model" marks AI-generated outputs. */
export type Provenance = "catalogue" | "measured" | "estimate" | "model" | "manual";

/** A scientific value with its provenance, as returned by the API. */
export interface ProvenancedValue {
  value: number | null;
  err?: number | null;
  unit: string;
  provenance: Exclude<Provenance, "model">;
  source?: string;
}

/** Binary signal classes. 1 = planet-like (transit consistent with a planet), 0 = false-positive-like. */
export type SignalClass = "planet" | "false_positive" | "uncertain";

/** Data-quality grade from the preprocessing pipeline (astro/quality.py). */
export type QualityGrade = "A" | "B" | "C" | "D";

/** Quality issue codes emitted by `assess_quality` (CONTRACTS.md §1). */
export type QualityIssueCode =
  | "too_few_transits"
  | "low_transit_coverage"
  | "local_view_sparse"
  | "global_view_sparse"
  | "misaligned"
  | "depth_mismatch"
  | "nan_in_views"
  | "period_too_long"
  | "no_transit_signal";

export interface QualityIssue {
  code: QualityIssueCode | string;
  message?: string;
  blocking?: boolean;
  /** Optional measured value that triggered the issue (e.g. empty fraction). */
  value?: number | null;
}

export interface QualityReportData {
  grade: QualityGrade;
  ok: boolean;
  issues: QualityIssue[];
  n_transits_expected?: number | null;
  n_transits_observed?: number | null;
  local_empty_frac?: number | null;
  global_empty_frac?: number | null;
}

export type ModelType = "logreg" | "random_forest" | "cnn_single" | "cnn_two_view";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface JobOut {
  id: string;
  kind: string;
  title: string;
  status: JobStatus;
  /** 0..1 */
  progress: number;
  message?: string | null;
  params?: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  eta_s?: number | null;
}

export interface HealthOut {
  status: string;
  version: string;
  pipeline_version: string;
}

/** Uniform error body produced by the FastAPI error handlers. */
export interface ApiErrorBody {
  detail?: unknown;
  code?: string | null;
  hint?: string | null;
}
