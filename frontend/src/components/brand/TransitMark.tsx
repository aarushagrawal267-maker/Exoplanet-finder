/**
 * The brand motif: a transit. A limb-darkened stellar disc is crossed by a small occluding
 * planet, and the light curve drawn beneath dips exactly under the planet — the photometric
 * signature every page of this app is about.
 *
 * Geometry (viewBox 40×40): star centre (20, 15) r = 10; the planet sits off-centre on the disc at
 * x = PLANET_X and the dip's minimum is at the same x, so the alignment is exact at any size.
 */
import { cn } from "@/lib/cn";
import { useStableId } from "@/lib/hooks";

const PLANET_X = 25.5;

/** U-shaped (limb-darkened) transit dip centred on PLANET_X, used by the mark and the loader. */
export const DIP_PATH =
  `M3 32.5 H${PLANET_X - 6} C${PLANET_X - 4.6} 32.5 ${PLANET_X - 4.2} 35.6 ${PLANET_X - 2.4} 35.9 ` +
  `Q${PLANET_X} 36.3 ${PLANET_X + 2.4} 35.9 C${PLANET_X + 4.2} 35.6 ${PLANET_X + 4.6} 32.5 ${PLANET_X + 6} 32.5 H37`;

export interface TransitMarkProps {
  size?: number;
  className?: string;
  /** Accessible title; omit to mark the graphic decorative. */
  title?: string;
}

export function TransitMark({ size = 32, className, title }: TransitMarkProps) {
  const gid = useStableId("star");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        {/* Limb darkening: the stellar disc is brighter at the centre than at the edge. */}
        <radialGradient id={gid} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#EEF1FA" />
          <stop offset="62%" stopColor="#C3CCE8" />
          <stop offset="100%" stopColor="#7C88B4" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="15" r="10" fill={`url(#${gid})`} />
      {/* the planet's transit chord, kept inside the disc (half-chord √(10² − 3.2²) ≈ 9.47):
          extended past the limb it read as a ring, turning the star into a ringed planet */}
      <line x1="10.9" x2="29.1" y1="18.2" y2="18.2" stroke="var(--c-cosmic, #6E9BFF)" strokeOpacity="0.55" strokeWidth="0.9" strokeLinecap="round" />
      <circle cx={PLANET_X} cy="18.2" r="2.5" fill="var(--c-space, #0A0F1E)" />
      <path d={DIP_PATH} stroke="var(--c-cosmic, #6E9BFF)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface WordmarkProps {
  collapsed?: boolean;
  className?: string;
}

/** Mark + "Exoplanet Finder" wordmark used in the sidebar header. */
export function Wordmark({ collapsed = false, className }: WordmarkProps) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <TransitMark size={32} title={collapsed ? "Exoplanet Finder" : undefined} />
      {!collapsed && (
        <span className="flex min-w-0 flex-col leading-none">
          <span className="font-display truncate text-[21px] leading-6 text-fg">Exoplanet Finder</span>
          <span className="mt-1 whitespace-nowrap font-mono text-[10px] font-medium uppercase leading-3 tracking-[0.1em] text-fg-secondary">Kepler signal lab</span>
        </span>
      )}
    </span>
  );
}
