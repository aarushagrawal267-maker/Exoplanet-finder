import { afterEach, describe, expect, it } from "vitest";
import { applyUiPreferences, preferredDensity } from "./uiPreferences";

describe("UI preferences from Settings", () => {
  afterEach(() => {
    delete document.documentElement.dataset.density;
    delete document.documentElement.dataset.motion;
  });

  it("applies density and motion overrides to <html>", () => {
    applyUiPreferences({ ui_density: "compact", reduced_motion: "on" });
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(document.documentElement.dataset.motion).toBe("reduce");
    expect(preferredDensity()).toBe("compact");
    applyUiPreferences({ ui_density: "comfortable", reduced_motion: "off" });
    expect(document.documentElement.dataset.motion).toBe("full");
    applyUiPreferences({ ui_density: "comfortable", reduced_motion: "system" });
    expect(document.documentElement.dataset.motion).toBeUndefined();
    expect(preferredDensity()).toBe("comfortable");
  });
});
