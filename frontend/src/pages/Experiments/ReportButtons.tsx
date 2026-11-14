/**
 * Download buttons for an experiment report or a comparison report (Markdown / HTML / JSON). The
 * file is saved under the server's Content-Disposition filename.
 */
import { Download } from "lucide-react";
import { useState } from "react";
import { comparisonReport, experimentReport, useDownloadReport } from "@/api/endpoints/reports";
import type { ReportFormat } from "@/api/schemasOps";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Button } from "@/components/ui/Button";

const FORMATS: Array<{ id: ReportFormat; label: string; title: string }> = [
  { id: "md", label: "Markdown", title: "Markdown (.md): for notes, git and papers" },
  { id: "html", label: "HTML", title: "Self-contained HTML page" },
  { id: "json", label: "JSON", title: "Machine-readable JSON with every number" },
];

export function ReportButtons({ experimentIds, label }: { experimentIds: number[]; label?: string }) {
  const dl = useDownloadReport();
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, setPending] = useState<ReportFormat | null>(null);
  const single = experimentIds.length === 1;
  const download = (format: ReportFormat) => {
    setSaved(null);
    setPending(format);
    const req = single ? experimentReport(experimentIds[0] as number, format) : comparisonReport(experimentIds, format);
    dl.mutate(req, { onSuccess: (name) => setSaved(name), onSettled: () => setPending(null) });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label ?? (single ? "Download the experiment report" : "Download the comparison report")}>
        <span className="text-sm text-fg-secondary">{label ?? (single ? "Report" : "Comparison report")}:</span>
        {FORMATS.map((f) => (
          <Button key={f.id} size="sm" variant="secondary" icon={<Download />} title={f.title} loading={pending === f.id} disabled={pending !== null && pending !== f.id} onClick={() => download(f.id)}>
            {f.label}
          </Button>
        ))}
      </div>
      {saved ? (
        <p className="text-xs text-fg-secondary" role="status">
          Saved <span className="num text-fg">{saved}</span> to your downloads.
        </p>
      ) : null}
      {dl.isError ? <ApiErrorBanner error={dl.error} /> : null}
    </div>
  );
}
