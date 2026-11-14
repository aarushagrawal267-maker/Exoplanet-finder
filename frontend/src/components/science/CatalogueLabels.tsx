/**
 * NASA's own classification of a signal, shown wherever a signal appears: catalogue category,
 * DR24 Autovetter training label, KOI disposition, label conflicts and the star's light-curve
 * status. Every badge carries text (never colour alone) and a tooltip-style title explaining it.
 */
import { CircleSlash2, CloudDownload, Database, Orbit, TriangleAlert } from "lucide-react";
import type { CatalogLabels } from "@/api/schemas";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { ProvenanceChip } from "@/components/ui/ProvenanceChip";
import { cn } from "@/lib/cn";
import { AV_LABELS } from "./adapters";

export const CATEGORY_INFO: Record<string, { label: string; tone: BadgeTone; help: string }> = {
  confirmed: { label: "Confirmed", tone: "planet", help: "Confirmed planet in the NASA Exoplanet Archive" },
  candidate: { label: "Candidate", tone: "cosmic", help: "KOI planet candidate — not yet confirmed or rejected" },
  false_positive: { label: "False positive", tone: "fp", help: "Classified as a false positive by NASA vetting" },
  unknown: { label: "Unlabelled", tone: "uncertain", help: "TCE without a KOI disposition or usable Autovetter label" },
  retired: { label: "Retired", tone: "neutral", help: "Retired from the catalogue" },
};

export const CATEGORY_ORDER = ["confirmed", "candidate", "false_positive", "unknown"] as const;

export function categoryLabel(category: string): string {
  return CATEGORY_INFO[category]?.label ?? category.replace(/_/g, " ");
}

export function CategoryBadge({ category, className }: { category: string; className?: string }) {
  const info = CATEGORY_INFO[category];
  return (
    <Badge tone={info?.tone ?? "neutral"} dot className={className} title={info?.help}>
      {info?.label ?? category}
    </Badge>
  );
}

export function AvLabelBadge({ label }: { label: string | null | undefined }) {
  if (!label) return <span className="text-fg-secondary">—</span>;
  const info = AV_LABELS[label];
  const tone: BadgeTone = info?.cls === "planet" ? "planet" : info?.cls === "false_positive" ? "fp" : "neutral";
  return (
    <Badge tone={tone} mono title={info?.help ?? label} icon={info?.cls === "planet" ? <Orbit aria-hidden="true" /> : info?.cls === "false_positive" ? <CircleSlash2 aria-hidden="true" /> : undefined}>
      {label}
    </Badge>
  );
}

export function KoiBadge({ disposition }: { disposition: string | null | undefined }) {
  if (!disposition) return <span className="text-fg-secondary">—</span>;
  const d = disposition.toUpperCase();
  const tone: BadgeTone = d === "CONFIRMED" ? "planet" : d === "FALSE POSITIVE" ? "fp" : "cosmic";
  return (
    <Badge tone={tone} title="KOI disposition (cumulative table)">
      {d === "FALSE POSITIVE" ? "False positive" : d.charAt(0) + d.slice(1).toLowerCase()}
    </Badge>
  );
}

export function ConflictBadge({ conflict, compact = false }: { conflict: boolean | null | undefined; compact?: boolean }) {
  if (!conflict) return compact ? null : <span className="text-fg-secondary">—</span>;
  return (
    <Badge tone="warn" icon={<TriangleAlert aria-hidden="true" />} title="The DR24 Autovetter label and the KOI disposition disagree">
      {compact ? "Conflict" : "Label conflict"}
    </Badge>
  );
}

const LC_STATUS: Record<string, { label: string; tone: BadgeTone; help: string }> = {
  available: { label: "Cached", tone: "cosmic", help: "Light curve downloaded and cached locally" },
  none: { label: "Not downloaded", tone: "neutral", help: "Light curve not downloaded yet" },
  queued: { label: "Queued", tone: "warn", help: "Download queued" },
  downloading: { label: "Downloading", tone: "warn", help: "Download in progress" },
  no_data: { label: "No Kepler data", tone: "uncertain", help: "MAST has no long-cadence light curve for this star" },
  error: { label: "Download failed", tone: "danger", help: "The last download attempt failed" },
};

export function LcStatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  const s = LC_STATUS[status ?? "none"] ?? { label: status ?? "—", tone: "neutral" as BadgeTone, help: "" };
  return (
    <Badge
      tone={s.tone}
      className={className}
      title={s.help}
      icon={status === "available" ? <Database aria-hidden="true" /> : status === "none" || !status ? <CloudDownload aria-hidden="true" /> : undefined}
    >
      <span className="sr-only">Light curve: </span>
      {s.label}
    </Badge>
  );
}

/** NASA labels side by side (used next to model verdicts). */
export function CatalogueLabelsPanel({ labels, className }: { labels: CatalogLabels | null | undefined; className?: string }) {
  return (
    <section className={cn("card-surface p-5", className)} aria-label="NASA catalogue labels">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="eyebrow text-fg-secondary">NASA labels</span>
        <ProvenanceChip kind="catalogue" size="xs" source="NASA Exoplanet Archive (DR24 TCE + KOI cumulative)" />
      </div>
      {labels ? (
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-fg-secondary">Category</dt>
            <dd>{labels.category ? <CategoryBadge category={labels.category} /> : "—"}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-fg-secondary">KOI disposition</dt>
            <dd>
              <KoiBadge disposition={labels.koi_disposition} />
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-fg-secondary">DR24 Autovetter label</dt>
            <dd>
              <AvLabelBadge label={labels.av_training_set} />
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-fg-secondary">Names</dt>
            <dd className="num text-fg">{[labels.kepler_name, labels.kepoi_name, labels.signal_key].filter(Boolean).join(" · ") || "—"}</dd>
          </div>
          {labels.label_conflict ? (
            <div className="sm:col-span-2">
              <ConflictBadge conflict />
              <p className="mt-1 text-xs text-fg-secondary">The DR24 Autovetter label and the KOI disposition disagree; such signals are excluded from training by default.</p>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="text-sm text-fg-secondary">Not a catalogue signal (uploaded light curve): there is no NASA classification to compare with.</p>
      )}
    </section>
  );
}
