import type { QualityGrade } from "@/api/types";
import { cn } from "@/lib/cn";
import { GRADE_INFO } from "./verdict";

const toneClass = {
  good: "border-cosmic/50 text-cosmic",
  ok: "border-cosmic/35 text-fg",
  warn: "border-warn/50 text-warn",
  bad: "border-danger/50 text-danger",
} as const;

/** Square letter mark for a data-quality grade (A–D), with its meaning for screen readers. */
export function GradeMark({ grade, size = "md", className }: { grade: QualityGrade; size?: "sm" | "md"; className?: string }) {
  const info = GRADE_INFO[grade];
  return (
    <span
      className={cn(
        "num inline-flex shrink-0 items-center justify-center rounded-md border bg-void/40 font-medium",
        size === "sm" ? "size-6 text-sm" : "size-10 text-lg",
        toneClass[info.tone],
        className,
      )}
      title={`${info.title}: ${info.description}`}
    >
      <span aria-hidden="true">{grade}</span>
      <span className="sr-only">
        Quality {info.title}. {info.description}
      </span>
    </span>
  );
}
