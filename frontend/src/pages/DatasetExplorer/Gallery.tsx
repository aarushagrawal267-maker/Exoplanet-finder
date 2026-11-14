/**
 * Gallery of random planet-like vs false-positive-like examples (global view downsampled to 401
 * bins + local view), as thumbnails; selecting one opens its full views.
 */
import { Shuffle } from "lucide-react";
import { useState } from "react";
import { useDatasetGallery } from "@/api/endpoints/datasets";
import type { GalleryItem } from "@/api/schemasOps";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Button } from "@/components/ui/Button";
import { ClassBadge } from "@/components/ui/ClassBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";
import { formatDays, formatPpm } from "@/lib/format";
import { ViewThumb } from "../_ops/components";

function Thumb({ item, selected, onSelect }: { item: GalleryItem; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          "flex w-full flex-col gap-1.5 rounded-lg border border-hairline bg-space/50 p-2.5 text-left transition-colors hover:border-hairline-strong",
          selected && "border-cosmic/70 bg-cosmic/[0.06]",
        )}
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="num truncate text-xs text-fg">{item.kepler_name ?? item.signal_key}</span>
          <span className="num shrink-0 text-2xs text-fg-secondary">{item.split}</span>
        </span>
        <span className="grid grid-cols-[3fr_2fr] gap-2">
          <ViewThumb values={item.global} label={`Global view of ${item.signal_key}`} />
          <ViewThumb values={item.local} label={`Local view of ${item.signal_key}`} />
        </span>
        <span className="num text-2xs text-fg-secondary">
          P {formatDays(item.period_days)} · depth {formatPpm(item.depth_ppm)}
        </span>
      </button>
    </li>
  );
}

export function Gallery({ datasetId, selected, onSelect }: { datasetId: number; selected: number | null; onSelect: (signalId: number) => void }) {
  const [seed, setSeed] = useState(0);
  const gallery = useDatasetGallery(datasetId, 6, seed);
  const classes: Array<{ key: string; cls: "planet" | "false_positive" }> = [
    { key: "planet_like", cls: "planet" },
    { key: "false_positive_like", cls: "false_positive" },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-secondary">Random included examples per class. Left: whole orbit (global view); right: ±2 transit durations (local view).</p>
        <Button size="sm" variant="ghost" icon={<Shuffle />} onClick={() => setSeed((s) => s + 1)} loading={gallery.isFetching && !gallery.isLoading}>
          Another sample
        </Button>
      </div>
      {gallery.isError ? <ApiErrorBanner error={gallery.error} onRetry={() => void gallery.refetch()} /> : null}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {classes.map(({ key, cls }) => (
          <section key={key} aria-label={cls === "planet" ? "Planet-like examples" : "False-positive-like examples"}>
            <div className="mb-2">
              <ClassBadge cls={cls} />
            </div>
            {gallery.isLoading ? (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Array.from({ length: 6 }, (_, i) => (
                  <li key={i}>
                    <Skeleton height={104} rounded="md" />
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(gallery.data?.classes[key] ?? []).map((item) => (
                  <Thumb key={item.signal_id} item={item} selected={selected === item.signal_id} onSelect={() => onSelect(item.signal_id)} />
                ))}
                {gallery.data && !(gallery.data.classes[key] ?? []).length ? <li className="col-span-full text-sm text-fg-secondary">No included examples of this class.</li> : null}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
