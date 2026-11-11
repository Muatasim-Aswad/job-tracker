import { request } from "../../infra/http";
import type { DocumentCreate, DocumentUpdate, JobDocument } from "@job-tracker/shared/api";

export const api = {
  addDocument: (jobId: string, body: DocumentCreate): Promise<JobDocument> =>
    request(`/jobs/${jobId}/documents`, { method: "POST", body: JSON.stringify(body) }),

  updateDocument: (documentId: number, body: DocumentUpdate): Promise<JobDocument> =>
    request(`/documents/${documentId}`, { method: "PATCH", body: JSON.stringify(body) }),

  deleteDocument: (documentId: number): Promise<void> =>
    request(`/documents/${documentId}`, { method: "DELETE" }),
};
