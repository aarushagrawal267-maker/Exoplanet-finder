/**
 * Choose which trained model versions score a signal (`GET /api/models`). Fixture models (pipeline
 * tests trained on synthetic data) are flagged and never preselected; incompatible models (trained
 * with another pipeline version) and models whose checkpoint is missing cannot be chosen.
 */
import { Cpu } from "lucide-react";
import { Link } from "react-router-dom";
import type { ModelVersionOut } from "@/api/schemas";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";
import { formatProbability, formatRelativeTime } from "@/lib/format";

export function modelUsable(m: ModelVersionOut): { ok: boolean; reason?: string } {
  if (!m.checkpoint_exists) return { ok: false, reason: "checkpoint file missing" };
  if (!m.compatible) return { ok: false, reason: `trained with pipeline v${m.pipeline_version}` };
  return { ok: true };
}

/** Default selection: the settings default, else the active model, else the newest real usable model. */
export function defaultModelIds(models: ModelVersionOut[], defaultId?: number | null): number[] {
  const usable = models.filter((m) => modelUsable(m).ok);
  const pick = usable.find((m) => m.id === defaultId) ?? usable.find((m) => m.is_active) ?? usable.find((m) => !m.is_fixture);
  return pick ? [pick.id] : [];
}

const metric = (m: Record<string, unknown> | undefined, k: string) => (typeof m?.[k] === "number" ? (m[k] as number) : null);

export function NoModelState({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <EmptyState
      size={compact ? "sm" : "md"}
      className={className}
      art={<Cpu className="size-10 text-nebula" aria-hidden="true" />}
      title="No trained model yet"
      description="Planet Detection scores signals with models you train on your own dataset. Build a dataset, train a model (logistic regression takes about a minute), then come back."
      actions={
        <>
          <Link to="/training" className={buttonClasses({ variant: "primary", size: "sm" })}>
            Open Model Training
          </Link>
          <Link to="/datasets" className={buttonClasses({ variant: "secondary", size: "sm" })}>
            Dataset Explorer
          </Link>
        </>
      }
    />
  );
}

export interface ModelPickerProps {
  models: ModelVersionOut[];
  value: number[];
  onChange: (ids: number[]) => void;
  /** Single choice (radio) instead of several (checkbox). */
  single?: boolean;
  className?: string;
}

export function ModelPicker({ models, value, onChange, single = false, className }: ModelPickerProps) {
  const toggle = (id: number) => {
    if (single) onChange([id]);
    else onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };
  return (
    <fieldset className={cn("flex flex-col gap-1.5", className)}>
      <legend className="sr-only">{single ? "Model" : "Models to run"}</legend>
      {models.map((m) => {
        const usable = modelUsable(m);
        const checked = value.includes(m.id);
        const test = metric(m.test_metrics, "pr_auc");
        const val = metric(m.val_metrics, "pr_auc");
        return (
          <label
            key={m.id}
            className={cn(
              "flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
              usable.ok ? "cursor-pointer" : "cursor-not-allowed opacity-60",
              checked ? "border-nebula/60 bg-nebula/[0.07]" : "border-hairline hover:border-hairline-strong",
              m.is_fixture && "border-dashed",
            )}
          >
            <input
              type={single ? "radio" : "checkbox"}
              name="model-picker"
              className="mt-1 accent-[var(--c-nebula)]"
              checked={checked}
              disabled={!usable.ok}
              onChange={() => toggle(m.id)}
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium text-fg">{m.name}</span>
                {m.is_active ? <Badge tone="nebula">Active</Badge> : null}
                {m.is_fixture ? <Badge tone="warn">Fixture — test only</Badge> : null}
                {!usable.ok ? <Badge tone="danger">Unavailable: {usable.reason}</Badge> : null}
              </span>
              <span className="num mt-0.5 flex flex-wrap gap-x-3 text-xs text-fg-secondary">
                <span>{m.model_type_name}</span>
                {m.dataset_name ? <span>{m.dataset_name}</span> : null}
                <span>threshold {formatProbability(m.threshold, { digits: 2 })}</span>
                <span>{test !== null ? `test PR-AUC ${formatProbability(test)}` : val !== null ? `val PR-AUC ${formatProbability(val)}` : "no metrics"}</span>
                {m.ensemble_size > 1 ? <span>{m.ensemble_size}-member ensemble</span> : null}
                <span>{formatRelativeTime(m.created_at)}</span>
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
