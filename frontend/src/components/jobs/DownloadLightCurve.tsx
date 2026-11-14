/**
 * "Download light curve" action for one star: POST /api/targets/{kepid}/download answers 200 when
 * the light curve is already cached, or 202 with the download job, whose progress is then shown.
 */
import { useQueryClient } from "@tanstack/react-query";
import { CloudDownload } from "lucide-react";
import { useState } from "react";
import { invalidateStar, useDownloadTarget } from "@/api/endpoints/targets";
import type { JobOut } from "@/api/schemas";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Button, type ButtonProps } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { JobProgress } from "./JobProgress";

export interface DownloadLightCurveProps {
  kepid: number;
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  /** Called once the light curve is cached (immediately when it already was). */
  onAvailable?: () => void;
  className?: string;
}

export function DownloadLightCurve({ kepid, label = "Download light curve", variant = "primary", size = "md", onAvailable, className }: DownloadLightCurveProps) {
  const qc = useQueryClient();
  const dl = useDownloadTarget();
  const [job, setJob] = useState<JobOut | null>(null);

  if (job) {
    return (
      <JobProgress
        className={className}
        jobId={job.id}
        initial={job}
        onDone={(j) => {
          void invalidateStar(qc, kepid);
          if (j.status === "succeeded") onAvailable?.();
        }}
        onDismiss={() => setJob(null)}
      />
    );
  }
  return (
    <div className={cn("flex flex-col items-start gap-3", className)}>
      <Button
        variant={variant}
        size={size}
        icon={<CloudDownload />}
        loading={dl.isPending}
        onClick={() =>
          dl.mutate(kepid, {
            onSuccess: (res) => {
              if (res.kind === "job") setJob(res.job);
              else onAvailable?.();
            },
          })
        }
      >
        {label}
      </Button>
      {dl.isError ? <ApiErrorBanner className="w-full" error={dl.error} /> : null}
    </div>
  );
}
