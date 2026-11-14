import { ChevronRight, OctagonAlert, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { ApiError } from "@/api/client";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

export interface ErrorStateProps {
  /** What happened, in plain language. */
  title?: ReactNode;
  /** Likely cause. */
  cause?: ReactNode;
  /** What the user can do about it. */
  fix?: ReactNode;
  /** Technical details (stack, response body) in a collapsible block. */
  details?: string;
  /** Derive title / cause / fix / details from an error (ApiError understood). */
  error?: unknown;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
  className?: string;
}

function describe(error: unknown): { title: string; cause?: string; fix?: string; details?: string } {
  if (error instanceof ApiError) {
    if (error.isNetworkError) {
      return {
        title: "The analysis server is not responding",
        cause: "The Exoplanet Finder backend is not running, or is still starting up.",
        fix: error.hint ?? "Start it with scripts/start.sh (or start.ps1 on Windows), then retry.",
        details: String(error.body ?? error.message),
      };
    }
    return {
      title: error.detail,
      cause: error.code ? `Server reported “${error.code}” (HTTP ${error.status}).` : `HTTP ${error.status} from the API.`,
      fix: error.hint ?? undefined,
      details: JSON.stringify(error.body, null, 2),
    };
  }
  if (error instanceof Error) return { title: error.message, details: error.stack };
  if (error !== undefined && error !== null) return { title: String(error) };
  return { title: "Something went wrong" };
}

/**
 * Structured error panel: what happened → likely cause → how to fix → details → retry.
 * Uses role="alert" so assistive technology announces it.
 */
export function ErrorState({ title, cause, fix, details, error, onRetry, retryLabel = "Try again", compact = false, className }: ErrorStateProps) {
  const derived = describe(error);
  const t = title ?? derived.title;
  const c = cause ?? derived.cause;
  const f = fix ?? derived.fix;
  const d = details ?? derived.details;
  return (
    <div role="alert" className={cn("rounded-card border border-danger/30 bg-danger/[0.04]", compact ? "p-4" : "p-5", className)}>
      <div className="flex items-start gap-3">
        <OctagonAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="text-md font-semibold text-fg">{t}</h3>
          {(c || f) && (
            <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-y-2">
              {c ? (
                <>
                  <dt className="eyebrow pt-0.5 text-fg-secondary">Likely cause</dt>
                  <dd className="text-fg-secondary">{c}</dd>
                </>
              ) : null}
              {f ? (
                <>
                  <dt className="eyebrow pt-0.5 text-fg-secondary">How to fix</dt>
                  <dd className="text-fg">{f}</dd>
                </>
              ) : null}
            </dl>
          )}
          {d ? (
            <details className="group mt-3">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-fg-secondary hover:text-fg [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-3.5 transition-transform duration-fast group-open:rotate-90" aria-hidden="true" />
                Technical details
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-hairline bg-void p-3 text-xs text-fg-secondary">
                {d}
              </pre>
            </details>
          ) : null}
          {onRetry ? (
            <div className="mt-4">
              <Button size="sm" icon={<RotateCcw />} onClick={onRetry}>
                {retryLabel}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
