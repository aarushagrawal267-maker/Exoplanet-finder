/** Light-curve uploads: store → describe → parse (`/api/uploads/*`). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiFetch } from "../client";
import type { ParseIn, ParseOut, UploadOut } from "../schemas";
import { qk } from "./keys";

export function uploadFile(file: File): Promise<UploadOut> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<UploadOut>("/uploads", { method: "POST", body: form });
}

export function useUpload(uploadId: string | null) {
  return useQuery({
    queryKey: qk.uploads.one(uploadId ?? ""),
    queryFn: ({ signal }) => api.get<UploadOut>(`/uploads/${uploadId}`, undefined, signal),
    enabled: Boolean(uploadId),
    staleTime: 5 * 60_000,
  });
}

export function useUploadFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: uploadFile,
    onSuccess: (up) => qc.setQueryData(qk.uploads.one(up.upload_id), up),
  });
}

export function useParseUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ uploadId, body }: { uploadId: string; body: ParseIn }) => api.post<ParseOut>(`/uploads/${uploadId}/parse`, body),
    onSuccess: (_parsed, { uploadId }) =>
      Promise.all([qc.invalidateQueries({ queryKey: qk.uploads.one(uploadId) }), qc.invalidateQueries({ queryKey: qk.lightcurves.all })]),
  });
}
