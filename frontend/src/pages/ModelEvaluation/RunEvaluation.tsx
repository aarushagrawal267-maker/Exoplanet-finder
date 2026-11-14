/**
 * Start an evaluation: pick a model and the split. Test-split runs carry the methodology notice
 * (evaluate each final model once; every test evaluation is logged and counted) and need an
 * explicit confirmation; the number of earlier test evaluations of the model is shown.
 */
import { Gauge, Play } from "lucide-react";
import { useState } from "react";
import { evaluationIdOfJob, useStartEvaluation } from "@/api/endpoints/evaluation";
import type { JobOut, ModelVersionOut } from "@/api/schemas";
import type { EvaluationSplit } from "@/api/schemasOps";
import { JobProgress } from "@/components/jobs/JobProgress";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/Select";
import { formatInt } from "@/lib/format";
import { modelTypeLabel } from "../_ops/metrics";

export interface RunEvaluationProps {
  models: ModelVersionOut[];
  modelId: number | null;
  onModelChange: (id: number | null) => void;
  /** Evaluation id of the latest test evaluation of the selected model, if any (to link to it). */
  onOpenEvaluation: (id: number) => void;
  latestTestEvaluationId: number | null;
}

export function RunEvaluation({ models, modelId, onModelChange, onOpenEvaluation, latestTestEvaluationId }: RunEvaluationProps) {
  const [split, setSplit] = useState<EvaluationSplit>("val");
  const [ack, setAck] = useState(false);
  const [job, setJob] = useState<JobOut | null>(null);
  const start = useStartEvaluation();
  const model = models.find((m) => m.id === modelId) ?? null;
  const nTest = model?.n_test_evaluations ?? 0;
  const canRun = model !== null && (split === "val" || ack) && model.compatible && model.checkpoint_exists;

  const run = () => {
    if (!model || !canRun) return;
    start.mutate(
      { model_version_id: model.id, split, n_boot: 1000, seed: 0 },
      {
        onSuccess: (j) => {
          setJob(j);
          setAck(false);
        },
      },
    );
  };

  return (
    <Card className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
        <Field label="Model" help={model ? `${modelTypeLabel(model.model_type)} · trained on “${model.dataset_name ?? "deleted dataset"}” · ${formatInt(model.n_evaluations)} evaluation(s)` : undefined}>
          <Select
            value={modelId === null ? "" : String(modelId)}
            onChange={(v) => {
              onModelChange(v ? Number(v) : null);
              setAck(false);
            }}
            placeholder="Choose a model…"
            options={models.map((m) => ({
              value: String(m.id),
              label: `#${m.id} ${m.name}${m.is_active ? " (active)" : ""}${m.is_fixture ? " — test fixture" : ""}`,
            }))}
          />
        </Field>
        <Field label="Split">
          <SegmentedControl<EvaluationSplit>
            className="self-start"
            aria-label="Split to evaluate"
            value={split}
            onChange={(s) => {
              setSplit(s);
              setAck(false);
            }}
            options={[
              { value: "val", label: "Validation" },
              { value: "test", label: "Test" },
            ]}
          />
        </Field>
      </div>

      {split === "val" ? (
        <p className="text-sm text-fg-secondary">
          Validation metrics are <span className="text-fg">optimistic</span>: the threshold, calibration and early stopping were tuned on this split. Use them while iterating;
          they cost nothing methodologically.
        </p>
      ) : (
        <Banner tone="warn" title="The test split is evaluated once per final model">
          <p>
            Test metrics are the unbiased estimate only while the test split stays unseen. Every test evaluation is logged and counted. Evaluate a model on test when you
            have finished changing it, and do not tune anything on the result.
          </p>
          <p className="mt-1.5">
            {model ? (
              <>
                This model has <span className="num font-semibold text-fg">{formatInt(nTest)}</span> test evaluation{nTest === 1 ? "" : "s"} so far
                {nTest > 0 ? (
                  <>
                    {" "}
                    — re-running scores the same examples again and only increases the count.{" "}
                    {latestTestEvaluationId !== null ? (
                      <button type="button" className="text-cosmic underline" onClick={() => onOpenEvaluation(latestTestEvaluationId)}>
                        Open the existing test result
                      </button>
                    ) : null}
                  </>
                ) : (
                  "."
                )}
              </>
            ) : (
              "Choose a model to see how many times it was evaluated on test."
            )}
          </p>
          {model ? (
            <label className="mt-3 flex items-start gap-2 text-fg">
              <input type="checkbox" className="mt-1 accent-[var(--c-cosmic)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>
                I have finished changing this model: run test evaluation <span className="num">#{nTest + 1}</span>.
              </span>
            </label>
          ) : null}
        </Banner>
      )}

      {model && !model.compatible ? <Banner tone="warn" title="This model uses an older pipeline version and cannot be evaluated. Retrain it." /> : null}
      {model && !model.checkpoint_exists ? <Banner tone="danger" title="The model's checkpoint files are missing. Delete it and retrain." /> : null}
      {model?.is_fixture ? <Banner tone="fixture-model" title="Test-fixture model: its metrics are not scientific results." /> : null}
      {start.isError ? <ApiErrorBanner error={start.error} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="model" icon={split === "test" ? <Gauge /> : <Play />} onClick={run} disabled={!canRun} loading={start.isPending}>
          {split === "test" ? `Run test evaluation #${nTest + 1}` : "Evaluate on validation"}
        </Button>
        <span className="text-xs text-fg-secondary">95 % CIs from 1,000 bootstrap resamples of whole stars.</span>
      </div>

      {job ? (
        <JobProgress
          jobId={job.id}
          initial={job}
          onDismiss={() => setJob(null)}
          onDone={(j) => {
            const id = evaluationIdOfJob(j);
            if (j.status === "succeeded" && id !== null) onOpenEvaluation(id);
          }}
        />
      ) : null}
    </Card>
  );
}
