import { Check, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type StepStatus = "complete" | "current" | "upcoming" | "error";

export interface Step {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  status: StepStatus;
}

export interface StepperProps {
  steps: Step[];
  orientation?: "horizontal" | "vertical";
  className?: string;
  "aria-label"?: string;
}

const statusText: Record<StepStatus, string> = {
  complete: "completed",
  current: "current step",
  upcoming: "not started",
  error: "failed",
};

function Marker({ status, index }: { status: StepStatus; index: number }) {
  return (
    <span
      className={cn(
        "num relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
        status === "complete" && "border-signal-planet/60 bg-signal-planet/10 text-signal-planet",
        status === "current" && "border-cosmic bg-cosmic/15 text-cosmic",
        status === "upcoming" && "border-hairline-strong bg-space text-fg-secondary",
        status === "error" && "border-danger/60 bg-danger/10 text-danger",
      )}
      aria-hidden="true"
    >
      {status === "complete" ? <Check className="size-3.5" /> : status === "error" ? <X className="size-3.5" /> : String(index + 1).padStart(2, "0")}
    </span>
  );
}

/** Multi-step progress (workflows such as download → build dataset → train → evaluate). */
export function Stepper({ steps, orientation = "horizontal", className, ...aria }: StepperProps) {
  const vertical = orientation === "vertical";
  return (
    <ol aria-label={aria["aria-label"]} className={cn(vertical ? "flex flex-col" : "flex w-full items-start", className)}>
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        const connectorDone = step.status === "complete";
        return (
          <li
            key={step.id}
            aria-current={step.status === "current" ? "step" : undefined}
            className={cn("relative flex", vertical ? "gap-3 pb-5 last:pb-0" : "flex-1 flex-col items-start gap-2 pr-3 last:flex-none last:pr-0")}
          >
            {!last ? (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute",
                  vertical ? "left-[13.5px] top-8 h-[calc(100%-36px)] w-px" : "left-9 right-1 top-[13.5px] h-px",
                  connectorDone ? "bg-signal-planet/50" : "bg-hairline-strong",
                )}
              />
            ) : null}
            <Marker status={step.status} index={i} />
            <div className={cn("min-w-0", vertical ? "pt-1" : "")}>
              <div className={cn("text-sm font-medium", step.status === "upcoming" ? "text-fg-secondary" : "text-fg")}>
                {step.label}
                <span className="sr-only"> ({statusText[step.status]})</span>
              </div>
              {step.description ? <div className="mt-0.5 text-xs text-fg-secondary">{step.description}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
