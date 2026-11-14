/**
 * Overview — hero introduction, live system status and the end-to-end research workflow.
 * Catalogue / dataset / model counts are added when the summary API is wired; until then the
 * page shows only real status (API health) and guidance, never placeholder numbers.
 */
import { ArrowRight, BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { TransitDiagram } from "@/components/brand/TransitDiagram";
import { StatusFooter } from "@/components/layout/StatusFooter";
import { useSystemStatus } from "@/components/layout/useSystemStatus";
import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ClassBadge } from "@/components/ui/ClassBadge";
import { ProvenanceChip } from "@/components/ui/ProvenanceChip";
import { Section } from "@/components/ui/Section";

const WORKFLOW = [
  {
    n: "01",
    title: "Refresh the catalogue",
    body: "Snapshot the DR24 TCE, KOI and confirmed-planet tables from the NASA Exoplanet Archive, with exact queries and checksums.",
    path: "/datasets",
    cta: "Dataset Explorer",
  },
  {
    n: "02",
    title: "Download light curves",
    body: "Fetch Kepler long-cadence PDCSAP photometry from MAST, quarter by quarter, and cache it locally.",
    path: "/signals",
    cta: "Signal Explorer",
  },
  {
    n: "03",
    title: "Build a dataset",
    body: "Clean, detrend and fold each signal into global and local views; split by star so no target leaks between sets.",
    path: "/datasets",
    cta: "Dataset Explorer",
  },
  {
    n: "04",
    title: "Train your models",
    body: "Train logistic regression, a random forest and AstroNet-style CNNs from scratch on your own machine.",
    path: "/training",
    cta: "Model Training",
  },
  {
    n: "05",
    title: "Evaluate honestly",
    body: "Measure PR-AUC, ROC-AUC and calibration on a held-out test split, with bootstrap confidence intervals.",
    path: "/evaluation",
    cta: "Model Evaluation",
  },
  {
    n: "06",
    title: "Score candidates",
    body: "Rank unconfirmed signals as research leads, with uncertainty, data-quality grades and catalogue context.",
    path: "/candidates",
    cta: "Candidate Explorer",
  },
] as const;

export default function OverviewPage() {
  const status = useSystemStatus();
  return (
    <div className="flex flex-col gap-10">
      {/* Hero */}
      <section className="card-surface atmosphere overflow-hidden px-6 py-8 md:px-10 md:py-12" aria-labelledby="hero-title">
        {/* Two columns only from xl: with the 248 px sidebar, a 1024 px window leaves too little
            width for the schematic's labels to stay legible beside the copy. */}
        <div className="grid grid-cols-1 items-center gap-8 xl:grid-cols-[1.15fr_1fr] xl:gap-12">
          <div className="min-w-0">
            <div className="eyebrow mb-4 flex items-center gap-2 text-fg-secondary">
              <span className="h-px w-5 bg-gradient-to-r from-nebula to-cosmic" aria-hidden="true" />
              Kepler transit-signal laboratory
            </div>
            <h1 id="hero-title" className="font-display text-xl text-fg md:text-2xl">
              Find transit-like signals worth a second look.
            </h1>
            <p className="mt-4 max-w-prose text-base text-fg-secondary md:text-md">
              Exoplanet Finder trains your own classifiers on NASA Kepler light curves and scores threshold-crossing events as{" "}
              <span className="text-signal-planet">planet-like</span> or <span className="text-signal-fp">false-positive-like</span>. Every
              score is a research lead to vet — not a confirmed discovery.
            </p>
            <div className="mt-7 flex flex-wrap gap-2">
              <Link to="/signals" className={buttonClasses({ variant: "primary", size: "lg" })}>
                Explore signals
                <ArrowRight aria-hidden="true" />
              </Link>
              <Link to="/training" className={buttonClasses({ variant: "secondary", size: "lg" })}>
                Train a model
              </Link>
              <Link to="/docs" className={buttonClasses({ variant: "ghost", size: "lg" })}>
                <BookOpen aria-hidden="true" />
                Methodology
              </Link>
            </div>
          </div>
          <div className="mx-auto w-full max-w-[420px] xl:max-w-[440px]">
            <TransitDiagram />
          </div>
        </div>
      </section>

      {/* Workflow, with system status and a reading guide alongside (below on narrower screens) */}
      <Section eyebrow="Workflow" title="From catalogue to candidate" description="Six steps, each on its own page. Everything runs locally against public NASA data.">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-6">
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {WORKFLOW.map((s) => (
              <li key={s.n}>
                <Link to={s.path} className="card-surface group flex h-full flex-col p-5 transition-colors duration-fast hover:border-hairline-strong">
                  <span className="num text-sm text-cosmic">{s.n}</span>
                  <span className="mt-2 text-md font-semibold text-fg">{s.title}</span>
                  <span className="mt-1.5 flex-1 text-sm text-fg-secondary">{s.body}</span>
                  <span className="mt-4 flex items-center gap-1.5 text-sm text-fg-secondary transition-colors group-hover:text-fg">
                    {s.cta}
                    <ArrowRight className="size-3.5 transition-transform duration-fast group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ol>

          <aside aria-label="System status and reading guide" className="grid grid-cols-1 content-start gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <Card>
              <div className="eyebrow mb-3 text-fg-secondary">System</div>
              <StatusFooter rows={status} />
            </Card>
            <Card>
              <div className="eyebrow mb-3 text-fg-secondary">Reading results</div>
              <ul className="flex flex-col gap-3 text-sm text-fg-secondary">
                <li className="flex flex-col gap-1.5">
                  <span className="flex flex-wrap gap-1.5">
                    <ProvenanceChip kind="catalogue" />
                    <ProvenanceChip kind="measured" />
                    <ProvenanceChip kind="estimate" />
                    <ProvenanceChip kind="model" />
                  </span>
                  Every number says where it came from.
                </li>
                <li className="flex flex-col gap-1.5">
                  <span className="flex flex-wrap gap-1.5">
                    <ClassBadge cls="planet" />
                    <ClassBadge cls="false_positive" />
                    <ClassBadge cls="uncertain" />
                  </span>
                  Scores are calibrated probabilities with uncertainty; borderline or low-quality inputs read as uncertain.
                </li>
              </ul>
            </Card>
          </aside>
        </div>
      </Section>
    </div>
  );
}
