/**
 * Annotated transit schematic for hero sections: a limb-darkened star, the planet's chord across
 * the disc (ingress, mid-transit, egress) and the resulting light curve. The dip depth is
 * δ ≈ (Rp/R★)² and its total duration is T14 (first to fourth contact). Geometry is exact: the
 * light curve's ingress/egress start where the planet's disc first/last touches the stellar limb,
 * and the dotted guide from the planet lands on the dip at the planet's current position.
 */
import { cn } from "@/lib/cn";
import { useStableId } from "@/lib/hooks";

// Star centre / radius, planet chord height and radius (SVG units).
const SX = 180;
const SY = 78;
const SR = 58;
const CY = SY + 0.5 * SR; // transit chord at impact parameter b = 0.5
const PR = 8;
const HALF = Math.sqrt(SR * SR - (CY - SY) * (CY - SY)); // half-chord length at the planet's centre line
const X1 = SX - HALF - PR; // first contact
const X2 = SX - HALF + PR; // second contact
const X3 = SX + HALF - PR; // third contact
const X4 = SX + HALF + PR; // fourth contact
const PX = SX + 0.3 * HALF; // the planet, part-way through the transit
const BASE = 182;
const DEPTH = 18;

export function TransitDiagram({ className }: { className?: string }) {
  const gid = useStableId("diagram-star");
  const lc = `M28 ${BASE} H${X1} C${X1 + 6} ${BASE} ${X2 - 6} ${BASE + DEPTH - 2} ${X2} ${BASE + DEPTH - 1} Q${SX} ${BASE + DEPTH + 3} ${X3} ${BASE + DEPTH - 1} C${X3 + 6} ${BASE + DEPTH - 2} ${X4 - 6} ${BASE} ${X4} ${BASE} H332`;
  return (
    <svg
      viewBox="0 0 360 232"
      fill="none"
      className={cn("h-auto w-full", className)}
      role="img"
      aria-label="Diagram of a planetary transit: as the planet crosses the stellar disc, the star's measured brightness dips by about the square of the radius ratio for the transit duration T14."
    >
      <defs>
        <radialGradient id={gid} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#EEF2FB" />
          <stop offset="72%" stopColor="#C9D2EA" />
          <stop offset="100%" stopColor="#7E8AB0" />
        </radialGradient>
      </defs>

      {/* star */}
      <circle cx={SX} cy={SY} r={SR} fill={`url(#${gid})`} opacity="0.94" />
      {/* planet chord */}
      <line x1="44" x2="316" y1={CY} y2={CY} stroke="var(--c-hairline-strong)" strokeDasharray="2 4" />
      {/* contact positions */}
      <circle cx={SX - HALF} cy={CY} r={PR} stroke="var(--c-text-secondary)" strokeOpacity="0.7" strokeDasharray="2 2" />
      <circle cx={SX + HALF} cy={CY} r={PR} stroke="var(--c-text-secondary)" strokeOpacity="0.7" strokeDasharray="2 2" />
      <circle cx={PX} cy={CY} r={PR} fill="var(--c-void)" />
      <circle cx={PX} cy={CY} r={PR + 0.5} stroke="var(--c-cosmic)" strokeOpacity="0.9" />

      {/* guides from planet positions down to the light curve */}
      {[SX - HALF, PX, SX + HALF].map((x) => (
        <line key={x} x1={x} x2={x} y1={CY + PR + 6} y2={BASE + DEPTH + 1} stroke="var(--c-nebula)" strokeOpacity="0.35" strokeDasharray="1.5 3" />
      ))}

      {/* light curve */}
      <path d={lc} stroke="var(--c-cosmic)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />

      {/* depth bracket */}
      <path d={`M300 ${BASE} h6 M303 ${BASE} V${BASE + DEPTH} M300 ${BASE + DEPTH} h6`} stroke="var(--c-text-secondary)" strokeWidth="1" />
      <text x="311" y={BASE + DEPTH / 2 + 3.5} fill="var(--c-text-secondary)" fontFamily="JetBrains Mono, monospace" fontSize="11">
        δ
      </text>
      <line x1={X2} x2="300" y1={BASE + DEPTH} y2={BASE + DEPTH} stroke="var(--c-hairline-strong)" strokeDasharray="1.5 3" />

      {/* duration bracket */}
      <path d={`M${X1} 213 v-5 M${X1} 210.5 H${X4} M${X4} 213 v-5`} stroke="var(--c-text-secondary)" strokeWidth="1" />
      <text x={SX} y="225" textAnchor="middle" fill="var(--c-text-secondary)" fontFamily="JetBrains Mono, monospace" fontSize="11">
        T14 · first → fourth contact
      </text>

      {/* labels */}
      <text x="28" y={BASE - 8} fill="var(--c-text-secondary)" fontFamily="JetBrains Mono, monospace" fontSize="10" letterSpacing="1.2">
        FLUX
      </text>
      <text x="324" y={SY - SR + 6} textAnchor="end" fill="var(--c-text-secondary)" fontFamily="JetBrains Mono, monospace" fontSize="11">
        δ ≈ (Rp / R★)²
      </text>
    </svg>
  );
}
