import { describe, expect, it } from "vitest";
import { apiDate, bestOf, ciOf, fmtCi, formatConfigValue, metricOf, modelTypeLabel, parseId, parseIdList } from "./metrics";

describe("ops metric helpers", () => {
  it("reads metrics and intervals defensively", () => {
    expect(metricOf({ pr_auc: 0.9, bad: "x", nan: Number.NaN }, "pr_auc")).toBe(0.9);
    expect(metricOf({ bad: "x" }, "bad")).toBeNull();
    expect(metricOf({ nan: Number.NaN }, "nan")).toBeNull();
    expect(metricOf(undefined, "pr_auc")).toBeNull();
    expect(ciOf({ f1: [0.7, 0.9] }, "f1")).toEqual([0.7, 0.9]);
    expect(ciOf({ f1: [0.7] }, "f1")).toBeNull();
    expect(fmtCi([0.7, 0.912])).toBe("0.700–0.912");
  });

  it("picks the best value respecting lower-is-better metrics", () => {
    expect(bestOf("pr_auc", [0.8, null, 0.9])).toBe(0.9);
    expect(bestOf("ece", [0.05, 0.02])).toBe(0.02);
    expect(bestOf("f1", [null])).toBeNull();
  });

  it("parses URL ids", () => {
    expect(parseIdList("3, 5,3,x,-1")).toEqual([3, 5]);
    expect(parseId("12")).toBe(12);
    expect(parseId("1.5")).toBeNull();
    expect(parseId(null)).toBeNull();
  });

  it("parses naive API timestamps as UTC", () => {
    expect(apiDate("2026-11-14T21:47:30.93")?.toISOString()).toBe("2026-11-14T21:47:30.930Z");
    expect(apiDate("2026-11-14T21:47:30+00:00")?.toISOString()).toBe("2026-11-14T21:47:30.000Z");
    expect(apiDate(null)).toBeNull();
  });

  it("formats labels and config values", () => {
    expect(modelTypeLabel("cnn_two_view")).toBe("Two-view CNN");
    expect(modelTypeLabel("mystery_model")).toBe("mystery model");
    expect(formatConfigValue([null, 16])).toBe("none, 16");
    expect(formatConfigValue(true)).toBe("yes");
    expect(formatConfigValue(0.30000000000000004)).toBe("0.3");
  });
});
