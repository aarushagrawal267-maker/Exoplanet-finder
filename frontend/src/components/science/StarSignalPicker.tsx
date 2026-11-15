/**
 * Choose a catalogue star and one of its signals (TCE / KOI / confirmed planet). Used by Transit
 * Analysis and Planet Detection; the selection lives in the page URL (`?kepid=&signal=`).
 */
import { ArrowLeftRight, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { useTarget } from "@/api/endpoints/targets";
import type { SignalOut } from "@/api/schemas";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";
import { formatDays, formatHours, formatKepid, formatPpm } from "@/lib/format";
import { AvLabelBadge, CategoryBadge, ConflictBadge, KoiBadge, LcStatusBadge } from "./CatalogueLabels";
import { TargetSearchBox } from "./TargetSearchBox";

export function signalName(s: Pick<SignalOut, "kepler_name" | "kepoi_name" | "signal_key">): string {
  return s.kepler_name ?? s.kepoi_name ?? s.signal_key;
}

export interface StarSignalPickerProps {
  kepid: number | null;
  signalId: number | null;
  onChange: (kepid: number | null, signalId: number | null) => void;
  /** Offer "no catalogue signal" (e.g. to search the star with BLS). */
  allowNoSignal?: boolean;
  noSignalLabel?: string;
  className?: string;
}

export function StarSignalPicker({
  kepid,
  signalId,
  onChange,
  allowNoSignal = false,
  noSignalLabel = "No catalogue signal — find one with BLS or enter an ephemeris",
  className,
}: StarSignalPickerProps) {
  const target = useTarget(kepid);

  if (kepid === null) {
    return (
      <div className={className}>
        <TargetSearchBox onSelect={(r) => onChange(r.kepid, r.matched_signal_id ?? null)} />
        <p className="mt-2 text-xs text-fg-secondary">
          Try <span className="num text-fg">Kepler-90</span>, <span className="num text-fg">KIC 10666592</span> or a KOI such as{" "}
          <span className="num text-fg">K00351.01</span>.
        </p>
      </div>
    );
  }

  const t = target.data;
  const signals = t?.signals ?? [];
  const name = `signal-${kepid}`;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hairline-strong bg-space/60 px-4 py-3">
        <div className="min-w-0">
          <div className="eyebrow text-fg-secondary">Star</div>
          {t ? (
            <p className="flex flex-wrap items-center gap-2 text-md font-medium text-fg">
              <Link to={`/targets/${kepid}`} className="hover:underline">
                {t.target.label}
              </Link>
              <LcStatusBadge status={t.target.lc_status} />
            </p>
          ) : (
            <p className="num text-md text-fg">{formatKepid(kepid)}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Link to={`/targets/${kepid}`} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-fg-secondary hover:bg-fg/[0.06] hover:text-fg">
            Dossier <ExternalLink className="size-3.5" aria-hidden="true" />
          </Link>
          <Button size="sm" variant="secondary" icon={<ArrowLeftRight />} onClick={() => onChange(null, null)}>
            Change star
          </Button>
        </div>
      </div>

      {target.isPending ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          <Skeleton height={44} rounded="md" />
          <Skeleton height={44} rounded="md" />
        </div>
      ) : target.isError ? (
        <ApiErrorBanner error={target.error} onRetry={() => void target.refetch()} />
      ) : (
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-fg">Signal on this star</legend>
          <div className="flex flex-col gap-1.5">
            {signals.map((s) => (
              <label
                key={s.id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                  signalId === s.id ? "border-cosmic/60 bg-cosmic/[0.07]" : "border-hairline hover:border-hairline-strong",
                )}
              >
                <input type="radio" name={name} className="mt-1 accent-[var(--c-cosmic)]" checked={signalId === s.id} onChange={() => onChange(kepid, s.id)} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-fg">{signalName(s)}</span>
                    <span className="num text-xs text-fg-secondary">{s.signal_key}</span>
                  </span>
                  <span className="num mt-0.5 flex flex-wrap gap-x-3 text-xs text-fg-secondary">
                    <span>P {formatDays(s.period_days)}</span>
                    <span>T₁₄ {formatHours(s.duration_hours)}</span>
                    <span>depth {formatPpm(s.depth_ppm)}</span>
                  </span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <CategoryBadge category={s.category} />
                    {s.koi_disposition ? <KoiBadge disposition={s.koi_disposition} prefix /> : null}
                    {s.av_training_set ? <AvLabelBadge label={s.av_training_set} prefix /> : null}
                    <ConflictBadge conflict={s.label_conflict} compact />
                  </span>
                </span>
              </label>
            ))}
            {allowNoSignal ? (
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 text-sm transition-colors",
                  signalId === null ? "border-cosmic/60 bg-cosmic/[0.07] text-fg" : "border-hairline-strong text-fg-secondary hover:text-fg",
                )}
              >
                <input type="radio" name={name} className="accent-[var(--c-cosmic)]" checked={signalId === null} onChange={() => onChange(kepid, null)} />
                {noSignalLabel}
              </label>
            ) : null}
            {signals.length === 0 && !allowNoSignal ? <p className="text-sm text-fg-secondary">This star has no catalogue signals.</p> : null}
          </div>
        </fieldset>
      )}
    </div>
  );
}
