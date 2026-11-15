import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../client";
import { comparisonReport, downloadReport, experimentReport, filenameFromDisposition } from "./reports";

describe("report downloads", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the filename from Content-Disposition", () => {
    expect(filenameFromDisposition('attachment; filename="exofinder-experiment-1-report.md"')).toBe("exofinder-experiment-1-report.md");
    expect(filenameFromDisposition("attachment; filename=report.html")).toBe("report.html");
    expect(filenameFromDisposition("attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.json")).toBe("résumé.json");
    expect(filenameFromDisposition(null)).toBeNull();
  });

  it("builds the report requests the API expects", () => {
    expect(experimentReport(3, "html")).toEqual({ path: "/reports/experiments/3", query: { format: "html" }, fallbackName: "experiment-3-report.html" });
    expect(comparisonReport([2, 5], "md").query).toEqual({ ids: "2,5", format: "md" });
  });

  it("saves the file under the server's filename", async () => {
    const fetchMock = vi.fn(async () => new Response("# report", { status: 200, headers: { "Content-Disposition": 'attachment; filename="exofinder-experiment-3-report.md"' } }));
    vi.stubGlobal("fetch", fetchMock);
    const createURL = vi.fn(() => "blob:report");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: createURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const name = await downloadReport(experimentReport(3, "md"));
    expect(name).toBe("exofinder-experiment-3-report.md");
    expect(fetchMock).toHaveBeenCalledWith("/api/reports/experiments/3?format=md");
    expect(click).toHaveBeenCalled();
  });

  it("turns API errors into ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "A comparison needs at least two experiment ids", code: "invalid_ids", hint: "Use e.g. ?ids=1,2" }), { status: 400 })),
    );
    const err = await downloadReport(comparisonReport([1], "md")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("invalid_ids");
    expect((err as ApiError).hint).toBe("Use e.g. ?ids=1,2");
  });
});
