/**
 * Model Evaluation — evaluate a trained model on the validation split (optimistic) or the
 * held-out test split (unbiased, once per final model), and read the result: metrics with 95 %
 * CIs, ROC / PR curves, calibration, confusion matrix, threshold comparison, timing, error
 * analysis and (baselines) permutation importance. Several evaluations can be compared.
 *
 * URL state: `?model=<id>` (model to evaluate), `?eval=<id>` (evaluation shown),
 * `?compare=<id>,<id>…` (evaluations in the comparison).
 */
import type { ColumnDef } from "@tanstack/react-table";
import { Cpu } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useEvaluations } from "@/api/endpoints/evaluation";
import { useModels } from "@/api/endpoints/models";
import type { EvaluationOut } from "@/api/schemasOps";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Skeleton } from "@/components/ui/Skeleton";
import { Switch } from "@/components/ui/Switch";
import { formatInt, formatRelativeTime } from "@/lib/format";
import { useLocalStorage } from "@/lib/hooks";
import { SplitTag, useParamState } from "../_ops/components";
import { apiDate, fmtMetric, metricOf, modelTypeLabel, parseId, parseIdList } from "../_ops/metrics";
import { CompareEvaluations } from "./CompareEvaluations";
import { EvaluationResults } from "./EvaluationResults";
import { RunEvaluation } from "./RunEvaluation";

export default function ModelEvaluationPage() {
  const [params, setParams] = useParamState();
  const models = useModels(true);
  const evaluations = useEvaluations({});
  const [onlyModel, setOnlyModel] = useLocalStorage("exo.evaluation.onlyModel", false);

  const evalId = parseId(params.get("eval"));
  const compareIds = parseIdList(params.get("compare"));
  const allEvals = evaluations.data ?? [];
  const list = models.data ?? [];
  const evalRow = allEvals.find((e) => e.id === evalId);
  const modelParam = parseId(params.get("model"));
  const modelId = modelParam ?? evalRow?.model_version_id ?? list.find((m) => m.is_active)?.id ?? list[0]?.id ?? null;
  const latestTest = allEvals.filter((e) => e.model_version_id === modelId && e.split === "test").sort((a, b) => b.id - a.id)[0];
  const shown = onlyModel && modelId !== null ? allEvals.filter((e) => e.model_version_id === modelId) : allEvals;

  const toggleCompare = (id: number) => {
    const next = compareIds.includes(id) ? compareIds.filter((x) => x !== id) : [...compareIds, id];
    setParams({ compare: next.join(",") });
  };

  const columns = useMemo<ColumnDef<EvaluationOut>[]>(
    () => [
      {
        id: "cmp",
        header: () => <span className="sr-only">Compare</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <input
            type="checkbox"
            className="size-4 accent-[var(--c-cosmic)]"
            aria-label={`Add evaluation ${row.original.id} to the comparison`}
            checked={compareIds.includes(row.original.id)}
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggleCompare(row.original.id)}
          />
        ),
        meta: { width: 40 },
      },
      {
        id: "model",
        header: "Evaluation",
        accessorFn: (r) => r.model_name ?? "",
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="text-fg">
              <span className="num text-fg-secondary">#{row.original.id}</span> {row.original.model_name ?? `model ${row.original.model_version_id}`}
            </span>
            <span className="text-xs text-fg-secondary">
              {modelTypeLabel(row.original.model_type)} · {row.original.dataset_name ?? `dataset ${row.original.dataset_id}`}
              {row.original.is_fixture ? " · test fixture" : ""}
            </span>
          </span>
        ),
      },
      { id: "split", header: "Split", accessorFn: (r) => r.split, cell: ({ row }) => <SplitTag split={row.original.split} testNumber={row.original.test_evaluation_number} /> },
      { id: "n", header: "n", accessorFn: (r) => r.n ?? undefined, cell: ({ getValue }) => formatInt(getValue() as number | undefined), meta: { numeric: true, headerLabel: "Examples evaluated" } },
      { id: "pr", header: "PR-AUC", accessorFn: (r) => metricOf(r.summary, "pr_auc") ?? undefined, cell: ({ getValue }) => fmtMetric(getValue() as number | undefined), meta: { numeric: true } },
      { id: "roc", header: "ROC-AUC", accessorFn: (r) => metricOf(r.summary, "roc_auc") ?? undefined, cell: ({ getValue }) => fmtMetric(getValue() as number | undefined), meta: { numeric: true } },
      { id: "f1", header: "F1", accessorFn: (r) => metricOf(r.summary, "f1") ?? undefined, cell: ({ getValue }) => fmtMetric(getValue() as number | undefined), meta: { numeric: true } },
      { id: "created", header: "When", accessorFn: (r) => r.id, cell: ({ row }) => <span className="text-fg-secondary">{formatRelativeTime(apiDate(row.original.created_at))}</span>, meta: { align: "right" } },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compareIds.join(",")],
  );

  const noModels = !models.isLoading && list.length === 0;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Models · 02"
        title="Model Evaluation"
        description="Measure a trained model on held-out data: metrics with bootstrap confidence intervals, ROC / precision–recall curves, calibration and the errors it makes."
      />

      {models.isError ? <ApiErrorBanner error={models.error} onRetry={() => void models.refetch()} /> : null}
      {models.isLoading ? <Skeleton height={180} rounded="md" /> : null}
      {noModels ? (
        <EmptyState
          title="Train a model first"
          description="Evaluation scores a trained model on its dataset's validation or test split. Train one on the Model Training page (logistic regression takes seconds)."
          actions={
            <Link to="/training" className={buttonClasses({ variant: "primary" })}>
              <Cpu aria-hidden="true" /> Open Model Training
            </Link>
          }
        />
      ) : null}

      {list.length ? (
        <Section id="run" title="Run an evaluation">
          <RunEvaluation
            models={list}
            modelId={modelId}
            onModelChange={(id) => setParams({ model: id })}
            onOpenEvaluation={(id) => setParams({ eval: id }, { push: true })}
            latestTestEvaluationId={latestTest?.id ?? null}
          />
        </Section>
      ) : null}

      {list.length ? (
        <Section
          id="evaluations"
          title="Evaluations"
          description="Click a row to open it; tick two or more to compare them."
          actions={<Switch size="sm" checked={onlyModel} onChange={setOnlyModel} label="Only the selected model" />}
        >
          {evaluations.isError ? (
            <ApiErrorBanner error={evaluations.error} onRetry={() => void evaluations.refetch()} />
          ) : (
            <DataTable
              caption="Evaluations"
              data={shown}
              columns={columns}
              loading={evaluations.isLoading}
              getRowId={(r) => String(r.id)}
              selectedRowId={evalId !== null ? String(evalId) : null}
              onRowClick={(r) => setParams({ eval: r.id, model: r.model_version_id }, { push: true })}
              showDensityToggle={false}
              maxHeight={360}
              initialSorting={[{ id: "created", desc: true }]}
              emptyTitle="No evaluations yet"
              emptyDescription="Run one above: validation first while you iterate, test once when the model is final."
              toolbar={compareIds.length ? <Badge tone="cosmic">{compareIds.length} selected for comparison</Badge> : null}
            />
          )}
        </Section>
      ) : null}

      {compareIds.length >= 2 ? (
        <Section id="compare" title="Comparison">
          <CompareEvaluations ids={compareIds} onRemove={toggleCompare} onClear={() => setParams({ compare: null })} />
        </Section>
      ) : null}

      {evalId !== null ? (
        <Section id="result" title="Result">
          <EvaluationResults key={evalId} id={evalId} />
        </Section>
      ) : list.length && allEvals.length ? (
        <p className="text-sm text-fg-secondary">Open an evaluation above to see its curves, calibration and errors.</p>
      ) : null}
    </div>
  );
}
