/**
 * Line-art illustration for empty states: an inclined orbit seen nearly edge-on (as transiting
 * systems must be), the host star at the centre, a planet on the near side of the orbit, and a
 * faint light curve with the matching dip. Pure hairline strokes — no fills that compete with
 * content.
 */
import { cn } from "@/lib/cn";

export interface OrbitArtProps {
  className?: string;
  width?: number;
}

export function OrbitArt({ className, width = 168 }: OrbitArtProps) {
  return (
    <svg
      width={width}
      height={(width * 112) / 168}
      viewBox="0 0 168 112"
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      {/* orbit, nearly edge-on (transiting systems must be); the far arc passes behind the star */}
      <ellipse cx="84" cy="46" rx="74" ry="9" stroke="var(--c-hairline-strong)" strokeWidth="1" />
      <circle cx="84" cy="46" r="16" fill="var(--c-space)" stroke="var(--c-text-muted)" strokeWidth="1" />
      <circle cx="84" cy="46" r="10.5" stroke="var(--c-hairline-strong)" strokeWidth="1" strokeDasharray="1.5 3" />
      {/* near arc of the orbit, drawn in front of the star */}
      <path d="M10 46 A74 9 0 0 0 158 46" stroke="var(--c-hairline-strong)" strokeWidth="1" />
      {/* planet on the near arc, in front of the stellar disc: a transit */}
      <circle cx="92" cy="54.9" r="3.6" fill="var(--c-void)" stroke="var(--c-cosmic)" strokeWidth="1.2" />
      {/* light curve with the dip directly under the planet */}
      <line x1="92" x2="92" y1="61" y2="88" stroke="var(--c-text-muted)" strokeOpacity="0.8" strokeWidth="1" strokeDasharray="1.5 3" />
      <path
        d="M14 92 H82 C84.5 92 85 98 88 98.4 Q92 99 96 98.4 C99 98 99.5 92 102 92 H154"
        stroke="var(--c-cosmic)"
        strokeOpacity="0.8"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      {/* a few background stars */}
      <circle cx="22" cy="14" r="0.9" fill="var(--c-text-secondary)" />
      <circle cx="146" cy="12" r="0.9" fill="var(--c-text-secondary)" />
      <circle cx="132" cy="74" r="0.7" fill="var(--c-text-muted)" />
      <circle cx="34" cy="70" r="0.7" fill="var(--c-text-muted)" />
    </svg>
  );
}
