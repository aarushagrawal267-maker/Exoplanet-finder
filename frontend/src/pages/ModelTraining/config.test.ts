import { describe, expect, it } from "vitest";
import { fxModelCards } from "../_ops/testFixtures";
import { defaultForm, maxTrainingSeconds, parseDepthGrid, parseMaxFeatures, parseNumberList, validateForm, type FormState } from "./config";

describe("training config parsing", () => {
  it("parses number lists, depth grids and max-features grids", () => {
    expect(parseNumberList("0.001, 0.01 1e-1")).toEqual([0.001, 0.01, 0.1]);
    expect(parseNumberList("0.1, abc")).toBeNull();
    expect(parseNumberList("  ")).toBeNull();
    expect(parseDepthGrid("none, 16, 8")).toEqual([null, 16, 8]);
    expect(parseDepthGrid("0")).toBeNull();
    expect(parseMaxFeatures("sqrt, LOG2, 0.5, 12")).toEqual(["sqrt", "log2", 0.5, 12]);
    expect(parseMaxFeatures("1.5")).toBeNull();
  });

  it("builds forms from the model-card defaults", () => {
    const lr = defaultForm("logreg", fxModelCards[0]?.default_config);
    expect(lr).toEqual({ kind: "logreg", v: { logreg_c_grid: "0.01, 0.1", logreg_max_iter: 5000, cv_folds: 3, seed: 42 } });
    const rf = defaultForm("random_forest", fxModelCards[1]?.default_config);
    expect(rf.kind === "forest" && rf.v.rf_max_depth_grid).toBe("none, 16");
    const cnn = defaultForm("cnn_two_view", fxModelCards[3]?.default_config);
    expect(cnn.kind === "cnn" && cnn.v.max_epochs).toBe(50);
  });
});

describe("validateForm", () => {
  it("accepts the defaults and produces the request config", () => {
    const v = validateForm(defaultForm("cnn_two_view", fxModelCards[3]?.default_config));
    expect(v.errors).toEqual({});
    expect(v.config).toMatchObject({ lr: 0.0001, batch_size: 64, max_epochs: 50, ensemble_size: 1, augment_flip: true });
    const rf = validateForm(defaultForm("random_forest", fxModelCards[1]?.default_config));
    expect(rf.config).toMatchObject({ rf_max_depth_grid: [null, 16], rf_max_features_grid: ["sqrt"] });
  });

  it("rejects out-of-range values the API would refuse", () => {
    const base = defaultForm("cnn_single");
    if (base.kind !== "cnn") throw new Error("expected a CNN form");
    const bad: FormState = { kind: "cnn", v: { ...base.v, lr: 0, dropout: 1, ensemble_size: 11, batch_size: 2.5 } };
    const v = validateForm(bad);
    expect(v.config).toBeNull();
    expect(Object.keys(v.errors).sort()).toEqual(["batch_size", "dropout", "ensemble_size", "lr"]);
  });

  it("warns (without blocking) about risky settings", () => {
    const base = defaultForm("cnn_single");
    if (base.kind !== "cnn") throw new Error("expected a CNN form");
    const v = validateForm({ kind: "cnn", v: { ...base.v, lr: 0.05, patience: 60, max_epochs: 50 } });
    expect(v.config).not.toBeNull();
    expect(v.warnings.lr).toMatch(/diverge/);
    expect(v.warnings.patience).toMatch(/never trigger/);
  });

  it("validates baseline grids", () => {
    const v = validateForm({ kind: "logreg", v: { logreg_c_grid: "0.1, -1", logreg_max_iter: 10, cv_folds: 1, seed: 0 } });
    expect(v.errors.logreg_c_grid).toBeDefined();
    expect(v.errors.cv_folds).toBeDefined();
    expect(v.config).toBeNull();
  });

  it("computes the upper-bound training time", () => {
    const f = defaultForm("cnn_two_view");
    expect(maxTrainingSeconds(10, f)).toBe(500);
    expect(maxTrainingSeconds(null, f)).toBeNull();
    expect(maxTrainingSeconds(10, defaultForm("logreg"))).toBeNull();
  });
});
