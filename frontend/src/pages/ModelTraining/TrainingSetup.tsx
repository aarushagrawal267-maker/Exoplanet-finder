/**
 * Training setup: model cards (what each model is, its inputs, strengths and limitations), the
 * dataset, the configuration form (defaults from the card, validated), the measured epoch-time
 * estimate, and the buttons that start a run or the full four-model suite.
 */
import { ChevronRight, Layers, Play, RotateCcw, Timer } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useStartSuite, useStartTraining, useTrainingEstimate } from "@/api/endpoints/training";
import type { JobOut } from "@/api/schemas";
import type { DatasetOut, ModelCardOut, ModelTypeId } from "@/api/schemasOps";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { NumberInput } from "@/components/ui/NumberInput";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Switch } from "@/components/ui/Switch";
import { cn } from "@/lib/cn";
import { formatDuration, formatInt, formatNumber } from "@/lib/format";
import { ConfirmDialog } from "../_ops/components";
import { MODEL_TYPES, modelTypeLabel } from "../_ops/metrics";
import { defaultForm, maxTrainingSeconds, validateForm, type CnnForm, type FormState, type ForestForm, type LogregForm } from "./config";

// ------------------------------------------------------------------------------------------------
function ModelCard({ card, selected, onSelect }: { card: ModelCardOut; selected: boolean; onSelect: () => void }) {
  return (
    <div
      className={cn(
        "card-surface flex h-full flex-col gap-3 p-4 transition-colors duration-fast",
        selected ? "border-cosmic/70 bg-cosmic/[0.05]" : "hover:border-hairline-strong",
      )}
    >
      <button type="button" role="radio" aria-checked={selected} onClick={onSelect} className="flex items-start justify-between gap-2 text-left">
        <span>
          <span className="block text-md font-semibold text-fg">{card.name}</span>
          <span className="num text-xs text-fg-secondary">{card.n_params ? `${formatInt(card.n_params)} parameters` : "classical baseline"}</span>
        </span>
        <span className={cn("mt-1 size-3.5 shrink-0 rounded-full border", selected ? "border-cosmic bg-cosmic" : "border-fg-muted")} aria-hidden="true" />
      </button>
      <p className="text-sm text-fg-secondary">{card.description}</p>
      <div>
        <div className="eyebrow mb-1 text-fg-secondary">Inputs</div>
        <ul className="flex flex-col gap-0.5 text-xs text-fg">
          {card.inputs.map((i) => (
            <li key={i}>· {i}</li>
          ))}
        </ul>
      </div>
      <details className="group mt-auto text-xs">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-fg-secondary hover:text-fg [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden="true" />
          Strengths, limitations, architecture
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <div>
            <div className="eyebrow mb-0.5 text-fg-secondary">Strengths</div>
            <ul className="text-fg">
              {card.strengths.map((s) => (
                <li key={s}>+ {s}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="eyebrow mb-0.5 text-fg-secondary">Limitations</div>
            <ul className="text-fg">
              {card.limitations.map((s) => (
                <li key={s}>− {s}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="eyebrow mb-0.5 text-fg-secondary">Architecture</div>
            <ul className="num text-2xs text-fg-secondary">
              {card.architecture.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
          {card.uncertainty ? <p className="text-fg-secondary">Uncertainty: {card.uncertainty}</p> : null}
          {card.training ? <p className="text-fg-secondary">Training: {card.training}</p> : null}
          {card.reference ? <p className="text-fg-secondary">Reference: {card.reference}</p> : null}
        </div>
      </details>
    </div>
  );
}

export function ModelCards({ cards, loading, value, onChange }: { cards: ModelCardOut[]; loading: boolean; value: ModelTypeId; onChange: (t: ModelTypeId) => void }) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {MODEL_TYPES.map((t) => (
          <Card key={t} className="flex flex-col gap-3">
            <Skeleton height={16} width="60%" />
            <Skeleton height={10} />
            <Skeleton height={10} width="85%" />
            <Skeleton height={40} />
          </Card>
        ))}
      </div>
    );
  }
  return (
    <div role="radiogroup" aria-label="Model type" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => (
        <ModelCard key={c.type} card={c} selected={value === c.type} onSelect={() => onChange(c.type)} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
type Errors = Partial<Record<string, string>>;

function NumField({
  label,
  help,
  value,
  onChange,
  error,
  warning,
  min,
  max,
  step = 1,
  precision,
}: {
  label: ReactNode;
  help?: ReactNode;
  value: number | null;
  onChange: (v: number | null) => void;
  error?: string;
  warning?: string;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
}) {
  return (
    <Field label={label} help={warning ? <span className="text-warn">{warning}</span> : help} error={error}>
      <NumberInput value={value} onChange={onChange} min={min} max={max} step={step} precision={precision} allowEmpty />
    </Field>
  );
}

/** Free-text learning rate (accepts 1e-4); keeps the typed text while it is not yet a number. */
function LrInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    setText((t) => ((value !== null && Number.isNaN(value)) || (t.trim() !== "" && Number(t) === value) ? t : value === null ? "" : String(value)));
  }, [value]);
  return (
    <Input
      mono
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const t = e.target.value.trim();
        onChange(t === "" ? null : Number.isFinite(Number(t)) ? Number(t) : Number.NaN);
      }}
    />
  );
}

function CnnFields({ v, set, errors, warnings }: { v: CnnForm; set: (p: Partial<CnnForm>) => void; errors: Errors; warnings: Errors }) {
  return (
    <>
      <Field
        label="Learning rate"
        help={warnings.lr ? <span className="text-warn">{warnings.lr}</span> : "Adam step size (scientific notation allowed, e.g. 1e-4)."}
        error={errors.lr}
      >
        <LrInput value={v.lr} onChange={(lr) => set({ lr })} />
      </Field>
      <NumField label="Batch size" value={v.batch_size} onChange={(x) => set({ batch_size: x })} error={errors.batch_size} min={1} max={4096} step={8} help="Examples per gradient step." />
      <NumField label="Max epochs" value={v.max_epochs} onChange={(x) => set({ max_epochs: x })} error={errors.max_epochs} min={1} max={1000} help="Upper limit; early stopping usually ends sooner." />
      <NumField
        label="Early-stopping patience"
        value={v.patience}
        onChange={(x) => set({ patience: x })}
        error={errors.patience}
        warning={warnings.patience}
        min={1}
        max={1000}
        help="Epochs without a validation PR-AUC improvement before stopping."
      />
      <NumField label="Dropout" value={v.dropout} onChange={(x) => set({ dropout: x })} error={errors.dropout} min={0} max={0.95} step={0.05} precision={2} help="Fraction of fully-connected units dropped while training." />
      <NumField label="FC width" value={v.fc_width} onChange={(x) => set({ fc_width: x })} error={errors.fc_width} min={1} max={8192} step={64} help="Units per fully-connected layer." />
      <NumField label="FC layers" value={v.fc_layers} onChange={(x) => set({ fc_layers: x })} error={errors.fc_layers} min={0} max={16} help="Fully-connected layers after the convolutions." />
      <NumField label="Ensemble size" value={v.ensemble_size} onChange={(x) => set({ ensemble_size: x })} error={errors.ensemble_size} min={1} max={10} help="Independently seeded members; their spread is the uncertainty." />
      <NumField label="Weight decay" value={v.weight_decay} onChange={(x) => set({ weight_decay: x })} error={errors.weight_decay} min={0} step={0.0001} precision={4} help="L2 penalty (0 = off)." />
      <NumField label="Seed" value={v.seed} onChange={(x) => set({ seed: x })} error={errors.seed} min={0} help="Initialisation and shuffling seed (reproducibility)." />
      <div className="sm:col-span-2">
        <Switch
          checked={v.augment_flip}
          onChange={(x) => set({ augment_flip: x })}
          label="Time-reversal augmentation"
          description="Randomly mirror the views in time while training (a transit is symmetric)."
        />
      </div>
    </>
  );
}

function ListField({ label, value, onChange, error, warning, help }: { label: string; value: string; onChange: (s: string) => void; error?: string; warning?: string; help: string }) {
  return (
    <Field label={label} error={error} help={warning ? <span className="text-warn">{warning}</span> : help}>
      <Input mono value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function LogregFields({ v, set, errors }: { v: LogregForm; set: (p: Partial<LogregForm>) => void; errors: Errors }) {
  return (
    <>
      <ListField label="C grid" value={v.logreg_c_grid} onChange={(s) => set({ logreg_c_grid: s })} error={errors.logreg_c_grid} help="Inverse L2 strengths tried by grouped cross-validation (comma-separated)." />
      <NumField label="Max iterations" value={v.logreg_max_iter} onChange={(x) => set({ logreg_max_iter: x })} error={errors.logreg_max_iter} min={1} step={500} help="Solver iteration limit." />
      <NumField label="CV folds" value={v.cv_folds} onChange={(x) => set({ cv_folds: x })} error={errors.cv_folds} min={2} max={20} help="Grouped by star on the training split." />
      <NumField label="Seed" value={v.seed} onChange={(x) => set({ seed: x })} error={errors.seed} min={0} />
    </>
  );
}

function ForestFields({ v, set, errors, warnings }: { v: ForestForm; set: (p: Partial<ForestForm>) => void; errors: Errors; warnings: Errors }) {
  return (
    <>
      <NumField label="Trees" value={v.rf_n_estimators} onChange={(x) => set({ rf_n_estimators: x })} error={errors.rf_n_estimators} min={1} max={5000} step={50} help="Number of trees in the forest." />
      <ListField
        label="Max depth grid"
        value={v.rf_max_depth_grid}
        onChange={(s) => set({ rf_max_depth_grid: s })}
        error={errors.rf_max_depth_grid}
        warning={warnings.rf_max_depth_grid}
        help="Depths tried by grouped CV; “none” = unlimited."
      />
      <ListField label="Min samples per leaf grid" value={v.rf_min_samples_leaf_grid} onChange={(s) => set({ rf_min_samples_leaf_grid: s })} error={errors.rf_min_samples_leaf_grid} help="Whole numbers ≥ 1." />
      <ListField label="Max features grid" value={v.rf_max_features_grid} onChange={(s) => set({ rf_max_features_grid: s })} error={errors.rf_max_features_grid} help="“sqrt”, “log2” or a fraction of the features." />
      <NumField label="CV folds" value={v.cv_folds} onChange={(x) => set({ cv_folds: x })} error={errors.cv_folds} min={2} max={20} help="Grouped by star on the training split." />
      <NumField label="Seed" value={v.seed} onChange={(x) => set({ seed: x })} error={errors.seed} min={0} />
    </>
  );
}

// ------------------------------------------------------------------------------------------------
function EstimatePanel({ modelType, datasetId, form }: { modelType: ModelTypeId; datasetId: number | null; form: FormState }) {
  const est = useTrainingEstimate(modelType, datasetId);
  const e = est.data;
  const upper = maxTrainingSeconds(e?.seconds_per_epoch, form);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-space/50 p-4" aria-live="polite">
      <div className="flex items-center gap-2 text-fg-secondary">
        <Timer className="size-4" aria-hidden="true" />
        <span className="eyebrow">Time estimate</span>
      </div>
      {datasetId === null ? (
        <p className="text-sm text-fg-secondary">Choose a dataset to measure the training speed.</p>
      ) : est.isLoading ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-fg-secondary">Measuring a few real training steps on this machine…</p>
          <Skeleton height={10} width="60%" />
        </div>
      ) : est.isError ? (
        <ApiErrorBanner error={est.error} title="No estimate" onRetry={() => void est.refetch()} />
      ) : e ? (
        <>
          {e.seconds_per_epoch !== null && e.seconds_per_epoch !== undefined ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-fg-secondary">Per epoch</dt>
                <dd className="num text-fg">{formatDuration(e.seconds_per_epoch)}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-secondary">Upper bound</dt>
                <dd className="num text-fg">{formatDuration(upper)}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-secondary">Training examples</dt>
                <dd className="num text-fg">
                  {formatInt(e.n_train)} · {formatInt(e.batches_per_epoch)} batches
                </dd>
              </div>
              <div>
                <dt className="text-xs text-fg-secondary">Device</dt>
                <dd className="num text-fg">
                  {e.device ?? "—"}
                  {e.num_threads ? ` · ${e.num_threads} threads` : ""}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="num text-sm text-fg">
              {formatInt(e.n_train)} training examples · {e.device ?? "cpu"}
            </p>
          )}
          <p className="text-xs text-fg-secondary">
            {e.note}
            {upper !== null ? ` Upper bound = ${formatNumber(e.seconds_per_epoch, { digits: 1 })} s × ${form.kind === "cnn" ? form.v.max_epochs : "—"} epochs × ${form.kind === "cnn" ? form.v.ensemble_size : 1} member(s).` : ""}
          </p>
        </>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
export interface TrainingSetupProps {
  cards: ModelCardOut[];
  cardsLoading: boolean;
  datasets: DatasetOut[];
  initialDatasetId: number | null;
  initialType: ModelTypeId | null;
  onStarted: (job: JobOut, experimentIds: number[]) => void;
  busyJob: boolean;
}

export function TrainingSetup({ cards, cardsLoading, datasets, initialDatasetId, initialType, onStarted, busyJob }: TrainingSetupProps) {
  const ready = datasets.filter((d) => d.status === "ready");
  const [modelType, setModelType] = useState<ModelTypeId>(initialType ?? "cnn_two_view");
  const [datasetId, setDatasetId] = useState<number | null>(initialDatasetId ?? ready[0]?.id ?? null);
  const card = cards.find((c) => c.type === modelType);
  const [form, setForm] = useState<FormState>(() => defaultForm(modelType, card?.default_config));
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [suiteOpen, setSuiteOpen] = useState(false);
  const start = useStartTraining();
  const suite = useStartSuite();

  // New model type (or its card arriving): reset the form to that card's defaults.
  useEffect(() => {
    setForm(defaultForm(modelType, card?.default_config));
    setSubmitted(false);
  }, [modelType, card]);
  useEffect(() => {
    if (datasetId === null && ready[0]) setDatasetId(ready[0].id);
  }, [datasetId, ready]);

  const validation = useMemo(() => validateForm(form), [form]);
  const errors = submitted ? validation.errors : {};
  const dataset = ready.find((d) => d.id === datasetId) ?? null;
  const nameError = name.length > 128 ? "At most 128 characters." : undefined;
  const canStart = datasetId !== null && validation.config !== null && !nameError;

  const setCnn = (p: Partial<CnnForm>) => setForm((f) => (f.kind === "cnn" ? { kind: "cnn", v: { ...f.v, ...p } } : f));
  const setLogreg = (p: Partial<LogregForm>) => setForm((f) => (f.kind === "logreg" ? { kind: "logreg", v: { ...f.v, ...p } } : f));
  const setForest = (p: Partial<ForestForm>) => setForm((f) => (f.kind === "forest" ? { kind: "forest", v: { ...f.v, ...p } } : f));

  const submit = () => {
    setSubmitted(true);
    if (!canStart || datasetId === null || !validation.config) return;
    start.mutate(
      { name: name.trim() || null, model_type: modelType, dataset_id: datasetId, config: validation.config },
      { onSuccess: (out) => onStarted(out.job, [out.experiment_id]) },
    );
  };
  const startSuite = () => {
    if (datasetId === null) return;
    suite.mutate(
      { dataset_id: datasetId, name_prefix: name.trim() || null, configs: validation.config ? { [modelType]: validation.config } : {} },
      {
        onSuccess: (out) => {
          setSuiteOpen(false);
          onStarted(out.job, out.experiment_ids);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <ModelCards cards={cards} loading={cardsLoading} value={modelType} onChange={setModelType} />
      <Card>
        <CardHeader
          eyebrow="Configuration"
          title={`${modelTypeLabel(modelType)}${dataset ? ` on “${dataset.name}”` : ""}`}
          description="Defaults come from the model card. Model selection (early stopping, threshold, calibration) uses the validation split only; the test split is never touched by training."
          actions={
            <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => setForm(defaultForm(modelType, card?.default_config))}>
              <span className="hidden sm:inline">Reset to defaults</span>
            </Button>
          }
        />
        <form
          noValidate
          aria-label="Training configuration"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex flex-col gap-5"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Dataset" required help={dataset ? `${formatInt(dataset.n_train)} train · ${formatInt(dataset.n_val)} validation · ${formatInt(dataset.n_test)} test examples` : undefined}>
              <Select
                value={datasetId === null ? "" : String(datasetId)}
                onChange={(v) => setDatasetId(v ? Number(v) : null)}
                placeholder="Choose a ready dataset…"
                options={ready.map((d) => ({ value: String(d.id), label: `${d.name} (${formatInt(d.n_examples)} examples)` }))}
              />
            </Field>
            <Field label="Run name" help="Optional; defaults to “<model type> - <dataset>”." error={nameError}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${modelTypeLabel(modelType)} - ${dataset?.name ?? "dataset"}`} maxLength={160} />
            </Field>
          </div>
          <fieldset className="border-t border-hairline pt-4">
            <legend className="eyebrow float-left mb-3 w-full text-fg-secondary">Hyperparameters</legend>
            <div className="clear-left grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {form.kind === "cnn" ? <CnnFields v={form.v} set={setCnn} errors={errors} warnings={validation.warnings} /> : null}
              {form.kind === "logreg" ? <LogregFields v={form.v} set={setLogreg} errors={errors} /> : null}
              {form.kind === "forest" ? <ForestFields v={form.v} set={setForest} errors={errors} warnings={validation.warnings} /> : null}
            </div>
          </fieldset>
          <EstimatePanel modelType={modelType} datasetId={datasetId} form={form} />
          {submitted && Object.keys(validation.errors).length ? (
            <Banner tone="danger" title="Fix the highlighted settings before starting." />
          ) : null}
          {start.isError ? <ApiErrorBanner error={start.error} /> : null}
          {busyJob ? <Banner tone="info" title="A training job is running">New runs wait in the queue until it finishes (one heavy job at a time).</Banner> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="model" size="lg" icon={<Play />} loading={start.isPending} disabled={datasetId === null}>
              Start training
            </Button>
            <Button variant="secondary" icon={<Layers />} onClick={() => setSuiteOpen(true)} disabled={datasetId === null}>
              Train the full suite
            </Button>
            <Badge tone="neutral">runs locally · no external AI services</Badge>
          </div>
        </form>
      </Card>
      <ConfirmDialog
        open={suiteOpen}
        onClose={() => setSuiteOpen(false)}
        danger={false}
        busy={suite.isPending}
        title="Train all four models?"
        confirmLabel="Start the suite"
        onConfirm={startSuite}
      >
        <div className="flex flex-col gap-3 text-sm text-fg-secondary">
          <p>
            Trains logistic regression, random forest, the global-view CNN and the two-view CNN on <span className="text-fg">“{dataset?.name}”</span>, one after the
            other, as one background job.
          </p>
          <p>
            The {modelTypeLabel(modelType)} uses the settings in this form{validation.config ? "" : " (they are invalid, so its defaults are used)"}; the other three use their
            model-card defaults. The CNNs take most of the time.
          </p>
          {suite.isError ? <ApiErrorBanner error={suite.error} /> : null}
        </div>
      </ConfirmDialog>
    </div>
  );
}
