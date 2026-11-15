/**
 * Interface preferences saved on the Settings page (`ui_density`, `reduced_motion`), applied as
 * attributes on <html> so plain CSS and components can follow them:
 * - `data-density="compact|comfortable"`: default row density of data tables;
 * - `data-motion="reduce|full"`: force reduced motion on, or allow motion even if the operating
 *   system asks to reduce it; absent = follow the operating system ("system").
 */
import { useEffect } from "react";
import { useSettings } from "@/api/endpoints/settings";

export type UiDensity = "comfortable" | "compact";

export function preferredDensity(): UiDensity {
  if (typeof document === "undefined") return "comfortable";
  return document.documentElement.dataset.density === "compact" ? "compact" : "comfortable";
}

export function applyUiPreferences(values: Record<string, unknown> | undefined): void {
  if (typeof document === "undefined" || !values) return;
  const root = document.documentElement;
  root.dataset.density = values.ui_density === "compact" ? "compact" : "comfortable";
  const motion = values.reduced_motion;
  if (motion === "on") root.dataset.motion = "reduce";
  else if (motion === "off") root.dataset.motion = "full";
  else delete root.dataset.motion;
}

/** Keep the <html> attributes in sync with the saved settings. */
export function useUiPreferences(): void {
  const settings = useSettings();
  const values = settings.data?.values as Record<string, unknown> | undefined;
  useEffect(() => applyUiPreferences(values), [values]);
}
