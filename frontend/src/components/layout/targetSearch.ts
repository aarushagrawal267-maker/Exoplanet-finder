/** Command-palette target search backed by `GET /api/targets/search` (KIC ids, Kepler names, KOIs). */
import { Star } from "lucide-react";
import { searchTargets } from "@/api/endpoints/targets";
import type { TargetSearchResult } from "@/api/schemas";
import type { CommandItem } from "./CommandPalette";

const LC_TEXT: Record<string, string> = {
  available: "light curve cached",
  none: "light curve not downloaded",
  queued: "download queued",
  downloading: "downloading",
  no_data: "no Kepler data",
  error: "download failed",
};

export function targetToCommand(r: TargetSearchResult): CommandItem {
  const signal = r.matched_signal_id ? `?signal=${r.matched_signal_id}` : "";
  const signals = `${r.n_signals} signal${r.n_signals === 1 ? "" : "s"}`;
  return {
    id: `target:${r.kepid}:${r.matched_signal_id ?? ""}`,
    label: r.matched_name ?? r.label,
    group: "Targets",
    description: [r.matched_name ? r.label : null, signals, LC_TEXT[r.lc_status] ?? r.lc_status].filter(Boolean).join(" · "),
    hint: `KIC ${r.kepid}`,
    icon: Star,
    path: `/targets/${r.kepid}${signal}`,
  };
}

export async function searchTargetCommands(query: string, signal: AbortSignal): Promise<CommandItem[]> {
  const results = await searchTargets(query, signal, 8);
  return results.map(targetToCommand);
}
