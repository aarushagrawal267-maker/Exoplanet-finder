/**
 * Research Docs — the project's methodology, data sources, models, evaluation protocol and known
 * limitations, rendered in-app from `/api/docs/pages/{slug}` (markdown with tables and formulas).
 * `/docs` lists the pages; `/docs/:slug` reads one, with page navigation and a table of contents.
 */
import { ArrowLeft, ArrowRight, BookOpen, FileText } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "@/api/client";
import { useDocPage, useDocPages } from "@/api/endpoints/docs";
import type { DocPageSummary } from "@/api/schemas";
import { Markdown, markdownHeadings } from "@/components/science/Markdown";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelativeTime } from "@/lib/format";

/** Reading order and one-line summaries for the known pages (others follow alphabetically). */
const ORDER = ["methodology", "data-sources", "pipeline", "models", "evaluation", "prediction", "limitations", "research-report-template"];
const BLURB: Record<string, string> = {
  methodology: "The transit method, why vetting is hard, and the research protocol this app follows.",
  "data-sources": "NASA Exoplanet Archive tables, MAST light curves, labels and their provenance.",
  pipeline: "Cleaning, detrending, folding and binning a light curve into model views.",
  models: "Logistic regression, random forest and the AstroNet-style CNNs.",
  evaluation: "Star-level splits, metrics, calibration and confidence intervals.",
  prediction: "How to read a score: probability, uncertainty, threshold and quality grade.",
  limitations: "What this app cannot tell you, and why a score is not a discovery.",
  "research-report-template": "A template for writing up a candidate you investigated.",
};

function sortPages(pages: DocPageSummary[]): DocPageSummary[] {
  const rank = (s: string) => (ORDER.includes(s) ? ORDER.indexOf(s) : ORDER.length);
  return [...pages].sort((a, b) => rank(a.slug) - rank(b.slug) || a.title.localeCompare(b.title));
}

const readingMinutes = (bytes: number) => Math.max(1, Math.round(bytes / 6 / 220));

function DocIndex({ pages }: { pages: DocPageSummary[] }) {
  return (
    <ol className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {pages.map((p, i) => (
        <li key={p.slug}>
          <Link to={`/docs/${p.slug}`} className="card-surface group flex h-full flex-col p-5 transition-colors duration-fast hover:border-hairline-strong">
            <span className="flex items-center justify-between gap-3">
              <span className="num text-sm text-cosmic">{String(i + 1).padStart(2, "0")}</span>
              <span className="num text-xs text-fg-secondary">
                {readingMinutes(p.size_bytes)} min read · updated {formatRelativeTime(p.updated_at)}
              </span>
            </span>
            <span className="mt-2 text-md font-semibold text-fg">{p.title}</span>
            <span className="mt-1 flex-1 text-sm text-fg-secondary">{BLURB[p.slug] ?? "Project documentation."}</span>
            <span className="mt-3 flex items-center gap-1.5 text-sm text-fg-secondary group-hover:text-fg">
              Read <ArrowRight className="size-3.5 transition-transform duration-fast group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function DocReader({ slug, pages }: { slug: string; pages: DocPageSummary[] }) {
  const doc = useDocPage(slug);
  const navigate = useNavigate();
  const idx = pages.findIndex((p) => p.slug === slug);
  const prev = idx > 0 ? pages[idx - 1] : null;
  const next = idx >= 0 && idx < pages.length - 1 ? pages[idx + 1] : null;
  const summary = pages[idx];
  const toc = doc.data ? markdownHeadings(doc.data.markdown) : [];
  const notFound = doc.error instanceof ApiError && doc.error.status === 404;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={
          <Link to="/docs" className="inline-flex items-center gap-1 hover:text-fg">
            <ArrowLeft className="size-3" aria-hidden="true" /> Research Docs
          </Link>
        }
        title={doc.data?.title ?? summary?.title ?? "Research Docs"}
        description={BLURB[slug]}
        meta={summary ? <span className="num text-xs text-fg-secondary">{readingMinutes(summary.size_bytes)} min read · updated {formatDateTime(summary.updated_at)}</span> : null}
      />
      <div className="lg:hidden">
        <Select aria-label="Documentation page" value={slug} onChange={(v) => navigate(`/docs/${v}`)} options={pages.map((p) => ({ value: p.slug, label: p.title }))} />
      </div>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[210px_minmax(0,1fr)] xl:grid-cols-[210px_minmax(0,1fr)_200px]">
        <nav aria-label="Documentation pages" className="hidden lg:block">
          <ul className="sticky top-20 flex flex-col gap-0.5">
            {pages.map((p) => (
              <li key={p.slug}>
                <Link
                  to={`/docs/${p.slug}`}
                  aria-current={p.slug === slug ? "page" : undefined}
                  className={cn(
                    "flex items-start gap-2 rounded-md px-2.5 py-1.5 text-sm leading-snug transition-colors",
                    p.slug === slug ? "bg-cosmic/10 text-fg shadow-[inset_2px_0_0_var(--c-cosmic)]" : "text-fg-secondary hover:bg-fg/[0.04] hover:text-fg",
                  )}
                >
                  <FileText className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>{p.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <article className="min-w-0">
          {doc.isPending ? (
            <div className="flex flex-col gap-4" aria-hidden="true">
              <Skeleton height={20} width="50%" />
              <SkeletonText lines={6} />
              <SkeletonText lines={4} />
            </div>
          ) : notFound ? (
            <EmptyState
              title="No such page"
              description={`There is no documentation page called “${slug}”.`}
              actions={
                <Link to="/docs" className={buttonClasses({ variant: "primary", size: "sm" })}>
                  All pages
                </Link>
              }
            />
          ) : doc.isError ? (
            <ApiErrorBanner error={doc.error} onRetry={() => void doc.refetch()} />
          ) : doc.data ? (
            <Markdown source={doc.data.markdown} stripTitle />
          ) : null}
          {doc.data ? (
            <nav aria-label="Previous and next page" className="mt-12 grid grid-cols-1 gap-3 border-t border-hairline pt-6 sm:grid-cols-2">
              {prev ? (
                <Link to={`/docs/${prev.slug}`} aria-label={`Previous: ${prev.title}`} className="card-surface flex flex-col p-4 hover:border-hairline-strong">
                  <span className="eyebrow text-fg-secondary">Previous</span>
                  <span className="mt-1 text-sm text-fg">← {prev.title}</span>
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link to={`/docs/${next.slug}`} aria-label={`Next: ${next.title}`} className="card-surface flex flex-col p-4 text-right hover:border-hairline-strong">
                  <span className="eyebrow text-fg-secondary">Next</span>
                  <span className="mt-1 text-sm text-fg">{next.title} →</span>
                </Link>
              ) : null}
            </nav>
          ) : null}
        </article>
        {toc.length ? (
          <nav aria-label="On this page" className="hidden xl:block">
            <div className="sticky top-20">
              <div className="eyebrow mb-2 text-fg-secondary">On this page</div>
              <ul className="flex flex-col gap-1 border-l border-hairline">
                {toc.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`} className={cn("-ml-px block border-l border-transparent py-0.5 text-sm text-fg-secondary hover:border-fg-secondary hover:text-fg", h.level === 3 ? "pl-6" : "pl-3")}>
                      {h.text}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        ) : null}
      </div>
    </div>
  );
}

export default function ResearchDocsPage() {
  const { slug } = useParams();
  const pages = useDocPages();
  const sorted = pages.data ? sortPages(pages.data) : [];

  if (slug) {
    if (pages.isError) return <ApiErrorBanner error={pages.error} onRetry={() => void pages.refetch()} />;
    return <DocReader slug={slug} pages={sorted} />;
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Reference · 01"
        title="Research Docs"
        description="How Exoplanet Finder works and how to read its results: methodology, NASA data sources, the processing pipeline, models, evaluation and known limitations."
        actions={
          sorted[0] ? (
            <Link to={`/docs/${sorted[0].slug}`} className={buttonClasses({ variant: "primary" })}>
              <BookOpen aria-hidden="true" /> Start reading
            </Link>
          ) : null
        }
      />
      {pages.isPending ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} height={128} rounded="md" />
          ))}
        </div>
      ) : pages.isError ? (
        <ApiErrorBanner error={pages.error} onRetry={() => void pages.refetch()} />
      ) : sorted.length === 0 ? (
        <EmptyState title="No documentation pages found" description="The backend serves the markdown files in the repository's docs/ folder; it found none." />
      ) : (
        <DocIndex pages={sorted} />
      )}
    </div>
  );
}
