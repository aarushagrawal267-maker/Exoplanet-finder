/**
 * Sidebar footer: compact system status (API, compute device, active model, dataset).
 * Purely presentational — AppShell supplies the rows. Each row has a text value, so the status
 * dot is never the only carrier of meaning.
 */
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";

export type StatusTone = "ok" | "warn" | "error" | "idle" | "model";

export interface StatusRow {
  key: string;
  label: string;
  value: string;
  tone?: StatusTone;
  title?: string;
}

const dot: Record<StatusTone, string> = {
  ok: "bg-cosmic",
  warn: "bg-warn",
  error: "bg-danger",
  idle: "bg-fg-muted",
  model: "bg-nebula",
};

export function StatusFooter({ rows, collapsed = false }: { rows: StatusRow[]; collapsed?: boolean }) {
  if (collapsed) {
    const worst = rows.find((r) => r.tone === "error") ?? rows.find((r) => r.tone === "warn") ?? rows[0];
    const summary = rows.map((r) => `${r.label}: ${r.value}`).join(" · ");
    return (
      <Tooltip content={<span className="flex flex-col gap-0.5">{rows.map((r) => <span key={r.key}>{`${r.label}: ${r.value}`}</span>)}</span>} side="right">
        <button type="button" aria-label={`System status — ${summary}`} className="mx-auto flex size-10 flex-col items-center justify-center gap-1 rounded-md hover:bg-fg/[0.05]">
          {rows.slice(0, 4).map((r) => (
            <span key={r.key} className={cn("h-1 w-4 rounded-full", dot[r.tone ?? "idle"], r === worst ? "opacity-100" : "opacity-60")} />
          ))}
        </button>
      </Tooltip>
    );
  }
  return (
    <dl className="flex flex-col gap-1.5" aria-label="System status">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center justify-between gap-3" title={r.title}>
          <dt className="eyebrow text-fg-secondary">{r.label}</dt>
          <dd className="flex min-w-0 items-center gap-1.5 text-xs text-fg">
            <span className={cn("size-1.5 shrink-0 rounded-full", dot[r.tone ?? "idle"])} aria-hidden="true" />
            <span className="num truncate">{r.value}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
