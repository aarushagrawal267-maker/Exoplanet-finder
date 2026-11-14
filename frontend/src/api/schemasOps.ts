/**
 * Named aliases for the generated OpenAPI types used by the machine-learning operations pages
 * (Dataset Explorer, Model Training, Model Evaluation, Experiments) and the job tray.
 * Generated from src/api/schema.d.ts (`npm run gen:api`); never re-declare these shapes by hand.
 */
import type { components, paths } from "./schema";

type S = components["schemas"];

// ---- datasets ----
export type TierOut = S["TierOut"];
export type DatasetCreate = S["DatasetCreate"];
export type DatasetTier = DatasetCreate["tier"];
export type LabelMode = DatasetCreate["label_mode"];
export type DetrendMethod = S["PipelineOptions"]["detrend_method"];
export type DatasetOut = S["DatasetOut"];
export type DatasetStatus = DatasetOut["status"];
export type DatasetDetailOut = S["DatasetDetailOut"];
export type DatasetStats = S["DatasetStats"];
export type SplitCounts = S["SplitCounts"];
export type DatasetHistogram = S["Histogram"];
export type ProcessingStats = S["ProcessingStats"];
export type ReservedStar = S["ReservedStar"];
export type DatasetExampleOut = S["DatasetExampleOut"];
export type DatasetExamplePage = S["DatasetExamplePage"];
export type DatasetExampleQuery = NonNullable<paths["/api/datasets/{dataset_id}/examples"]["get"]["parameters"]["query"]>;
export type ExampleViewsOut = S["ExampleViewsOut"];
export type GalleryOut = S["GalleryOut"];
export type GalleryItem = S["GalleryItem"];
export type DatasetDeleteOut = S["DatasetDeleteOut"];

// ---- training ----
export type ModelCardOut = S["ModelCardOut"];
export type ModelTypeId = ModelCardOut["type"];
export type EstimateOut = S["EstimateOut"];
export type TrainingConfigIn = S["TrainingConfigIn"];
export type TrainingRunCreate = S["TrainingRunCreate"];
export type TrainingRunOut = S["TrainingRunOut"];
export type TrainingSuiteCreate = S["TrainingSuiteCreate"];
export type TrainingSuiteOut = S["TrainingSuiteOut"];
export type EpochOut = S["EpochOut"];

// ---- model administration ----
export type ModelDetailOut = S["ModelDetailOut"];
export type ModelDeleteOut = S["ModelDeleteOut"];
export type ModelEvaluationRef = S["ModelEvaluationRef"];
export type TrainingSummary = S["TrainingSummary"];

// ---- evaluation ----
export type EvaluationCreate = S["EvaluationCreate"];
export type EvaluationSplit = EvaluationCreate["split"];
export type EvaluationOut = S["EvaluationOut"];
export type EvaluationDetailOut = S["EvaluationDetailOut"];
export type EvaluationExampleOut = S["EvaluationExampleOut"];
export type EvaluationOutcome = EvaluationExampleOut["outcome"];
export type EvaluationExamplePage = S["EvaluationExamplePage"];
export type EvaluationCompareOut = S["EvaluationCompareOut"];
export type CompareRow = S["CompareRow"];
export type FeatureImportanceOut = S["FeatureImportanceOut"];
export type FeatureImportanceRow = S["FeatureImportanceRow"];
export type EvaluationQuery = NonNullable<paths["/api/evaluation"]["get"]["parameters"]["query"]>;

// ---- experiments ----
export type ExperimentOut = S["ExperimentOut"];
export type ExperimentDetailOut = S["ExperimentDetailOut"];
export type ExperimentPatch = S["ExperimentPatch"];
export type ExperimentDeleteOut = S["ExperimentDeleteOut"];
export type ExperimentCompareOut = S["ExperimentCompareOut"];
export type ConfigDiffRow = S["ConfigDiffRow"];
export type ExperimentQuery = NonNullable<paths["/api/experiments"]["get"]["parameters"]["query"]>;

// ---- jobs ----
export type JobListQuery = NonNullable<paths["/api/jobs"]["get"]["parameters"]["query"]>;

// ---- reports ----
export type ReportFormat = "md" | "html" | "json";
