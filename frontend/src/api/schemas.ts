/**
 * Named aliases for the generated OpenAPI types (src/api/schema.d.ts, produced by
 * `npm run gen:api` from the FastAPI app). Import API payload types from here, never re-declare
 * them by hand: when the backend changes, regenerating the schema makes the compiler point at
 * every page that needs updating.
 */
import type { components, operations, paths } from "./schema";

export type { components, operations, paths };

type S = components["schemas"];

// ---- common ----
export type ErrorOut = S["ErrorOut"];
export type JobOut = S["JobOut"];
export type JobStatus = JobOut["status"];
export type PValue = S["PValue"];
export type QualityOut = S["QualityOut"];
export type SourceOut = S["SourceOut"];
export type EphemerisOut = S["EphemerisOut"];
export type ViewsOut = S["ViewsOut"];
export type DeviceInfo = S["DeviceInfo"];

// ---- system ----
export type SystemSummaryOut = S["SystemSummaryOut"];
export type CatalogSummary = S["CatalogSummary"];
export type LightCurveSummary = S["LightCurveSummary"];
export type DatasetSummary = S["DatasetSummary"];
export type DatasetBrief = S["DatasetBrief"];
export type ModelSummary = S["ModelSummary"];
export type ModelBrief = S["ModelBrief"];
export type NextStep = S["NextStep"];
export type DiagnosticsOut = S["DiagnosticsOut"];
export type NetworkCheck = S["NetworkCheck"];
export type PathInfo = S["PathInfo"];
export interface HealthOut {
  status: string;
  version: string;
  pipeline_version: string;
}

// ---- catalogue ----
export type SignalOut = S["SignalOut"];
export type SignalPage = S["SignalPage"];
export type CatalogStatsOut = S["CatalogStatsOut"];
export type HistogramOut = S["HistogramOut"];
export type SnapshotOut = S["SnapshotOut"];
export type CatalogLabels = S["CatalogLabels"];
export type FpFlags = S["FpFlags"];
export type SignalQuery = NonNullable<paths["/api/catalog/signals"]["get"]["parameters"]["query"]>;

// ---- targets ----
export type TargetSearchResult = S["TargetSearchResult"];
export type TargetOut = S["TargetOut"];
export type TargetDetailOut = S["TargetDetailOut"];
export type StellarOut = S["StellarOut"];
export type DatasetMembership = S["DatasetMembership"];

// ---- light curves ----
export type LightCurveOut = S["LightCurveOut"];
export type StagesOut = S["StagesOut"];
export type Series = S["Series"];
export type SegmentOut = S["SegmentOut"];
export type FoldedOut = S["FoldedOut"];
export type BinnedSeries = S["BinnedSeries"];

// ---- uploads ----
export type UploadOut = S["UploadOut"];
export type ParseIn = S["ParseIn"];
export type ParseOut = S["ParseOut"];
export type ColumnMapping = S["ColumnMapping"];
export type TimeSystemIn = NonNullable<ParseIn["time_system"]>;

// ---- analysis ----
export type CatalogSource = S["CatalogSource"];
export type UploadSource = S["UploadSource"];
export type AnalysisSource = CatalogSource | UploadSource;
export type BlsIn = S["BlsIn"];
export type BlsOut = S["BlsOut"];
export type BlsPeak = S["BlsPeak"];
export type TransitIn = S["TransitIn"];
export type TransitEphemerisIn = S["TransitEphemerisIn"];
export type TransitOut = S["TransitOut"];
export type ComparisonRow = S["ComparisonRow"];
export type InjectionIn = S["InjectionIn"];
export type InjectionOut = S["InjectionOut"];

// ---- predictions ----
export type PredictIn = S["PredictIn"];
export type PredictResponse = S["PredictResponse"];
export type PredictionOut = S["PredictionOut"];
export type PredictionPage = S["PredictionPage"];
export type PredictionDetailOut = S["PredictionDetailOut"];
export type EphemerisIn = S["EphemerisIn"];
export type BatchIn = S["BatchIn"];
export type CandidatePage = S["CandidatePage"];
export type CandidateOut = S["CandidateOut"];
export type CandidateScore = S["CandidateScore"];
export type CandidateModel = S["CandidateModel"];
export type CandidateQuery = NonNullable<paths["/api/predictions/candidates"]["get"]["parameters"]["query"]>;
export type CandidateSort = NonNullable<CandidateQuery["sort"]>;
export type PredictionQuery = NonNullable<paths["/api/predictions"]["get"]["parameters"]["query"]>;

// ---- models (read-only use on science pages) ----
export type ModelVersionOut = S["ModelVersionOut"];

// ---- settings ----
export type SettingsOut = S["SettingsOut"];
export type SettingDescription = S["SettingDescription"];
export type StorageOut = S["StorageOut"];
export type StorageCategory = S["StorageCategory"];
export type ClearIn = S["ClearIn"];
export type ClearOut = S["ClearOut"];

// ---- docs ----
export type DocPage = S["DocPage"];
export type DocPageSummary = S["DocPageSummary"];
