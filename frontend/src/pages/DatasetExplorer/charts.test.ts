import { describe, expect, it } from "vitest";
import { decadeTicks, tickLabel } from "./charts";

describe("log histogram axis", () => {
  it("labels powers of ten without collapsing small values to zero", () => {
    expect(tickLabel(-3, "ppm")).toBe("0.001 ppm");
    expect(tickLabel(0, "d")).toBe("1.0 d");
    expect(tickLabel(2, "d")).toBe("100 d");
    expect(tickLabel(4, "")).toBe("10,000");
  });
  it("thins out ticks on wide ranges", () => {
    expect(decadeTicks(-0.3, 2.8)).toEqual([0, 1, 2]);
    expect(decadeTicks(-3.2, 5.5)).toEqual([-3, -1, 1, 3, 5]);
  });
});
