import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "./client";

import type { DocumentCreate, DocumentUpdate } from "@job-tracker/shared/api";

import { jobKey } from "../jobs/queries";

export function useAddDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, body }: { jobId: string; body: DocumentCreate }) =>
      api.addDocument(jobId, body),
    onSuccess: (_doc, { jobId }) => qc.invalidateQueries({ queryKey: jobKey(jobId) }),
  });
}

export function useUpdateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      documentId,
      body,
    }: {
      documentId: number;
      body: DocumentUpdate;
      jobId: string;
    }) => api.updateDocument(documentId, body),
    onSuccess: (_doc, { jobId }) => qc.invalidateQueries({ queryKey: jobKey(jobId) }),
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId }: { documentId: number; jobId: string }) =>
      api.deleteDocument(documentId),
    onSuccess: (_void, { jobId }) => qc.invalidateQueries({ queryKey: jobKey(jobId) }),
  });
}
