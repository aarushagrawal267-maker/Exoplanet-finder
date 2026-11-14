import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

export interface SkeletonProps {
  className?: string;
  width?: number | string;
  height?: number | string;
  rounded?: "sm" | "md" | "full";
}

/** Shimmering placeholder block (static under prefers-reduced-motion). */
export function Skeleton({ className, width, height = 12, rounded = "sm" }: SkeletonProps) {
  const style: CSSProperties = { width, height };
  return (
    <div
      aria-hidden="true"
      style={style}
      className={cn("skeleton-shimmer", rounded === "full" ? "rounded-full" : rounded === "md" ? "rounded-md" : "rounded-sm", className)}
    />
  );
}

/** A few lines of placeholder text with a ragged last line. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={10} width={i === lines - 1 ? "62%" : "100%"} />
      ))}
    </div>
  );
}

export interface ChartSkeletonProps {
  height?: number;
  className?: string;
  label?: string;
}

/**
 * Chart-shaped placeholder: axis frame, recessive grid, and a flat light curve with the brand's
 * transit dip, so the loading state already reads as "a light curve is coming".
 */
export function ChartSkeleton({ height = 260, className, label = "Loading chart" }: ChartSkeletonProps) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn("relative w-full overflow-hidden rounded-md border border-hairline bg-space/60", className)}
      style={{ height }}
    >
      <svg className="absolute inset-0 size-full" preserveAspectRatio="none" viewBox="0 0 400 200" aria-hidden="true">
        {[40, 80, 120, 160].map((y) => (
          <line key={y} x1="36" x2="392" y1={y} y2={y} stroke="var(--c-hairline)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <line x1="36" x2="36" y1="12" y2="176" stroke="var(--c-hairline-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <line x1="36" x2="392" y1="176" y2="176" stroke="var(--c-hairline-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path
          d="M40 92 H196 C204 92 206 128 214 130 Q222 132 230 130 C238 128 240 92 248 92 H388"
          fill="none"
          stroke="var(--c-hairline-strong)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="skeleton-shimmer absolute inset-0 opacity-50 [background-color:transparent]" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
