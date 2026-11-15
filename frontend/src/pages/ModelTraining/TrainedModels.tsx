/**
 * Trained model versions with their validation metrics (optimistic) and latest test metrics
 * (unbiased), the active badge, and activate / delete actions.
 */
import type { ColumnDef } from "@tanstack/react-table";
import { CircleCheck, Gauge, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "@/api/client";
import { useActivateModel, useDeleteModel } from "@/api/endpoints/modelAdmin";
import { useModels } from "@/api/endpoints/models";
import type { ModelVersionOut } from "@/api/schemas";
import type { ModelDeleteOut } from "@/api/schemasOps";
import { ApiErrorBanner, hasErrorCode } from "@/components/ui/ApiErrorBanner";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Button, buttonClasses } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatInt, formatProbability, formatRelativeTime } from "@/lib/format";
import { ConfirmDialog } from "../_ops/components";
import { apiDate, fmtMetric, metricOf, modelTypeLabel } from "../_ops/metrics";

function DeleteModelDialog({ model, onClose, onDeleted }: { model: ModelVersionOut; onClose: () => void; onDeleted: (out: ModelDeleteOut) => void }) {
  const del = useDeleteModel();
  const [force, setForce] = useState(false);
  const isOnlyActive = hasErrorCode(del.error, "model_is_active");
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      busy={del.isPending}
      title={force ? `Delete the only model “${model.name}”?` : `Delete model “${model.name}”?`}
      confirmLabel={force ? "Delete anyway" : "Delete model"}
      onConfirm={() =>
        del.mutate(
          { id: model.id, force },
          {
            onSuccess: (out) => onDeleted(out),
            onError: (err) => {
              if (err instanceof ApiError && err.code === "model_is_active") setForce(true);
            },
          },
        )
      }
    >
      <div className="flex flex-col gap-3 text-sm text-fg-secondary">
        <p>
          Removes the checkpoint files, its <span className="num text-fg">{formatInt(model.n_evaluations)}</span> evaluation(s)
          {model.n_test_evaluations ? <> (including {formatInt(model.n_test_evaluations)} logged test evaluation(s))</> : null} and every prediction made with it. The
          experiment record stays in the experiment log.
        </p>
        {model.is_active && !force ? <p className="text-warn">This is the active model: another model is promoted if one exists.</p> : null}
        {force ? (
          <Banner tone="danger" title={isOnlyActive && del.error instanceof ApiError ? del.error.detail : "This is the only model"}>
            Planet Detection and batch scoring stop working until you train another model.
          </Banner>
        ) : null}
        {del.isError && !isOnlyActive ? <ApiErrorBanner error={del.error} /> : null}
      </div>
    </ConfirmDialog>
  );
}

export function TrainedModels() {
  const models = useModels(true);
  const activate = useActivateModel();
  const { mutate: activateModel, isPending: activating, variables: activatingId } = activate;
  const [deleting, setDeleting] = useState<ModelVersionOut | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const columns = useMemo<ColumnDef<ModelVersionOut>[]>(
    () => [
      {
        id: "name",
        header: "Model",
        accessorFn: (r) => r.name,
        cell: ({ row }) => {
          const m = row.original;
          return (
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5">
                <span className="font-medium text-fg">{m.name}</span>
                {m.is_active ? (
                  <Badge tone="planet" icon={<CircleCheck />}>
                    active
                  </Badge>
                ) : null}
                {m.is_fixture ? <Badge tone="nebula">test fixture</Badge> : null}
                {!m.compatible ? <Badge tone="warn">old pipeline</Badge> : null}
              </span>
              <span className="text-xs text-fg-secondary">
                #{m.id} · {modelTypeLabel(m.model_type)} · {m.dataset_name ?? "dataset deleted"}
              </span>
            </span>
          );
        },
      },
      {
        id: "val_pr",
        header: "Val PR-AUC",
        accessorFn: (r) => metricOf(r.val_metrics, "pr_auc") ?? undefined,
        cell: ({ getValue }) => fmtMetric(getValue() as number | undefined),
        meta: { numeric: true, headerLabel: "Validation PR-AUC (optimistic)" },
      },
      {
        id: "val_roc",
        header: "Val ROC-AUC",
        accessorFn: (r) => metricOf(r.val_metrics, "roc_auc") ?? undefined,
        cell: ({ getValue }) => fmtMetric(getValue() as number | undefined),
        meta: { numeric: true, headerLabel: "Validation ROC-AUC (optimistic)" },
      },
      {
        id: "val_f1",
        header: "Val F1",
        accessorFn: (r) => metricOf(r.val_metrics, "f1") ?? undefined,
        cell: ({ getValue }) => fmtMetric(getValue() as number | undefined),
        meta: { numeric: true, headerLabel: "Validation F1 at the chosen threshold (optimistic)" },
      },
      {
        id: "test_pr",
        header: "Test PR-AUC",
        accessorFn: (r) => metricOf(r.test_metrics, "pr_auc") ?? undefined,
        cell: ({ row, getValue }) => {
          const v = getValue() as number | undefined;
          if (v === undefined) return <span className="text-fg-secondary">not evaluated</span>;
          const n = metricOf(row.original.test_metrics, "test_evaluation_number");
          return (
            <span title="Latest test evaluation (unbiased estimate)">
              {fmtMetric(v)}
              {n ? <span className="text-xs text-fg-secondary"> #{n}</span> : null}
            </span>
          );
        },
        meta: { numeric: true, headerLabel: "Test PR-AUC (latest test evaluation)" },
      },
      { id: "thr", header: "Threshold", accessorFn: (r) => r.threshold, cell: ({ getValue }) => formatProbability(getValue() as number), meta: { numeric: true, headerLabel: "Decision threshold (F1-optimal on validation)" } },
      { id: "created", header: "Trained", accessorFn: (r) => apiDate(r.created_at)?.getTime() ?? 0, cell: ({ row }) => <span className="text-fg-secondary">{formatRelativeTime(apiDate(row.original.created_at))}</span>, meta: { align: "right" } },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => {
          const m = row.original;
          return (
            <span className="flex items-center justify-end gap-1">
              {!m.is_active ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => activateModel(m.id, { onSuccess: () => setNotice(`“${m.name}” is now the active model.`) })}
                  loading={activating && activatingId === m.id}
                  aria-label={`Make ${m.name} the active model`}
                >
                  Activate
                </Button>
              ) : null}
              <Link to={`/evaluation?model=${m.id}`} className={buttonClasses({ variant: "ghost", size: "sm", iconOnly: true })} aria-label={`Evaluate ${m.name}`} title="Evaluate">
                <Gauge aria-hidden="true" />
              </Link>
              <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={`Delete ${m.name}`} onClick={() => setDeleting(m)} />
            </span>
          );
        },
      },
    ],
    [activateModel, activating, activatingId],
  );

  const list = models.data ?? [];
  return (
    <div className="flex flex-col gap-3">
      {notice ? <Banner tone="info" title={notice} onDismiss={() => setNotice(null)} /> : null}
      {activate.isError ? <ApiErrorBanner error={activate.error} /> : null}
      {models.isError ? (
        <ApiErrorBanner error={models.error} onRetry={() => void models.refetch()} />
      ) : !models.isLoading && list.length === 0 ? (
        <EmptyState size="sm" title="No trained models yet" description="Start a run above. Logistic regression and random forest train in seconds; the CNNs take minutes per epoch on a CPU." />
      ) : (
        <DataTable
          caption="Trained models"
          data={list}
          columns={columns}
          loading={models.isLoading}
          getRowId={(r) => String(r.id)}
          showDensityToggle={false}
          initialSorting={[{ id: "created", desc: true }]}
          maxHeight={480}
          toolbar={<span>Validation metrics are optimistic (threshold and calibration were tuned on validation); test metrics are the unbiased estimate.</span>}
        />
      )}
      {deleting ? (
        <DeleteModelDialog
          model={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(out) => {
            setDeleting(null);
            setNotice(
              `Model #${out.model_id} deleted (${out.evaluations} evaluation(s), ${out.predictions} prediction(s) removed).${out.active_model_id ? ` Active model: #${out.active_model_id}.` : ""}`,
            );
          }}
        />
      ) : null}
    </div>
  );
}
