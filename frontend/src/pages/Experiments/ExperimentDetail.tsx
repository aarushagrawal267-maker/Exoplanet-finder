/**
 * One experiment: summary, configuration (the settings that matter for its model type),
 * environment, per-epoch curves, validation (optimistic) and test (unbiased) metrics, its model
 * version and evaluations, notes / tags / name editing, archive, delete and report downloads.
 */
import { Archive, ArchiveRestore, ExternalLink, Gauge, Pencil, Save, Trash2, X } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { useDeleteExperiment, useExperiment, usePatchExperiment } from "@/api/endpoints/experiments";
import type { ExperimentDeleteOut, ExperimentDetailOut } from "@/api/schemasOps";
import { TrainingCurves } from "@/components/charts/TrainingCurves";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input, controlClasses } from "@/components/ui/Input";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";
import { formatDateTime, formatDuration, formatInt, formatProbability } from "@/lib/format";
import { ConfirmDialog, EpochChart, MetricTile, SplitTag, StatusBadge } from "../_ops/components";
import { apiDate, ciOf, CONFIG_KEYS, CONFIG_LABEL, fmtMetric, formatConfigValue, isBaseline, metricOf, modelTypeLabel } from "../_ops/metrics";
import { ReportButtons } from "./ReportButtons";

const ENV_KEYS: Array<[string, string]> = [
  ["exofinder", "Exoplanet Finder"],
  ["pipeline_version", "Pipeline version"],
  ["git_commit", "Git commit"],
  ["python", "Python"],
  ["torch", "PyTorch"],
  ["sklearn", "scikit-learn"],
  ["numpy", "NumPy"],
  ["default_device", "Device"],
  ["torch_num_threads", "Torch threads"],
  ["cpu_count", "CPU cores"],
  ["cuda_available", "CUDA available"],
  ["cuda_device", "CUDA device"],
  ["platform", "Platform"],
];

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const parts = text
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (parts.length) onChange([...new Set([...tags, ...parts])]);
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !text && tags.length) {
      onChange(tags.slice(0, -1));
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
        {tags.map((t) => (
          <li key={t}>
            <span className="inline-flex h-7 items-center gap-1 rounded-full border border-hairline-strong pl-2.5 pr-1 text-sm text-fg">
              {t}
              <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`Remove tag ${t}`} className="rounded-full p-0.5 text-fg-secondary hover:text-fg">
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
        {!tags.length ? <li className="text-sm text-fg-secondary">No tags.</li> : null}
      </ul>
      <Input size="sm" aria-label="Add a tag" placeholder="Add a tag and press Enter" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onBlur={add} />
    </div>
  );
}

function NotesAndTags({ exp }: { exp: ExperimentDetailOut }) {
  const patch = usePatchExperiment();
  const [notes, setNotes] = useState(exp.notes);
  const [tags, setTags] = useState(exp.tags);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setNotes(exp.notes);
    setTags(exp.tags);
  }, [exp.id, exp.notes, exp.tags]);
  const dirty = notes !== exp.notes || JSON.stringify(tags) !== JSON.stringify(exp.tags);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`notes-${exp.id}`} className="text-sm font-medium text-fg">
          Notes
        </label>
        <textarea
          id={`notes-${exp.id}`}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setSaved(false);
          }}
          rows={4}
          placeholder="What did you try, and what did you learn?"
          className={cn(controlClasses, "min-h-[96px] resize-y px-3 py-2 text-base")}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-fg">Tags</span>
        <TagEditor
          tags={tags}
          onChange={(t) => {
            setTags(t);
            setSaved(false);
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" icon={<Save />} disabled={!dirty} loading={patch.isPending} onClick={() => patch.mutate({ id: exp.id, patch: { notes, tags } }, { onSuccess: () => setSaved(true) })}>
          Save notes and tags
        </Button>
        {saved && !dirty ? (
          <span className="text-xs text-fg-secondary" role="status">
            Saved.
          </span>
        ) : null}
        {dirty ? <span className="text-xs text-warn">Unsaved changes</span> : null}
      </div>
      {patch.isError ? <ApiErrorBanner error={patch.error} /> : null}
    </div>
  );
}

function NameEditor({ exp }: { exp: ExperimentDetailOut }) {
  const patch = usePatchExperiment();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(exp.name);
  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="font-display text-xl">{exp.name}</span>
        <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label="Rename experiment" onClick={() => (setName(exp.name), setEditing(true))} />
      </span>
    );
  }
  const trimmed = name.trim();
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!trimmed) return;
        patch.mutate({ id: exp.id, patch: { name: trimmed } }, { onSuccess: () => setEditing(false) });
      }}
    >
      <Input aria-label="Experiment name" value={name} onChange={(e) => setName(e.target.value)} maxLength={128} className="w-72 max-w-full" autoFocus />
      <Button type="submit" size="sm" variant="primary" disabled={!trimmed} loading={patch.isPending}>
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      {patch.isError ? <ApiErrorBanner error={patch.error} className="w-full" /> : null}
    </form>
  );
}

export interface ExperimentDetailProps {
  id: number;
  onClose: () => void;
  onDeleted: (out: ExperimentDeleteOut) => void;
}

export function ExperimentDetail({ id, onClose, onDeleted }: ExperimentDetailProps) {
  const q = useExperiment(id);
  const patch = usePatchExperiment();
  const del = useDeleteExperiment();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const exp = q.data;

  if (q.isLoading) {
    return (
      <Card className="flex flex-col gap-4" aria-busy="true">
        <Skeleton height={24} width="40%" />
        <SkeletonText lines={3} />
        <Skeleton height={200} />
      </Card>
    );
  }
  if (q.isError || !exp) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const cfg = exp.config as Record<string, unknown>;
  const env = exp.environment as Record<string, unknown>;
  const keys = CONFIG_KEYS[exp.model_type] ?? Object.keys(cfg);
  const vm = exp.val_metrics as Record<string, unknown>;
  const tm = exp.test_metrics as Record<string, unknown>;
  const testCi = (tm.ci ?? {}) as Record<string, unknown>;
  const hasTest = metricOf(tm, "pr_auc") !== null;
  const mv = exp.model_version;
  const members = typeof cfg.ensemble_size === "number" ? cfg.ensemble_size : 1;
  const maxEpochs = typeof cfg.max_epochs === "number" ? cfg.max_epochs * members : undefined;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          eyebrow={`Experiment #${exp.id} · ${formatDateTime(apiDate(exp.created_at))}`}
          title={<NameEditor key={exp.id} exp={exp} />}
          actions={<Button size="sm" variant="ghost" iconOnly icon={<X />} aria-label="Close experiment" onClick={onClose} />}
        >
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={exp.status} />
            <Badge>{modelTypeLabel(exp.model_type)}</Badge>
            <Link to={`/datasets?id=${exp.dataset_id}`} className="text-sm text-cosmic hover:underline">
              {exp.dataset_name ?? `dataset #${exp.dataset_id}`}
            </Link>
            {exp.is_active_model ? <Badge tone="planet">active model</Badge> : null}
            {exp.is_fixture ? <Badge tone="nebula">test fixture</Badge> : null}
            {exp.archived ? <Badge tone="uncertain">archived</Badge> : null}
            {exp.tags.map((t) => (
              <Badge key={t} tone="cosmic">
                {t}
              </Badge>
            ))}
          </div>
        </CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          {mv ? (
            <Link to={`/evaluation?model=${mv.id}`} className={buttonClasses({ variant: "model", size: "sm" })}>
              <Gauge aria-hidden="true" /> Evaluate model #{mv.id}
            </Link>
          ) : null}
          {exp.job_id && (exp.status === "running" || exp.status === "queued") ? (
            <Link to={`/training?job=${exp.job_id}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
              Follow training <ExternalLink aria-hidden="true" />
            </Link>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            icon={exp.archived ? <ArchiveRestore /> : <Archive />}
            loading={patch.isPending}
            onClick={() => patch.mutate({ id: exp.id, patch: { archived: !exp.archived } })}
          >
            {exp.archived ? "Unarchive" : "Archive"}
          </Button>
          <Button size="sm" variant="danger" icon={<Trash2 />} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        </div>
        {patch.isError ? <ApiErrorBanner className="mt-3" error={patch.error} /> : null}
        {exp.error ? (
          <Banner tone={exp.status === "cancelled" ? "warn" : "danger"} title={exp.status === "cancelled" ? "Cancelled" : "Training failed"} className="mt-4">
            {exp.error}
          </Banner>
        ) : null}
        <div className="mt-4 border-t border-hairline pt-4">
          <ReportButtons experimentIds={[exp.id]} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Validation metrics" description="Optimistic: threshold, calibration and early stopping were tuned on the validation split." />
          {metricOf(vm, "pr_auc") !== null ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {["pr_auc", "roc_auc", "f1", "precision", "recall", "ece"].map((k) => (
                <MetricTile key={k} metric={k} value={metricOf(vm, k)} emphasis={k === "pr_auc"} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-fg-secondary">No validation metrics recorded{exp.status === "running" ? " yet" : ""}.</p>
          )}
          <p className="mt-3 text-xs text-fg-secondary">
            Decision threshold <span className="num text-fg">{formatProbability(exp.threshold)}</span> (F1-optimal on validation)
            {exp.best_epoch ? (
              <>
                {" "}
                · best epoch <span className="num text-fg">{exp.best_epoch}</span> of <span className="num text-fg">{formatInt(exp.epochs_run)}</span>
              </>
            ) : null}
            {exp.duration_s ? <> · trained in {formatDuration(exp.duration_s)}</> : null}
            {exp.device ? <> on {exp.device}</> : null}
          </p>
        </Card>
        <Card>
          <CardHeader
            title="Test metrics"
            description="The unbiased estimate, from the model's latest test evaluation."
            actions={hasTest ? <SplitTag split="test" testNumber={metricOf(tm, "test_evaluation_number")} /> : null}
          />
          {hasTest ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {["pr_auc", "roc_auc", "f1", "precision", "recall", "ece"].map((k) => (
                <MetricTile key={k} metric={k} value={metricOf(tm, k)} ci={ciOf(testCi, k)} emphasis={k === "pr_auc"} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-fg-secondary">Not evaluated on the test split. Evaluate each final model once, from the Model Evaluation page.</p>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Training curves" description={isBaseline(exp.model_type) ? "Baselines fit in one step (grid search with grouped CV): a single point per metric." : "Per-epoch loss and validation metrics; the dashed line marks the checkpoint kept (best validation PR-AUC)."} />
        {exp.epochs.length ? (
          isBaseline(exp.model_type) ? (
            <KeyValueList
              columns={2}
              items={[
                { key: "tl", label: "Training loss", value: fmtMetric(exp.epochs[0]?.train_loss, 4) },
                { key: "vl", label: "Validation loss", value: fmtMetric(exp.epochs[0]?.val_loss, 4) },
                { key: "pr", label: "Validation PR-AUC", value: fmtMetric(exp.epochs[0]?.val_pr_auc) },
                { key: "roc", label: "Validation ROC-AUC", value: fmtMetric(exp.epochs[0]?.val_roc_auc) },
              ]}
            />
          ) : (
            <div className="flex flex-col gap-5">
              <TrainingCurves history={exp.epochs} bestEpoch={exp.best_epoch} maxEpochs={maxEpochs} />
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <EpochChart series={[{ id: String(exp.id), label: exp.name, modelType: exp.model_type, points: exp.epochs }]} metric="val_roc_auc" height={180} />
              </div>
            </div>
          )
        ) : (
          <p className="text-sm text-fg-secondary">No epochs recorded.</p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Configuration" description={`Settings used by the ${modelTypeLabel(exp.model_type).toLowerCase()} (seed ${exp.seed}).`} />
          <KeyValueList dense items={keys.filter((k) => k in cfg).map((k) => ({ key: k, label: CONFIG_LABEL[k] ?? k, value: formatConfigValue(cfg[k]) }))} />
        </Card>
        <Card>
          <CardHeader title="Environment" description="Recorded when training started, for reproducibility." />
          <KeyValueList dense items={ENV_KEYS.filter(([k]) => k in env).map(([k, label]) => ({ key: k, label, value: <span className="break-all">{formatConfigValue(env[k])}</span> }))} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Model version and evaluations" />
          {mv ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-fg">
                Model <span className="num">#{mv.id}</span> · {mv.n_params ? `${formatInt(mv.n_params)} parameters · ` : ""}
                {mv.ensemble_size > 1 ? `${mv.ensemble_size}-member ensemble · ` : ""}temperature <span className="num">{formatProbability(mv.temperature)}</span>
              </p>
              {exp.evaluations.length ? (
                <ul className="flex flex-col divide-y divide-hairline">
                  {exp.evaluations.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="flex items-center gap-2">
                        <Link to={`/evaluation?eval=${e.id}`} className="num text-cosmic hover:underline">
                          evaluation #{e.id}
                        </Link>
                        <SplitTag split={e.split} testNumber={e.test_evaluation_number} />
                      </span>
                      <span className="num text-sm text-fg-secondary">
                        PR-AUC <span className="text-fg">{fmtMetric(metricOf(e.summary, "pr_auc"))}</span> · {formatDateTime(apiDate(e.created_at))}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-fg-secondary">Not evaluated yet.</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-fg-secondary">{exp.status === "succeeded" ? "The model version was deleted." : "No model version (training did not finish)."}</p>
          )}
        </Card>
        <Card>
          <CardHeader title="Notes and tags" />
          <NotesAndTags exp={exp} />
        </Card>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => {
          setConfirmDelete(false);
          del.reset();
        }}
        busy={del.isPending}
        title={`Delete experiment “${exp.name}”?`}
        confirmLabel="Delete experiment"
        onConfirm={() =>
          del.mutate(exp.id, {
            onSuccess: (out) => {
              setConfirmDelete(false);
              onDeleted(out);
            },
          })
        }
      >
        <div className="flex flex-col gap-3 text-sm text-fg-secondary">
          <p>
            This permanently removes the experiment and its epoch log{mv ? <>, model version #{mv.id} with its checkpoint files</> : null}
            {exp.evaluations.length ? <>, its {exp.evaluations.length} evaluation(s)</> : null} and every prediction made with that model.
          </p>
          {exp.is_active_model ? <p className="text-warn">Its model is the active model: another model will be promoted, if one exists.</p> : null}
          {del.isError ? <ApiErrorBanner error={del.error} /> : null}
        </div>
      </ConfirmDialog>
    </div>
  );
}
