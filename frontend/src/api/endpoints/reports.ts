/**
 * Report downloads (`/api/reports/*`): an experiment report or a multi-experiment comparison in
 * Markdown, HTML or JSON. The file is fetched (so API errors surface as `ApiError` banners rather
 * than a broken download), then saved under the server's Content-Disposition filename.
 */
import { useMutation } from "@tanstack/react-query";
import { ApiError, buildUrl, normaliseDetail } from "../client";
import type { ReportFormat } from "../schemasOps";

/** `attachment; filename="x.md"` / RFC 5987 `filename*=UTF-8''x.md` → "x.md" (null when absent). */
export function filenameFromDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*([^']*)''([^;]+)/i.exec(header);
  if (star?.[2]) {
    try {
      return decodeURIComponent(star[2].trim().replace(/^"|"$/g, ""));
    } catch {
      /* fall through to the plain parameter */
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
  const name = (plain?.[2] ?? plain?.[1])?.trim();
  return name ? name.replace(/^"|"$/g, "") : null;
}

export const experimentReportPath = (id: number) => `/reports/experiments/${id}`;
export const comparisonReportPath = "/reports/comparison";

export interface ReportRequest {
  path: string;
  query: Record<string, string | number>;
  /** Used when the server sends no Content-Disposition. */
  fallbackName: string;
}

export function experimentReport(id: number, format: ReportFormat): ReportRequest {
  return { path: experimentReportPath(id), query: { format }, fallbackName: `experiment-${id}-report.${format}` };
}

export function comparisonReport(ids: readonly number[], format: ReportFormat): ReportRequest {
  return { path: comparisonReportPath, query: { ids: ids.join(","), format }, fallbackName: `comparison-${ids.join("-")}.${format}` };
}

/** Fetch a report and hand it to the browser as a download. Resolves to the saved filename. */
export async function downloadReport({ path, query, fallbackName }: ReportRequest): Promise<string> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path, query));
  } catch (err) {
    throw new ApiError(0, "Cannot reach the Exoplanet Finder API.", { body: err });
  }
  if (!res.ok) {
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* plain-text error */
    }
    const { detail, code, hint } = normaliseDetail(body, `${res.status} ${res.statusText || "Report failed"}`);
    throw new ApiError(res.status, detail, { code, hint, body });
  }
  const blob = await res.blob();
  const name = filenameFromDisposition(res.headers.get("Content-Disposition")) ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return name;
}

export function useDownloadReport() {
  return useMutation({ mutationFn: downloadReport });
}
