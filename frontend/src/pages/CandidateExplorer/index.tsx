/**
 * Candidate Explorer — catalogue signals ranked by model score: mean / max calibrated probability
 * across models, model agreement, uncertainty, data-quality grade and whether any model saw the star
 * during training. Batch scoring (`POST /api/predictions/batch`) runs as a background job with live
 * progress. Every ranking is a list of research leads, not discoveries.
 */
import { useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { FlaskConical, Play, Radar, Star, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { qk } from "@/api/endpoints/keys";
import { useModels } from "@/api/endpoints/models";
import { useCandidates, useStartBatch } from "@/api/endpoints/predictions";
import type { CandidateOut, CandidateQuery, CandidateSort, JobOut } from "@/api/schemas";
import { TransitIcon } from "@/components/brand/TransitIcon";
import { JobProgress } from "@/components/jobs/JobProgress";
import { asGrade } from "@/components/science/adapters";
import { CATEGORY_INFO, CATEGORY_ORDER, CategoryBadge, KoiBadge } from "@/components/science/CatalogueLabels";
import { GradeMark } from "@/components/science/GradeMark";
import { modelUsable, NoModelState } from "@/components/science/ModelPicker";
import { RESEARCH_LEAD_NOTE } from "@/components/science/VerdictPanel";
import { ApiErrorBanner, hasErrorCode } from "@/components/ui/ApiErrorBanner";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { ClassBadge } from "@/components/ui/ClassBadge";
import { DataTable } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { Field } from "@/components/ui/Field";
import { NumberInput } from "@/components/ui/NumberInput";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { ProvenanceChip } from "@/components/ui/ProvenanceChip";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { ToggleChips } from "@/components/ui/ToggleChips";
import { formatDays, formatInt, formatKepid, formatPpm, formatProbability, formatRelativeTime } from "@/lib/format";
import { useUrlState } from "@/lib/urlState";

const SORTS: Array<{ value: CandidateSort; label: string }> = [
  { value: "mean_probability", label: "Mean probability" },
  { value: "max_probability", label: "Max probability" },
  { value: "agreement", label: "Model agreement" },
  { value: "uncertainty", label: "Lowest uncertainty" },
];
const PAGE_SIZES = [25, 50, 100];

function name(c: Pick<CandidateOut, "kepler_name" | "kepoi_name" | "signal_key">) {
  return c.kepler_name ?? c.kepoi_name ?? c.signal_key;
}

function BatchPanel({ onDone }: { onDone: () => void }) {
  const models = useModels(true);
  const start = useStartBatch();
  const qc = useQueryClient();
  const [job, setJob] = useState<JobOut | null>(null);
  const [modelId, setModelId] = useState<string>("");
  const [cats, setCats] = useState<string[]>(["candidate"]);
  const [onlyDownloaded, setOnlyDownloaded] = useState(true);
  const [limit, setLimit] = useState<number | null>(200);
  const [skipExisting, setSkipExisting] = useState(true);
  const usable = (models.data ?? []).filter((m) => modelUsable(m).ok);
  if (models.isSuccess && usable.length === 0) return <NoModelState compact />;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Model" help="Default: the model chosen in Settings, else the active model.">
          <Select
            value={modelId}
            onChange={setModelId}
            options={[
              { value: "", label: "Default model" },
              ...usable.map((m) => ({ value: String(m.id), label: `${m.name}${m.is_fixture ? " (fixture)" : ""}${m.is_active ? " · active" : ""}` })),
            ]}
          />
        </Field>
        <Field label="At most (signals)" help="Signals to score in this run (empty = all).">
          <NumberInput value={limit} onChange={setLimit} min={1} step={50} precision={0} allowEmpty />
        </Field>
      </div>
      <div>
        <div className="mb-1.5 text-sm font-medium text-fg">Categories</div>
        <ToggleChips label="Categories to score" value={cats} onChange={setCats} options={CATEGORY_ORDER.map((c) => ({ value: c, label: CATEGORY_INFO[c]?.label ?? c }))} />
        <p className="mt-1 text-xs text-fg-secondary">{cats.length ? "Only these catalogue categories." : "All categories."}</p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-8">
        <Switch checked={onlyDownloaded} onChange={setOnlyDownloaded} label="Only stars already downloaded" description="Off: missing light curves are downloaded first (slow, many MB)." />
        <Switch checked={skipExisting} onChange={setSkipExisting} label="Skip signals already scored" description="By the same model." />
      </div>
      {job ? (
        <JobProgress
          jobId={job.id}
          initial={job}
          onDone={() => {
            void qc.invalidateQueries({ queryKey: qk.predictions.all });
            void qc.invalidateQueries({ queryKey: qk.system.summary });
            onDone();
          }}
          onDismiss={() => setJob(null)}
        />
      ) : (
        <div>
          <Button
            variant="model"
            icon={<Play />}
            loading={start.isPending}
            onClick={() =>
              start.mutate(
                {
                  model_version_id: modelId ? Number(modelId) : null,
                  category: cats.length ? cats.join(",") : "all",
                  only_downloaded: onlyDownloaded,
                  limit,
                  skip_existing: skipExisting,
                },
                { onSuccess: setJob },
              )
            }
          >
            Start batch scoring
          </Button>
        </div>
      )}
      {start.isError ? hasErrorCode(start.error, "no_model") ? <NoModelState compact /> : <ApiErrorBanner error={start.error} /> : null}
    </div>
  );
}

function useColumns(): ColumnDef<CandidateOut>[] {
  return useMemo<ColumnDef<CandidateOut>[]>(
    () => [
      { id: "rank", accessorKey: "rank", header: "#", meta: { numeric: true, width: 48 }, enableSorting: false },
      {
        id: "signal",
        header: "Signal",
        enableSorting: false,
        cell: (c) => (
          <span className="text-fg">
            {name(c.row.original)}
            <span className="num ml-2 text-xs text-fg-secondary">{c.row.original.signal_key}</span>
          </span>
        ),
      },
      { id: "kepid", accessorKey: "kepid", header: "KIC", meta: { mono: true }, enableSorting: false },
      { id: "period", header: "Period", meta: { numeric: true }, enableSorting: false, cell: (c) => formatDays(c.row.original.period_days) },
      { id: "depth", header: "Depth", meta: { numeric: true }, enableSorting: false, cell: (c) => formatPpm(c.row.original.depth_ppm) },
      {
        id: "mean",
        header: "Mean P",
        meta: { numeric: true, headerLabel: "Mean calibrated probability across models" },
        enableSorting: false,
        cell: (c) => <span className="text-fg">{formatProbability(c.row.original.mean_probability)}</span>,
      },
      { id: "max", header: "Max P", meta: { numeric: true, headerLabel: "Highest model probability" }, enableSorting: false, cell: (c) => formatProbability(c.row.original.max_probability) },
      {
        id: "agreement",
        header: "Agreement",
        enableSorting: false,
        cell: (c) => {
          const a = c.row.original.agreement;
          const cls = a.consensus === "planet-like" ? "planet" : a.consensus === "false-positive-like" ? "false_positive" : "uncertain";
          return (
            <span className="inline-flex items-center gap-2">
              <span className="num text-sm text-fg-secondary">
                {a.n_planet_like}/{a.n_models}
              </span>
              <ClassBadge cls={cls} />
            </span>
          );
        },
      },
      { id: "unc", header: () => <span className="normal-case">±σ</span>, meta: { numeric: true, headerLabel: "Mean uncertainty (standard deviation)" }, enableSorting: false, cell: (c) => formatProbability(c.row.original.uncertainty) },
      {
        id: "grade",
        header: "Grade",
        enableSorting: false,
        cell: (c) => {
          const g = asGrade(c.row.original.quality_grade);
          return g ? <GradeMark grade={g} size="sm" /> : <span className="text-fg-secondary">—</span>;
        },
      },
      {
        id: "flags",
        header: "Flags",
        enableSorting: false,
        cell: (c) => {
          const r = c.row.original;
          return (
            <span className="inline-flex items-center gap-1">
              {r.seen_in_training ? <Badge tone="warn" title="A model saw this star in its training or validation split: its score is optimistic">Seen in training</Badge> : null}
              {r.has_fixture_model_scores ? (
                <Badge tone="nebula" icon={<FlaskConical aria-hidden="true" />} title="Includes scores from a fixture (pipeline-test) model">
                  Fixture
                </Badge>
              ) : null}
              {r.label_conflict ? <Badge tone="warn" icon={<TriangleAlert aria-hidden="true" />}>Conflict</Badge> : null}
              {!r.seen_in_training && !r.has_fixture_model_scores && !r.label_conflict ? <span className="text-fg-secondary">—</span> : null}
            </span>
          );
        },
      },
      { id: "category", header: "Category", enableSorting: false, cell: (c) => <CategoryBadge category={c.row.original.category} /> },
    ],
    [],
  );
}

function CandidateDetail({ c }: { c: CandidateOut }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <CategoryBadge category={c.category} />
        {c.koi_disposition ? <KoiBadge disposition={c.koi_disposition} prefix /> : null}
        {c.seen_in_training ? <Badge tone="warn">Seen in training</Badge> : null}
        {c.has_fixture_model_scores ? <Badge tone="nebula">Fixture scores included</Badge> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to={`/targets/${c.kepid}?signal=${c.signal_id}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
          <Star aria-hidden="true" /> Target dossier
        </Link>
        <Link to={`/transit?kepid=${c.kepid}&signal=${c.signal_id}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
          <TransitIcon aria-hidden="true" /> Transit analysis
        </Link>
        <Link to={`/detect?kepid=${c.kepid}&signal=${c.signal_id}`} className={buttonClasses({ variant: "model", size: "sm" })}>
          <Radar aria-hidden="true" /> Score again
        </Link>
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Period", formatDays(c.period_days)],
          ["Depth", formatPpm(c.depth_ppm)],
          ["Mean P", formatProbability(c.mean_probability)],
          ["Range", `${formatProbability(c.min_probability)}–${formatProbability(c.max_probability)}`],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="eyebrow text-fg-secondary">{k}</dt>
            <dd className="num mt-1 text-md text-fg">{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="eyebrow text-fg-secondary">Scores by model</span>
          <ProvenanceChip kind="model" size="xs" />
        </div>
        <ul className="divide-y divide-hairline rounded-lg border border-hairline">
          {c.scores.map((s) => (
            <li key={s.prediction_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-sm text-fg">
                  {s.model_name}
                  {s.is_fixture_model ? <Badge tone="warn">Fixture</Badge> : null}
                  {s.seen_in_split ? <Badge tone={s.seen_in_split === "test" ? "neutral" : "warn"}>{s.seen_in_split} split</Badge> : null}
                </p>
                <p className="num text-xs text-fg-secondary">
                  {s.model_type ?? "model"} · {formatRelativeTime(s.created_at)} ·{" "}
                  <Link to={`/predictions?id=${s.prediction_id}`} className="font-sans text-cosmic hover:underline">
                    prediction #{s.prediction_id}
                  </Link>
                </p>
              </div>
              <span className="flex items-center gap-2">
                {s.uncertainty !== null && s.uncertainty !== undefined ? <span className="num text-xs text-fg-secondary">± {formatProbability(s.uncertainty)}</span> : null}
                <ClassBadge cls={s.predicted_label === 1 ? "planet" : "false_positive"} probability={s.probability} context="Model class at its threshold" />
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-fg-secondary">Each model&apos;s class is taken at its own decision threshold. {RESEARCH_LEAD_NOTE}.</p>
      </div>
    </div>
  );
}

export default function CandidateExplorerPage() {
  const u = useUrlState();
  const models = useModels(true);
  const sortParam = u.str("sort");
  const sort: CandidateSort = SORTS.some((s) => s.value === sortParam) ? (sortParam as CandidateSort) : "mean_probability";
  const limit = PAGE_SIZES.includes(u.int("limit") ?? 0) ? (u.int("limit") as number) : 50;
  const cats = u.str("cat") === null ? ["candidate"] : u.list("cat");
  const query: CandidateQuery = {
    category: cats.length ? cats.join(",") : "all",
    model_version_id: u.int("model"),
    min_probability: u.num("minp"),
    sort,
    limit,
    offset: Math.max(0, u.int("offset") ?? 0),
    include_seen: u.str("seen") === "1",
  };
  const cand = useCandidates(query);
  const columns = useColumns();
  const page = cand.data;
  const selectedId = u.int("signal");
  const selected = page?.items.find((c) => c.signal_id === selectedId) ?? null;
  const noModels = models.isSuccess && (models.data ?? []).length === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Detect · 02"
        title="Candidate Explorer"
        description="Catalogue signals ranked by your models' calibrated planet-like probability, with model agreement, uncertainty and data quality. Start from unconfirmed KOI candidates; every row is a lead to vet."
      />
      <Banner tone="info" title={RESEARCH_LEAD_NOTE}>
        {page?.disclaimer ?? "These rankings are research leads for follow-up, not discoveries."}
      </Banner>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader eyebrow="Batch scoring" title="Score many signals" description="Runs one model over catalogue signals with their catalogue ephemeris, as a background job." />
          <BatchPanel onDone={() => void cand.refetch()} />
        </Card>
        <Card>
          <CardHeader eyebrow="Ranking" title="Filter and rank" />
          <div className="flex flex-col gap-4">
            <div>
              <div className="mb-1.5 text-sm font-medium text-fg">Categories</div>
              <ToggleChips
                label="Catalogue categories"
                value={cats}
                onChange={(v) => u.set({ cat: v.length ? v.join(",") : "all", offset: null })}
                options={CATEGORY_ORDER.map((c) => ({ value: c, label: CATEGORY_INFO[c]?.label ?? c }))}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Rank by" className="sm:col-span-3 lg:col-span-1">
                <Select value={sort} onChange={(v) => u.set({ sort: v === "mean_probability" ? null : v, offset: null })} options={SORTS} />
              </Field>
              <Field label="Model">
                <Select
                  value={u.str("model") ?? ""}
                  onChange={(v) => u.set({ model: v, offset: null })}
                  options={[{ value: "", label: "All models" }, ...(models.data ?? []).map((m) => ({ value: String(m.id), label: `${m.name}${m.is_fixture ? " (fixture)" : ""}` }))]}
                />
              </Field>
              <Field label="Min. mean P">
                <NumberInput value={u.num("minp")} onChange={(v) => u.set({ minp: v, offset: null })} min={0} max={1} step={0.05} precision={2} allowEmpty hideSteppers placeholder="0.00" />
              </Field>
            </div>
            <ul className="flex flex-col gap-1.5 border-t border-hairline pt-4 text-xs text-fg-secondary">
              <li>Each signal uses every model&apos;s latest score on the catalogue ephemeris; the mean is across models.</li>
              <li>
                <span className="text-fg">Agreement</span> counts models whose class is planet-like at their own threshold.
              </li>
              <li>
                <span className="text-fg">Seen in training</span> marks stars a model trained or tuned on — their scores are optimistic.
              </li>
            </ul>
            <Switch
              checked={query.include_seen === true}
              onChange={(v) => u.set({ seen: v ? "1" : null, offset: null })}
              label="Include candidates seen in training"
              description="Off (recommended): hides signals whose star was in a model's training or validation split. In the default DR24 label mode, Autovetter PC signals that are still KOI candidates are training examples, so ranking them would be circular."
            />
          </div>
        </Card>
      </div>

      {cand.isError ? <ApiErrorBanner error={cand.error} onRetry={() => void cand.refetch()} /> : null}
      {noModels ? (
        <NoModelState />
      ) : (
        <>
          <DataTable
            caption="Ranked candidates"
            data={page?.items ?? []}
            columns={columns}
            getRowId={(r) => String(r.signal_id)}
            loading={cand.isPending}
            manualSorting
            maxHeight="min(62vh, 640px)"
            selectedRowId={selectedId !== null ? String(selectedId) : null}
            onRowClick={(r) => u.set({ signal: r.signal_id }, { replace: false })}
            toolbar={
              <span className="flex flex-wrap items-center gap-2">
                {page ? (
                  <span>
                    <span className="num text-fg">{formatInt(page.total)}</span> scored signals · ranked by {SORTS.find((s) => s.value === sort)?.label.toLowerCase()}
                    {!page.include_seen && page.n_hidden_seen > 0 ? (
                      <>
                        {" "}· <span className="num text-fg">{formatInt(page.n_hidden_seen)}</span> hidden (seen in training)
                      </>
                    ) : null}
                  </span>
                ) : null}
                <ProvenanceChip kind="model" size="xs" />
              </span>
            }
            emptyTitle="No scored signals match"
            emptyDescription={
              query.category !== "all" || query.min_probability || query.model_version_id
                ? "Nothing scored in these categories / for this model yet. Run a batch above, or widen the filters."
                : "No catalogue signal has been scored yet. Start a batch above (candidates first), or score single signals in Planet Detection."
            }
          />
          {page && page.total > 0 ? (
            <Pagination
              total={page.total}
              offset={page.offset}
              limit={page.limit}
              noun="signals"
              pageSizes={PAGE_SIZES}
              busy={cand.isFetching}
              onChange={(offset, l) => u.set({ offset: offset || null, limit: l === 50 ? null : l })}
            />
          ) : null}
        </>
      )}

      <Drawer
        open={selected !== null}
        onClose={() => u.set({ signal: null })}
        width={640}
        title={selected ? name(selected) : ""}
        description={selected ? <span className="num">{selected.signal_key} · {formatKepid(selected.kepid)}</span> : undefined}
      >
        {selected ? <CandidateDetail c={selected} /> : null}
      </Drawer>
    </div>
  );
}
