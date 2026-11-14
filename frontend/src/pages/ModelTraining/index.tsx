/**
 * Model Training — choose a model (cards explain each one), configure it with validated
 * hyperparameters and a measured epoch-time estimate, start a run or the full four-model suite,
 * follow training live (progress, ETA, per-epoch curves, log, cancel), and manage the trained
 * model versions (active model, delete).
 *
 * URL state: `?job=<job id>` follows a training job; `?dataset=<id>` / `?type=<model type>`
 * preselect the form.
 */
import { Database } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useDatasets } from "@/api/endpoints/datasets";
import { useActiveJobs } from "@/api/endpoints/jobStream";
import { useModelTypes } from "@/api/endpoints/training";
import type { JobOut } from "@/api/schemas";
import type { ModelTypeId } from "@/api/schemasOps";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Skeleton } from "@/components/ui/Skeleton";
import { useParamState } from "../_ops/components";
import { MODEL_TYPES, parseId } from "../_ops/metrics";
import { LiveTraining } from "./LiveTraining";
import { TrainedModels } from "./TrainedModels";
import { TrainingSetup } from "./TrainingSetup";

const TRAIN_KINDS = ["train", "train_suite"] as const;

export default function ModelTrainingPage() {
  const [params, setParams] = useParamState();
  const datasets = useDatasets();
  const cards = useModelTypes();
  const running = useActiveJobs(TRAIN_KINDS);
  const [startedJob, setStartedJob] = useState<JobOut | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const jobParam = params.get("job");
  // Follow the job in the URL, else a training job that is already running (e.g. after a reload).
  const runningJob = running.jobs.find((j) => j.id !== dismissed);
  const followId = jobParam ?? runningJob?.id ?? null;
  const typeParam = params.get("type");
  const initialType = MODEL_TYPES.includes(typeParam as ModelTypeId) ? (typeParam as ModelTypeId) : null;
  const ready = (datasets.data ?? []).filter((d) => d.status === "ready");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Models · 01"
        title="Model Training"
        description="Train classifiers from scratch on your datasets: two classical baselines and two AstroNet-style CNNs. Everything runs locally on your CPU or GPU."
      />

      {followId ? (
        <Section id="live-training" title="Live training">
          <LiveTraining
            key={followId}
            jobId={followId}
            initial={startedJob?.id === followId ? startedJob : runningJob?.id === followId ? runningJob : null}
            onDismiss={() => {
              setDismissed(followId);
              setStartedJob(null);
              setParams({ job: null });
            }}
          />
        </Section>
      ) : null}

      <Section id="train" title="Train a model" description="Pick a model, a dataset and its settings.">
        {datasets.isError ? (
          <ApiErrorBanner error={datasets.error} onRetry={() => void datasets.refetch()} />
        ) : datasets.isLoading ? (
          <Skeleton height={220} rounded="md" />
        ) : ready.length === 0 ? (
          <EmptyState
            title="Build a dataset first"
            description={
              (datasets.data ?? []).some((d) => d.status === "building")
                ? "A dataset is being built right now. Models can be trained as soon as it is ready."
                : "Models learn from a labelled dataset with train / validation / test splits. Build one in the Dataset Explorer (the Pilot tier takes a few minutes)."
            }
            actions={
              <Link to="/datasets" className={buttonClasses({ variant: "primary" })}>
                <Database aria-hidden="true" /> Open Dataset Explorer
              </Link>
            }
          />
        ) : (
          <>
            {cards.isError ? <ApiErrorBanner error={cards.error} onRetry={() => void cards.refetch()} className="mb-4" /> : null}
            <TrainingSetup
              cards={cards.data ?? []}
              cardsLoading={cards.isLoading}
              datasets={datasets.data ?? []}
              initialDatasetId={parseId(params.get("dataset"))}
              initialType={initialType}
              busyJob={running.jobs.length > 0}
              onStarted={(job) => {
                setStartedJob(job);
                setParams({ job: job.id }, { push: true });
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          </>
        )}
      </Section>

      <Section id="models" title="Trained models" description="The active model scores signals on the Planet Detection page unless you pick others there.">
        <TrainedModels />
      </Section>
    </div>
  );
}
