/**
 * Progress affordance for synchronous requests that take several seconds (BLS on a 4-year Kepler
 * light curve, injection–recovery, an on-demand download + scoring): an indeterminate bar, what is
 * happening, how long it usually takes, and the elapsed time.
 */
import { useEffect, useState } from "react";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";

export function ElapsedProgress({ label, hint, className }: { label: string; hint?: string; className?: string }) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-lg border border-hairline bg-space/60 p-4", className)} aria-live="polite">
      <ProgressBar value={null} label={label} tone="model" detail={hint} showPercent={false} />
      <p className="num text-xs text-fg-secondary">{formatDuration((now - start) / 1000)} elapsed</p>
    </div>
  );
}
