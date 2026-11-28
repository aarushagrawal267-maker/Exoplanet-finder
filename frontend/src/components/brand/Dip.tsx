/**
 * The signature detail: a transit dip — a flat light curve with one notch. Used as the section
 * rule (before eyebrows on page headers and the Overview hero) and as the sidebar's active marker.
 * Solid cosmic ink, never a gradient.
 */
import { cn } from "@/lib/cn";

/** Horizontal dip rule, 24×8: flat baseline, a limb-darkened notch, flat again. */
export function DipRule({ className }: { className?: string }) {
  return (
    <svg width="24" height="8" viewBox="0 0 24 8" fill="none" aria-hidden="true" className={cn("shrink-0 text-cosmic", className)}>
      <path
        d="M0 2 H8 C9.2 2 9.4 6 11 6 H13 C14.6 6 14.8 2 16 2 H24"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Vertical dip marker for the active navigation entry: a 2 px rule whose notch points into the
 * row. Fills the height of its (absolutely positioned) container.
 */
export function DipMarker({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex w-2 flex-col items-start text-cosmic", className)}>
      <span className="ml-px w-0.5 flex-1 rounded-t-full bg-current" />
      <svg width="8" height="12" viewBox="0 0 8 12" fill="none" className="shrink-0">
        <path d="M2 0 V2 C2 3.4 6 4 6 5.2 V6.8 C6 8 2 8.6 2 10 V12" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <span className="ml-px w-0.5 flex-1 rounded-b-full bg-current" />
    </span>
  );
}
