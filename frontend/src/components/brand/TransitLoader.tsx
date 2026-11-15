/**
 * Loading indicator built from the transit motif: a planet drifts across the stellar disc while a
 * scan cursor sweeps the light curve in lock-step, so the cursor sits in the dip exactly when the
 * planet is centred. Under prefers-reduced-motion the animation is suppressed globally and the
 * static mark remains.
 */
import { cn } from "@/lib/cn";
import { useStableId } from "@/lib/hooks";

export interface TransitLoaderProps {
  size?: number;
  label?: string;
  className?: string;
  /** Show the label text under the graphic (it is always available to screen readers). */
  showLabel?: boolean;
}

const DIP = "M2 33 H18 C19.4 33 19.8 36.1 21.6 36.4 Q24 36.8 26.4 36.4 C28.2 36.1 28.6 33 30 33 H46";

export function TransitLoader({ size = 48, label = "Loading", className, showLabel = false }: TransitLoaderProps) {
  const gid = useStableId("loader-star");
  const clip = useStableId("loader-clip");
  return (
    <div role="status" aria-live="polite" className={cn("inline-flex flex-col items-center gap-2", className)}>
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <defs>
          <radialGradient id={gid} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#F4F6FC" />
            <stop offset="70%" stopColor="#D5DCEE" />
            <stop offset="100%" stopColor="#8F9BBE" />
          </radialGradient>
          <clipPath id={clip}>
            <circle cx="24" cy="16" r="11" />
          </clipPath>
        </defs>
        <circle cx="24" cy="16" r="11" fill={`url(#${gid})`} opacity="0.95" />
        <g clipPath={`url(#${clip})`}>
          <circle className="exo-loader-orbit" cx="24" cy="20.5" r="2.8" fill="var(--c-space, #0A0F1E)" />
        </g>
        <path d={DIP} stroke="var(--c-cosmic, #6E9BFF)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <line className="exo-loader-orbit" x1="24" x2="24" y1="28.5" y2="31" stroke="var(--c-nebula, #A08BFF)" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <span className={showLabel ? "eyebrow text-fg-secondary" : "sr-only"}>{label}</span>
      <style>{`
        .exo-loader-orbit { animation: exo-transit 1.8s cubic-bezier(0.45, 0, 0.55, 1) infinite alternate; }
        @keyframes exo-transit { from { transform: translateX(-15px); } to { transform: translateX(15px); } }
      `}</style>
    </div>
  );
}
