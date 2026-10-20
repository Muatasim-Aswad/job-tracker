// Server-backed company blocks use the shared normalized key. They suppress new
// capture and follow the user's remove/dim preference, but never stop updates to an
// already tracked job.
import type { Engine } from "./types.js";
import type { BlockedCompany } from "@job-tracker/shared/api";
import { normalizeCompany } from "@job-tracker/shared/text";
import { toNaturalKey } from "../registry.js";

export function createBlocklist(engine: Engine) {
  let blocklist: BlockedCompany[] = [];

  function isCompanyBlocked(company: string | null | undefined, platform: string): boolean {
    const key = normalizeCompany(company);
    if (!key) return false;
    // '*' scope blocks everywhere; a concrete platform blocks only there.
    return blocklist.some(
      (b) => b.company_key === key && (b.platform === "*" || b.platform === platform),
    );
  }

  function isCardBlocked(card: HTMLElement): boolean {
    const key = toNaturalKey(card.dataset.jhId || "");
    if (!key) return false;
    return isCompanyBlocked(card.dataset.jobCompany, key.platform);
  }

  // Keep the last-known list when synchronization fails.
  async function syncBlocklist() {
    const resp = await engine.bridge({ type: "blocklist" });
    if (!resp.ok) return;
    blocklist = resp.result as BlockedCompany[];
    engine.renderAll();
  }

  async function blockCardCompany(card: HTMLElement) {
    const id = card.dataset.jhId || "";
    const company = (card.dataset.jobCompany || "").trim();
    if (!id || !company) return;
    if (await blockCompany(company)) engine.renderAll();
    else engine.flashError(id);
  }

  // Persist a global block and use the server's normalized row locally.
  async function blockCompany(company: string): Promise<boolean> {
    const name = company.trim();
    if (!name) return false;
    const resp = await engine.bridge({ type: "block-company", company: name, platform: "*" });
    if (!resp.ok) {
      console.warn(`[job-tracker] block failed for “${name}”:`, resp.error);
      return false;
    }
    blocklist.push(resp.result as BlockedCompany);
    return true;
  }

  // Remove both global and platform-scoped entries that affect this view.
  async function unblockCompany(company: string, platform: string): Promise<boolean> {
    const cKey = normalizeCompany(company);
    if (!cKey) return false;
    const targets = blocklist.filter(
      (b) => b.company_key === cKey && (b.platform === "*" || b.platform === platform),
    );
    if (!targets.length) return true; // already unblocked
    for (const t of targets) {
      const resp = await engine.bridge({
        type: "unblock-company",
        company_key: t.company_key,
        platform: t.platform,
      });
      if (!resp.ok) {
        console.warn(`[job-tracker] unblock failed for “${company}”:`, resp.error);
        return false;
      }
    }
    const removed = new Set(targets);
    blocklist = blocklist.filter((b) => !removed.has(b));
    return true;
  }

  // Disable while saving so rapid clicks cannot issue opposing writes.
  async function toggleDetailBlock(jobId: string, btn: HTMLButtonElement) {
    const company = (btn.dataset.jhCompany || "").trim();
    if (!company) return;
    const key = toNaturalKey(jobId);
    const platform = key?.platform || "*";
    btn.disabled = true;
    const ok = isCompanyBlocked(company, platform)
      ? await unblockCompany(company, platform)
      : await blockCompany(company);
    btn.disabled = false;
    if (ok) engine.renderAll();
    else engine.flashError(jobId);
  }

  return {
    resetBlocklist: () => {
      blocklist = [];
    },
    isCompanyBlocked,
    isCardBlocked,
    syncBlocklist,
    blockCardCompany,
    toggleDetailBlock,
  };
}
