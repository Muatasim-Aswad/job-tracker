import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./client";

// The extension enforces this blocklist; cache its infrequently changed management view.
const BLOCKED_KEY = ["blocked-companies"] as const;

export function useBlockedCompanies() {
  return useQuery({
    queryKey: BLOCKED_KEY,
    queryFn: () => api.listBlockedCompanies(),
    staleTime: 60_000,
  });
}

export function useBlockCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ company, platform }: { company: string; platform?: string }) =>
      api.blockCompany(company, platform),
    onSuccess: () => qc.invalidateQueries({ queryKey: BLOCKED_KEY }),
  });
}

export function useUnblockCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ companyKey, platform }: { companyKey: string; platform: string }) =>
      api.unblockCompany(companyKey, platform),
    onSuccess: () => qc.invalidateQueries({ queryKey: BLOCKED_KEY }),
  });
}
