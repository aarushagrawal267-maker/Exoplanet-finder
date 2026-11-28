/**
 * Design System — every primitive, chart and science component rendered with clearly-labelled
 * synthetic DEMO data, for visual QA. Nothing on this page is a real observation or metric.
 */
import type { ColumnDef } from "@tanstack/react-table";
import { Download, FlaskConical, Play, Plus, Search, Settings2, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { OrbitArt } from "@/components/brand/OrbitArt";
import { TransitDiagram } from "@/components/brand/TransitDiagram";
import { TransitLoader } from "@/components/brand/TransitLoader";
import { TransitMark, Wordmark } from "@/components/brand/TransitMark";
import {
  CalibrationChart,
  ConfusionMatrix,
  LightCurvePlot,
  MetricBars,
  PeriodogramPlot,
  PhaseFoldPlot,
  RocPrChart,
  TrainingCurves,
  ViewPairPlot,
} from "@/components/charts";
import { JobTray } from "@/components/layout/JobTray";
import { ProvenanceTable, QualityReport, VerdictPanel } from "@/components/science";
import { GradeMark } from "@/components/science/GradeMark";
import {
  Badge,
  Banner,
  Button,
  Card,
  ChartSkeleton,
  ClassBadge,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Kbd,
  KeyValueList,
  Modal,
  NumberInput,
  PageHeader,
  ProgressBar,
  ProvenanceChip,
  Readout,
  Section,
  SegmentedControl,
  Select,
  Skeleton,
  SkeletonText,
  Slider,
  Stepper,
  Switch,
  Tabs,
  Tooltip,
} from "@/components/ui";
import { ApiError } from "@/api/client";
import {
  DEMO_EPHEMERIS,
  DEMO_LABEL,
  DEMO_QUALITY,
  demoFolded,
  demoJobs,
  demoLightCurve,
  demoModelEvals,
  demoPeriodogram,
  demoSignalRows,
  demoTrainingHistory,
  demoViews,
  type DemoSignalRow,
} from "@/demo/demoData";
import { cn } from "@/lib/cn";
import { formatDays, formatHours, formatPpm, formatProbability, formatNumber } from "@/lib/format";
import { colors } from "@/styles/tokens";
import { verdictClass } from "@/components/science/verdict";

const TOC = [
  ["foundations", "Foundations"],
  ["brand", "Motif"],
  ["actions", "Actions & labels"],
  ["readouts", "Readouts"],
  ["forms", "Forms"],
  ["table", "Data table"],
  ["feedback", "Feedback"],
  ["overlays", "Overlays"],
  ["charts", "Charts"],
  ["science", "Science"],
] as const;

function DemoTag() {
  return (
    <span className="eyebrow inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-sm border border-dashed border-warn/60 px-1.5 text-2xs text-warn" title={DEMO_LABEL}>
      Demo data
    </span>
  );
}

function Specimen({ label, children, className, demo = false }: { label: string; children: ReactNode; className?: string; demo?: boolean }) {
  return (
    <Card className={cn("flex flex-col gap-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <span className="eyebrow min-w-0 text-fg-secondary">{label}</span>
        {demo ? <DemoTag /> : null}
      </div>
      {children}
    </Card>
  );
}

const SWATCHES: Array<{ token: keyof typeof colors; role: string; ink?: boolean }> = [
  { token: "void", role: "App background" },
  { token: "space", role: "Sidebar, backdrop" },
  { token: "surface", role: "Cards" },
  { token: "surface-raised", role: "Popovers, menus" },
  { token: "hairline", role: "Borders, grid" },
  { token: "text-primary", role: "Primary text", ink: true },
  { token: "text-secondary", role: "Secondary text", ink: true },
  { token: "text-muted", role: "Placeholders, decoration", ink: true },
  { token: "cosmic", role: "Primary, focus, binned data" },
  { token: "nebula", role: "Model output figures" },
  { token: "signal-planet", role: "Class 1 · planet-like" },
  { token: "signal-fp", role: "Class 0 · false-positive-like" },
  { token: "signal-uncertain", role: "Uncertain verdicts" },
  { token: "warn", role: "Warnings" },
  { token: "danger", role: "Errors, destructive" },
];

const TYPE_SCALE = [
  { size: "text-2xl", px: 40, sample: "Kepler-like transit", font: "font-display" },
  { size: "text-xl", px: 28, sample: "Signal Explorer", font: "font-display" },
  { size: "text-lg", px: 20, sample: "Section heading", font: "font-sans font-medium" },
  { size: "text-md", px: 16, sample: "Card title and lead paragraph", font: "font-sans font-medium" },
  { size: "text-base", px: 14, sample: "Body text for the interface — readable at length.", font: "font-sans" },
  { size: "text-sm", px: 13, sample: "Secondary text, table cells and help copy.", font: "font-sans" },
  { size: "text-xs", px: 12, sample: "Captions, legends, metadata", font: "font-sans" },
] as const;

export default function DesignSystemPage() {
  const lc = useMemo(() => demoLightCurve(), []);
  const folded = useMemo(() => demoFolded(lc), [lc]);
  const views = useMemo(() => demoViews(), []);
  const pgram = useMemo(() => demoPeriodogram(), []);
  const evals = useMemo(() => demoModelEvals(), []);
  const training = useMemo(() => demoTrainingHistory(), []);
  const rows = useMemo(() => demoSignalRows(), []);
  const jobs = useMemo(() => demoJobs(), []);

  const [threshold, setThreshold] = useState(0.5);
  const [period, setPeriod] = useState<number | null>(DEMO_EPHEMERIS.period);
  const [detrend, setDetrend] = useState("spline");
  const [ensemble, setEnsemble] = useState(true);
  const [units, setUnits] = useState<"relative" | "ppm">("ppm");
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tab, setTab] = useState("views");

  const columns = useMemo<ColumnDef<DemoSignalRow>[]>(
    () => [
      { accessorKey: "id", header: "Signal", meta: { mono: true, width: 120 } },
      // Table columns use FIXED decimals so right-aligned decimal points line up row to row.
      { accessorKey: "period", header: "Period (d)", meta: { numeric: true }, cell: (c) => formatDays(c.getValue<number | undefined>(), { unit: false, digits: 4 }) },
      { accessorKey: "depth", header: "Depth (ppm)", meta: { numeric: true }, cell: (c) => formatPpm(c.getValue<number | undefined>(), { unit: false }) },
      { accessorKey: "duration", header: "T14 (h)", meta: { numeric: true, headerLabel: "Transit duration in hours" }, cell: (c) => formatHours(c.getValue<number | undefined>(), { unit: false }) },
      { accessorKey: "snr", header: "SNR", meta: { numeric: true }, cell: (c) => formatNumber(c.getValue<number | undefined>(), { digits: 1 }) },
      { accessorKey: "probability", header: "P(planet)", meta: { numeric: true, headerLabel: "Calibrated probability planet-like" }, cell: (c) => formatProbability(c.getValue<number | undefined>()) },
      {
        id: "class",
        header: "Verdict",
        enableSorting: false,
        cell: ({ row }) => <ClassBadge cls={verdictClass(row.original.probability, threshold, 0.06, row.original.grade)} />,
      },
      {
        accessorKey: "grade",
        header: "Quality",
        meta: { align: "center", width: 80 },
        cell: (c) => <GradeMark grade={c.getValue<DemoSignalRow["grade"]>()} size="sm" />,
      },
    ],
    [threshold],
  );

  const lead = evals[0];

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-4">
      <PageHeader
        className="pb-2"
        eyebrow="Reference · UI"
        title="Design System"
        description="Observatory Night: every primitive, chart and science component in one place for visual QA. Components are documented in their source files."
        meta={
          <>
            <Badge tone="nebula" mono>
              {Object.keys(colors).length} colour tokens
            </Badge>
            <Badge mono>7 type sizes + eyebrow</Badge>
          </>
        }
      />

      <Banner tone="warn" title={DEMO_LABEL}>
        Every number, curve and label on this page is synthetic, generated from a seeded random generator. None of it is a NASA observation, a
        catalogue value or a model result.
      </Banner>

      <nav aria-label="On this page" className="flex flex-wrap gap-1.5">
        {TOC.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded-full border border-hairline-strong px-3 py-1 text-xs text-fg-secondary transition-colors hover:border-fg-muted hover:text-fg">
            {label}
          </a>
        ))}
      </nav>
      </div>

      {/* ------------------------------------------------------------------ Foundations */}
      <Section id="foundations" eyebrow="01" title="Foundations" description="Dark-first colour tokens with reserved semantic roles; Inter Tight for UI, JetBrains Mono for every number, Instrument Serif (upright) for page titles and the hero.">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
          <Specimen label="Colour tokens">
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {SWATCHES.map((s) => (
                <li key={s.token} className="flex flex-col gap-1.5">
                  <span className="h-12 rounded-md border border-hairline-strong" style={{ background: colors[s.token] }} aria-hidden="true" />
                  <span className="text-xs text-fg">{s.token}</span>
                  <span className="num text-2xs text-fg-secondary">{colors[s.token]}</span>
                  <span className="text-2xs leading-4 text-fg-secondary">{s.role}</span>
                </li>
              ))}
            </ul>
          </Specimen>
          <Specimen label="Type scale">
            <ul className="flex flex-col gap-3">
              {TYPE_SCALE.map((t) => (
                <li key={t.size} className="flex items-baseline gap-4 border-b border-hairline pb-3 last:border-b-0 last:pb-0">
                  <span className="num w-10 shrink-0 text-xs text-fg-secondary">{t.px}</span>
                  <span className={cn(t.size, t.font, "min-w-0 truncate text-fg")}>{t.sample}</span>
                </li>
              ))}
              <li className="flex items-baseline gap-4">
                <span className="num w-10 shrink-0 text-xs text-fg-secondary">12</span>
                <span className="eyebrow text-fg-secondary">Eyebrow · sentence-case label</span>
              </li>
              <li className="flex items-baseline gap-4">
                <span className="num w-10 shrink-0 text-xs text-fg-secondary">mono</span>
                <span className="num text-md text-fg">0123456789 · 2.2047 d · −6,712 ppm</span>
              </li>
            </ul>
          </Specimen>
        </div>
      </Section>

      {/* ------------------------------------------------------------------ Brand */}
      <Section id="brand" eyebrow="02" title="The transit motif" description="A star, an occulting planet and the dip it causes. The dip always sits directly under the planet.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Specimen label="Mark & wordmark">
            <div className="flex items-end gap-5">
              <TransitMark size={64} title="Exoplanet Finder mark" />
              <TransitMark size={40} />
              <TransitMark size={24} />
            </div>
            <Wordmark />
          </Specimen>
          <Specimen label="Loader">
            <div className="flex flex-1 items-center justify-center gap-8">
              <TransitLoader size={64} label="Loading demo" showLabel />
              <TransitLoader size={32} />
            </div>
          </Specimen>
          <Specimen label="Empty-state art">
            <div className="atmosphere flex flex-1 items-center justify-center rounded-md py-4">
              <OrbitArt width={180} />
            </div>
          </Specimen>
          <Specimen label="Hero schematic">
            <TransitDiagram />
          </Specimen>
        </div>
      </Section>

      {/* ------------------------------------------------------------------ Actions */}
      <Section id="actions" eyebrow="03" title="Actions & labels">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Specimen label="Buttons">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" icon={<Play />}>
                Run analysis
              </Button>
              <Button variant="secondary" icon={<Download />}>
                Download
              </Button>
              <Button variant="outline">Outline</Button>
              <Button variant="model" icon={<FlaskConical />}>
                Score with model
              </Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger" icon={<Trash2 />}>
                Delete
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary">
                Small
              </Button>
              <Button size="md">Medium</Button>
              <Button size="lg" variant="primary" icon={<Plus />}>
                Large
              </Button>
              <Button loading variant="secondary">
                Training…
              </Button>
              <Button disabled>Disabled</Button>
              <Tooltip content="Settings">
                <Button iconOnly aria-label="Settings" icon={<Settings2 />} />
              </Tooltip>
            </div>
          </Specimen>
          <Specimen label="Badges, chips, keys">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>Neutral</Badge>
              <Badge tone="cosmic" dot>
                Running
              </Badge>
              <Badge tone="nebula">Model</Badge>
              <Badge tone="warn" dot>
                Label conflict
              </Badge>
              <Badge tone="danger" dot>
                Failed
              </Badge>
              <Badge mono>KIC 000000000</Badge>
              <span className="flex items-center gap-1">
                <Kbd>Ctrl</Kbd>
                <Kbd>K</Kbd>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ProvenanceChip kind="catalogue" source="KOI cumulative (demo)" />
              <ProvenanceChip kind="measured" />
              <ProvenanceChip kind="estimate" />
              <ProvenanceChip kind="model" />
              <ProvenanceChip kind="manual" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ClassBadge cls="planet" />
              <ClassBadge cls="false_positive" />
              <ClassBadge cls="uncertain" />
              <ClassBadge cls="planet" probability={0.912} size="md" />
            </div>
          </Specimen>
        </div>
      </Section>

      {/* ------------------------------------------------------------------ Readouts */}
      <Section id="readouts" eyebrow="04" title="Readouts">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Specimen label="Stat / Readout" demo>
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Readout label="Orbital period" value={formatDays(DEMO_EPHEMERIS.period, { unit: false })} unit="d" provenance="catalogue" />
              <Readout label="Transit depth" value={formatPpm(2386, { unit: false })} error="41" unit="ppm" provenance="measured" />
              <Readout label="Planet radius" value="2.31" unit="R⊕" provenance="estimate" caption="from depth × R★" />
              <Readout label="P(planet-like)" value={formatProbability(0.874)} tone="model" provenance="model" />
            </div>
            <div className="grid grid-cols-2 gap-6 border-t border-hairline pt-4 sm:grid-cols-3">
              <Readout size="lg" label="Signal-to-noise" value="38.6" />
              <Readout size="sm" label="Transits observed" value="14" unit="/ 19" />
              <Readout size="sm" label="Duration T14" value={formatHours(3.1, { unit: false })} unit="h" />
            </div>
          </Specimen>
          <Specimen label="Key–value list" demo>
            <KeyValueList
              items={[
                { key: "kic", label: "Target", value: "DEMO-0001" },
                { key: "teff", label: "Effective temperature", value: "5,780 K", provenance: "catalogue" },
                { key: "rstar", label: "Stellar radius", value: "0.98 R☉", provenance: "catalogue" },
                { key: "cad", label: "Cadence", value: "29.4 min" },
                { key: "pipe", label: "Pipeline", value: "v1.0", hint: "preprocessing version" },
              ]}
            />
          </Specimen>
        </div>
      </Section>

      {/* ------------------------------------------------------------------ Forms */}
      <Section id="forms" eyebrow="05" title="Forms">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Specimen label="Fields">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Target" help="KIC id, Kepler name or KOI.">
                <Input placeholder="e.g. Kepler-90 or 11442793" leading={<Search />} />
              </Field>
              <Field label="Period" aside="days" help="Must be positive." required>
                <NumberInput value={period} onChange={setPeriod} min={0.1} max={1000} step={0.0001} unit="d" />
              </Field>
              <Field label="Detrending" help="Spline masks transits out of the fit.">
                <Select
                  value={detrend}
                  onChange={setDetrend}
                  options={[
                    { value: "spline", label: "Robust spline (default)" },
                    { value: "savgol", label: "Savitzky–Golay" },
                  ]}
                />
              </Field>
              <Field label="Batch size" error="Must be a power of two between 8 and 512.">
                <Input defaultValue="100" mono />
              </Field>
            </div>
            <Field label="Decision threshold" help="Moves the cut between planet-like and false-positive-like in the table below.">
              <Slider value={threshold} onChange={setThreshold} min={0} max={1} step={0.01} aria-label="Decision threshold" formatValue={(v) => formatProbability(v, { digits: 2 })} />
            </Field>
          </Specimen>
          <Specimen label="Toggles & tabs">
            <Switch checked={ensemble} onChange={setEnsemble} label="Train an ensemble" description="Five members; their spread becomes the uncertainty." />
            <div className="flex flex-wrap items-center gap-3">
              <SegmentedControl
                aria-label="Flux units"
                value={units}
                onChange={setUnits}
                options={[
                  { value: "relative", label: "Relative" },
                  { value: "ppm", label: "ppm" },
                ]}
              />
              <SegmentedControl
                aria-label="Split"
                size="sm"
                value="test"
                onChange={() => undefined}
                options={[
                  { value: "train", label: "Train" },
                  { value: "val", label: "Val" },
                  { value: "test", label: "Test" },
                ]}
              />
            </div>
            <Tabs
              aria-label="Demo tabs"
              value={tab}
              onChange={setTab}
              items={[
                { id: "views", label: "Model views", content: <p className="text-sm text-fg-secondary">Tab panels hold page sections.</p> },
                { id: "diag", label: "Diagnostics", count: 4, content: <p className="text-sm text-fg-secondary">Odd/even, secondary eclipse, SNR…</p> },
                { id: "prov", label: "Provenance", content: <p className="text-sm text-fg-secondary">Catalogue vs measured.</p> },
                { id: "off", label: "Disabled", disabled: true },
              ]}
            />
          </Specimen>
        </div>
      </Section>

      {/* ------------------------------------------------------------------ Table */}
      <Section id="table" eyebrow="06" title="Data table" description="TanStack Table + Virtual: sticky header, sortable columns, mono right-aligned numbers, density toggle. Missing values sort last.">
        <DataTable
          caption="Demo signals"
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          initialSorting={[{ id: "probability", desc: true }]}
          maxHeight={420}
          toolbar={
            <>
              <DemoTag />
              <span>
                <span className="num text-fg">{rows.length}</span> synthetic signals · virtualised
              </span>
            </>
          }
        />
        <div className="mt-4">
          <DataTable caption="Empty demo table" data={[] as DemoSignalRow[]} columns={columns.slice(0, 4)} showDensityToggle={false} emptyTitle="No signals match these filters" emptyDescription="Widen the period range or clear the SNR cut." />
        </div>
      </Section>

      {/* ------------------------------------------------------------------ Feedback */}
      <Section id="feedback" eyebrow="07" title="Feedback">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Specimen label="Banners">
            <Banner tone="info" title="Catalogue snapshot loaded">
              Using the snapshot from the demo date; refresh to pull the latest archive tables.
            </Banner>
            <Banner tone="warn" title="Label conflict">
              Autovetter and KOI disposition disagree for this signal; it is excluded from training.
            </Banner>
            <Banner tone="danger" title="Download failed">
              MAST returned an error for 2 quarters.
            </Banner>
            <Banner tone="fixture-model" title="Fixture model">
              Scores come from a pipeline-test model and must not be interpreted.
            </Banner>
          </Specimen>
          <Specimen label="Progress & steps" demo>
            <ProgressBar value={0.62} label="Training two-view CNN" etaSeconds={512} detail="Epoch 31 / 50" tone="model" />
            <ProgressBar value={0.18} label="Downloading light curves" etaSeconds={3720} detail="54 / 300 targets" />
            <ProgressBar value={null} label="Waiting for the archive…" showPercent={false} />
            <Stepper
              aria-label="Demo workflow"
              steps={[
                { id: "a", label: "Catalogue", status: "complete" },
                { id: "b", label: "Download", status: "complete" },
                { id: "c", label: "Dataset", status: "current", description: "Building views" },
                { id: "d", label: "Train", status: "upcoming" },
                { id: "e", label: "Evaluate", status: "upcoming" },
              ]}
            />
          </Specimen>
          <Specimen label="Skeletons">
            <div className="flex items-center gap-3">
              <Skeleton width={40} height={40} rounded="md" />
              <SkeletonText lines={2} className="flex-1" />
            </div>
            <ChartSkeleton height={160} />
            <div className="flex flex-col gap-2.5" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton height={10} width="22%" />
                  <Skeleton height={10} width="14%" className="ml-auto" />
                  <Skeleton height={10} width="12%" />
                  <Skeleton height={18} width={72} rounded="full" />
                </div>
              ))}
            </div>
          </Specimen>
          <Specimen label="Empty & error states">
            <EmptyState
              size="sm"
              title="No trained models yet"
              description="Train a model to start scoring signals."
              actions={
                <Button variant="primary" size="sm">
                  Go to training
                </Button>
              }
            />
            <ErrorState error={new ApiError(0, "Cannot reach the Exoplanet Finder API.", { hint: "Start the backend with scripts/start.sh, then retry." })} onRetry={() => undefined} compact />
          </Specimen>
        </div>
      </Section>

      {/* ------------------------------------------------------------------ Overlays */}
      <Section id="overlays" eyebrow="08" title="Overlays">
        <Specimen label="Modal · drawer · tooltip · job tray" demo>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => setModalOpen(true)}>Open modal</Button>
            <Button onClick={() => setDrawerOpen(true)}>Open drawer</Button>
            <Tooltip content="Box Least Squares: searches trial periods for a box-shaped dip.">
              <Button variant="ghost">Hover for tooltip</Button>
            </Tooltip>
            <div className="flex items-center gap-2 rounded-md border border-dashed border-hairline-strong px-2 py-1">
              <span className="text-xs text-fg-secondary">Job tray:</span>
              <JobTray jobs={jobs} onCancel={() => undefined} connection="live" />
            </div>
          </div>
        </Specimen>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Delete dataset?"
          description="Two models depend on this dataset (demo)."
          footer={
            <>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => setModalOpen(false)}>
                Delete anyway
              </Button>
            </>
          }
        >
          <p className="text-sm text-fg-secondary">Deleting removes its arrays and views. Models trained on it keep their checkpoints but can no longer be re-evaluated.</p>
        </Modal>
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Signal details" description="DEMO-0001 (synthetic)">
          <KeyValueList
            items={[
              { key: "p", label: "Period", value: formatDays(DEMO_EPHEMERIS.period) },
              { key: "d", label: "Depth", value: formatPpm(DEMO_EPHEMERIS.depthPpm) },
              { key: "t", label: "Duration", value: formatHours(DEMO_EPHEMERIS.durationHours) },
            ]}
          />
        </Drawer>
      </Section>

      {/* ------------------------------------------------------------------ Charts */}
      <Section id="charts" eyebrow="09" title="Charts" description="Plotly (WebGL) for dense photometry; Recharts for model metrics. Shared dark template and a CVD-checked per-model palette with dash patterns.">
        <div className="flex flex-col gap-4">
          <Specimen label="Light curve · linked panels · transit windows · range slider" demo>
            <LightCurvePlot
              panels={[
                { id: "raw", label: "Raw flux + trend", time: lc.time, flux: lc.raw, binned: false, overlay: { time: lc.time, flux: lc.trend, label: "Trend" }, yTitle: "Flux" },
                { id: "flat", label: "Flattened", time: lc.time, flux: lc.flat, yTitle: "Relative flux" },
              ]}
              ephemeris={DEMO_EPHEMERIS}
              panelHeight={190}
            />
          </Specimen>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Specimen label="Phase fold · binned medians" demo>
              <PhaseFoldPlot phase={folded.phase} flux={folded.flux} durationHours={DEMO_EPHEMERIS.durationHours} units={units} height={300} />
            </Specimen>
            <Specimen label="Periodogram (BLS)" demo>
              <PeriodogramPlot periods={pgram.periods} power={pgram.power} height={300} />
            </Specimen>
          </div>
          <Specimen label="Model input views" demo>
            <ViewPairPlot global={views.global} local={views.local} height={250} />
          </Specimen>
          <Specimen label="ROC & precision–recall · multi-model overlay" demo>
            <RocPrChart models={evals} prevalence={0.3} height={260} />
          </Specimen>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Specimen label="Calibration (reliability diagram)" demo>
              <CalibrationChart series={evals.map((e) => ({ id: e.id, label: e.label, modelType: e.modelType, bins: e.bins, ece: e.ece }))} height={240} />
            </Specimen>
            <Specimen label="Confusion matrix" demo>
              {lead ? <ConfusionMatrix {...lead.confusion} threshold={0.5} /> : null}
            </Specimen>
          </div>
          <Specimen label="Training curves (live-append friendly)" demo>
            <TrainingCurves history={training.history} bestEpoch={training.best} maxEpochs={50} />
          </Specimen>
          <Specimen label="Metric comparison with 95% intervals" demo>
            <MetricBars
              models={evals.map((e) => ({ id: e.id, label: e.label, modelType: e.modelType }))}
              groups={[
                { metric: "PR-AUC", help: "area under precision–recall", values: evals.map((e) => ({ modelId: e.id, value: e.prAuc, ci: e.ci.prAuc })) },
                { metric: "ROC-AUC", help: "area under ROC", values: evals.map((e) => ({ modelId: e.id, value: e.rocAuc, ci: e.ci.rocAuc })) },
                { metric: "F1", help: "at threshold 0.5", values: evals.map((e) => ({ modelId: e.id, value: e.f1, ci: e.ci.f1 })) },
              ]}
            />
          </Specimen>
        </div>
      </Section>

      {/* ------------------------------------------------------------------ Science */}
      <Section id="science" eyebrow="10" title="Science components">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <DemoTag />
            <span className="text-xs text-fg-secondary">Verdicts below are synthetic.</span>
          </div>
          <VerdictPanel
            probability={0.874}
            threshold={threshold}
            uncertainty={0.05}
            memberProbabilities={[0.83, 0.86, 0.88, 0.9, 0.91]}
            qualityGrade="A"
            catalogue={{ disposition: "Candidate (demo)", cls: null, source: "Demo catalogue" }}
            modelName="two-view CNN · demo"
          />
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            <VerdictPanel
              probability={0.47}
              threshold={0.5}
              uncertainty={0.09}
              memberProbabilities={[0.38, 0.44, 0.49, 0.55, 0.52]}
              qualityGrade="C"
              catalogue={{ disposition: "False positive (demo)", cls: "false_positive", source: "Demo catalogue" }}
              modelName="global-view CNN · demo"
              isFixtureModel
            />
            <QualityReport report={DEMO_QUALITY} />
          </div>
          <ProvenanceTable
            caption="Demo provenance table"
            rows={[
              { quantity: "Orbital period", unit: "d", digits: 4, catalogue: { value: 3.5234, err: 0.0001 }, measured: { value: 3.5236, err: 0.0002 } },
              { quantity: "Transit depth", unit: "ppm", digits: 0, catalogue: { value: 2410, err: 38 }, measured: { value: 2386, err: 41 } },
              { quantity: "Duration T14", unit: "h", digits: 2, catalogue: { value: 3.05, err: 0.04 }, measured: { value: 3.42, err: 0.06 } },
              {
                quantity: "Planet radius",
                unit: "R⊕",
                digits: 2,
                catalogue: { value: 2.4, err: 0.3 },
                estimate: { value: 2.31, err: 0.2 },
                note: "Estimate = √depth × R★; assumes no flux dilution and a non-grazing transit.",
              },
            ]}
          />
        </div>
      </Section>
    </div>
  );
}
