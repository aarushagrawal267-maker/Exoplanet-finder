import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { centralRange, pow10Label } from "@/components/charts/CategoryHistogram";
import { JobProgress, resultSummary } from "@/components/jobs/JobProgress";
import { Pagination } from "@/components/ui/Pagination";
import { ToggleChips } from "@/components/ui/ToggleChips";
import { mockApi } from "@/test/api";
import { job, qualityA } from "@/test/fixtures";
import { catalogueClassification, displayUnit, nums, pairs, toQualityReport } from "./adapters";
import { validateEphemeris } from "./EphemerisChooser";

afterEach(() => vi.unstubAllGlobals());

describe("adapters", () => {
  it("maps QualityOut's parallel issue codes and messages to the QualityReport shape", () => {
    const r = toQualityReport({ ...qualityA, grade: "D", ok: false, issues: ["too_few_transits", "misaligned"], messages: ["Only 1 transit", "Offset 0.6 T14"] });
    expect(r).toMatchObject({ grade: "D", ok: false, issues: [{ code: "too_few_transits", message: "Only 1 transit" }, { code: "misaligned", message: "Offset 0.6 T14" }] });
    expect(toQualityReport({})).toBeNull();
  });
  it("prefers the KOI disposition, then the DR24 label, for the catalogue column", () => {
    expect(catalogueClassification({ koi_disposition: "FALSE POSITIVE", av_training_set: "PC", label_conflict: true })).toMatchObject({ disposition: "FALSE POSITIVE", cls: "false_positive" });
    expect(catalogueClassification({ koi_disposition: null, av_training_set: "PC", label_conflict: false })).toMatchObject({ disposition: "DR24 PC", cls: "planet" });
    expect(catalogueClassification({ koi_disposition: "CANDIDATE", label_conflict: false })?.cls).toBeNull();
    expect(catalogueClassification(null)).toBeNull();
  });
  it("keeps gaps as NaN and drops incomplete pairs", () => {
    expect(nums([1, null, 3])).toEqual([1, Number.NaN, 3]);
    expect(pairs([1, null, 3], [4, 5, null])).toEqual({ x: [1], y: [4] });
    expect(displayUnit("R_earth")).toBe("R⊕");
    expect(displayUnit("ppm")).toBe("ppm");
  });
  it("validates manual ephemerides", () => {
    expect(validateEphemeris({ period: 2, epoch: 100, durationHours: 3 })).toEqual({});
    expect(validateEphemeris({ period: null, epoch: null, durationHours: 0 })).toMatchObject({ period: expect.any(String), epoch: expect.any(String), durationHours: expect.any(String) });
    expect(validateEphemeris({ period: 0.1, epoch: 1, durationHours: 3 }).durationHours).toBe("The duration must be shorter than the period.");
  });
});

describe("category histogram helpers", () => {
  it("crops sparse outer tails and labels log10 ticks as powers of ten", () => {
    expect(centralRange([1, 0, 500, 600, 400, 0, 1])).toEqual([2, 4]);
    expect(centralRange([0, 0])).toEqual([0, 1]);
    expect(pow10Label(0)).toBe("1");
    expect(pow10Label(2)).toBe("100");
    expect(pow10Label(-1)).toBe("0.1");
    expect(pow10Label(3)).toBe("1,000");
  });
});

describe("Pagination and ToggleChips", () => {
  it("pages by offset and reports the visible range", async () => {
    const onChange = vi.fn();
    render(<Pagination total={120} offset={50} limit={50} onChange={onChange} noun="signals" />);
    expect(screen.getByText("51–100 of 120 signals")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onChange).toHaveBeenCalledWith(100, 50);
    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onChange).toHaveBeenCalledWith(0, 50);
  });
  it("toggles chips with aria-pressed", async () => {
    function Harness() {
      const [v, setV] = useState<string[]>([]);
      return <ToggleChips label="Category" value={v} onChange={setV} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />;
    }
    render(<Harness />);
    const a = screen.getByRole("button", { name: "A" });
    expect(a).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(a);
    expect(a).toHaveAttribute("aria-pressed", "true");
  });
});

describe("JobProgress", () => {
  it("summarises scalar results", () => {
    expect(resultSummary({ n_scored: 120, ratio: 0.5, ok: true, nested: { a: 1 } })).toEqual([
      { key: "n_scored", label: "n scored", value: "120" },
      { key: "ratio", label: "ratio", value: "0.50" },
      { key: "ok", label: "ok", value: "yes" },
    ]);
  });

  it("polls a job (no EventSource in jsdom), shows failure details and calls onDone once", async () => {
    let n = 0;
    mockApi([{ path: "/jobs/j9", handle: () => ({ body: ++n < 2 ? job({ id: "j9" }) : job({ id: "j9", status: "failed", error: "MAST returned HTTP 503", finished_at: "2026-11-14T21:01:00" }) }) }]);
    const onDone = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <JobProgress jobId="j9" initial={job({ id: "j9" })} onDone={onDone} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
    expect(await screen.findByText("MAST returned HTTP 503", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0]![0]).toMatchObject({ status: "failed" });
  });
});
