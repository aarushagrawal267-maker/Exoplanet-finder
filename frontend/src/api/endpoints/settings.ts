/** Settings, storage usage / clearing and the database backup (`/api/settings*`). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "../client";
import type { ClearIn, ClearOut, SettingsOut, StorageOut } from "../schemas";
import { qk } from "./keys";

/** Direct download link for a consistent SQLite backup (served as a file attachment). */
export const BACKUP_URL = buildUrl("/settings/backup");

export function useSettings() {
  return useQuery({
    queryKey: qk.settings.values,
    queryFn: ({ signal }) => api.get<SettingsOut>("/settings", undefined, signal),
  });
}

/** PUT /api/settings — all-or-nothing partial update; 400 `invalid_setting` names the bad value. */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (changes: Record<string, unknown>) => api.put<SettingsOut>("/settings", changes),
    onSuccess: (out) => {
      qc.setQueryData(qk.settings.values, out);
      void qc.invalidateQueries({ queryKey: qk.system.all });
    },
  });
}

export function useStorage() {
  return useQuery({
    queryKey: qk.settings.storage,
    queryFn: ({ signal }) => api.get<StorageOut>("/settings/storage", undefined, signal),
  });
}

/** POST /api/settings/storage/clear — 409 `job_running` while a job uses that data. */
export function useClearStorage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (target: ClearIn["target"]) => api.post<ClearOut>("/settings/storage/clear", { target }),
    onSuccess: () =>
      Promise.all([qc.invalidateQueries({ queryKey: qk.settings.storage }), qc.invalidateQueries({ queryKey: qk.system.all })]),
  });
}
