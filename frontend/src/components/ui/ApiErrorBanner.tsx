import type { ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { ApiError } from "@/api/client";
import { Banner, type BannerTone } from "./Banner";
import { Button } from "./Button";

/** True when `error` is an ApiError carrying one of `codes` (e.g. "no_model", "not_downloaded"). */
export function hasErrorCode(error: unknown, ...codes: string[]): error is ApiError {
  return error instanceof ApiError && error.code !== null && codes.includes(error.code);
}

/** Plain-language parts of any error: what happened, the server's hint, and its machine code. */
export function errorParts(error: unknown): { detail: string; hint: string | null; code: string | null; status: number | null } {
  if (error instanceof ApiError) {
    if (error.isNetworkError) {
      return {
        detail: "The analysis server is not responding.",
        hint: error.hint ?? "Start the backend (scripts/start.sh or start.ps1), then retry.",
        code: error.code,
        status: error.status,
      };
    }
    return { detail: error.detail, hint: error.hint, code: error.code, status: error.status };
  }
  if (error instanceof Error) return { detail: error.message, hint: null, code: null, status: null };
  return { detail: String(error ?? "Something went wrong"), hint: null, code: null, status: null };
}

export interface ApiErrorBannerProps {
  error: unknown;
  /** Override the headline (the server's `detail` is then shown underneath). */
  title?: ReactNode;
  onRetry?: () => void;
  /** Extra call to action (e.g. a link to the page that fixes the problem). */
  action?: ReactNode;
  tone?: Extract<BannerTone, "danger" | "warn">;
  className?: string;
}

/**
 * Compact inline error for a failed request, built from the API's `{detail, code, hint}` envelope:
 * the detail as the headline, the hint as the next step, the code in mono for reference.
 */
export function ApiErrorBanner({ error, title, onRetry, action, tone = "danger", className }: ApiErrorBannerProps) {
  const { detail, hint, code } = errorParts(error);
  return (
    <Banner
      tone={tone}
      className={className}
      title={title ?? detail}
      action={
        action || onRetry ? (
          <div className="flex flex-wrap items-center gap-2">
            {action}
            {onRetry ? (
              <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={onRetry}>
                Retry
              </Button>
            ) : null}
          </div>
        ) : undefined
      }
    >
      {title ? <p>{detail}</p> : null}
      {hint ? <p className={title ? "mt-0.5" : undefined}>{hint}</p> : null}
      {code ? <p className="num mt-1 text-2xs text-fg-secondary">code: {code}</p> : null}
    </Banner>
  );
}
