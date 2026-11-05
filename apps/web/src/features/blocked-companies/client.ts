import { request, toQuery } from "../../infra/http";
import type { BlockedCompany } from "@job-tracker/shared/api";

export const api = {
  listBlockedCompanies: (): Promise<BlockedCompany[]> => request("/blocked-companies"),

  blockCompany: (company: string, platform = "*"): Promise<BlockedCompany> =>
    request("/blocked-companies", {
      method: "POST",
      body: JSON.stringify({ company, platform }),
    }),

  unblockCompany: (companyKey: string, platform = "*"): Promise<void> =>
    request(`/blocked-companies/${encodeURIComponent(companyKey)}${toQuery({ platform })}`, {
      method: "DELETE",
    }),
};
