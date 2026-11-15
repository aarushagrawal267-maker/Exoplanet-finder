/** Research documentation pages rendered in-app (`/api/docs/pages*`). */
import { useQuery } from "@tanstack/react-query";
import { api } from "../client";
import type { DocPage, DocPageSummary } from "../schemas";
import { qk } from "./keys";

export function useDocPages() {
  return useQuery({
    queryKey: qk.docs.pages,
    queryFn: ({ signal }) => api.get<DocPageSummary[]>("/docs/pages", undefined, signal),
    staleTime: 5 * 60_000,
  });
}

export function useDocPage(slug: string | null) {
  return useQuery({
    queryKey: qk.docs.page(slug ?? ""),
    queryFn: ({ signal }) => api.get<DocPage>(`/docs/pages/${encodeURIComponent(slug ?? "")}`, undefined, signal),
    enabled: Boolean(slug),
    staleTime: 5 * 60_000,
  });
}
