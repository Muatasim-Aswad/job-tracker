import { useState } from "react";
import { Copy, Link2, Pencil, Trash2 } from "lucide-react";
import type { Listing, ListingUpdate } from "@job-tracker/shared/api";
import { postingUrl } from "@job-tracker/shared/links";
import { platformLabel } from "@job-tracker/shared/platforms";
import { fmtDate, POSTED_META_KEYS, readPosted } from "@job-tracker/shared/time";
import { ExpandableText } from "../ExpandableText";
import { IconButton } from "../IconButton";
import { InlineConfirm } from "../InlineConfirm";
import { Linkify } from "../Linkify";
import { MetaLine } from "../MetaLine";
import { Tooltip } from "../Tooltip";
import { UrlLink } from "../UrlLink";
import { describeError, toast } from "../../lib/toast";
import { NEUTRAL } from "./constants";
import { ListingEditForm } from "./ListingEditForm";
import { RelinkPicker } from "./RelinkPicker";

// Friendly labels for the raw snake_case detail keys the capture produces.
// Anything not listed falls back to a title-cased version of the key.
const LISTING_FIELD_LABELS: Record<string, string> = {
  apply_url: "Apply",
  company_url: "Company",
  location: "Location",
  salary: "Salary",
  workplace: "Workplace",
  employment_type: "Type",
};

// Unknown apply types add no useful information and are omitted.
const APPLY_TYPE_LABELS: Record<string, string> = {
  easy_apply: "Easy apply",
  external: "External apply",
};

function fieldLabel(key: string): string {
  return (
    LISTING_FIELD_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/, (c) => c.toUpperCase())
  );
}

// Empty-ish detail values are noise (e.g. a `chips: []` with nothing in it) and
// shouldn't render a blank row.
function isEmptyValue(v: unknown): boolean {
  if (v == null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

// Section headings the scraper picks up along with the body, because on the page
// they sit inside the description container. Matched whole-line and case-insensitively.
const JD_HEADINGS = ["about the job", "about this job", "job description", "over de functie"];

// Remove container headings and repeated titles while preserving authored prose.
// Check both titles because a merged job may have a different canonical title.
function stripJdPreamble(text: string, titles: (string | null)[]): string {
  const lines = text.split("\n");
  const wanted = new Set(titles.map((t) => t?.trim().toLowerCase()).filter(Boolean));
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim().toLowerCase();
    // Preserve paragraph breaks once authored prose begins.
    if (line === "" || JD_HEADINGS.includes(line) || wanted.has(line)) i++;
    else break;
  }
  return lines.slice(i).join("\n");
}

// Flatten whitespace only for the compact preview; expanded and copied text keeps
// the author's paragraph structure.
function flattenForPreview(text: string): string {
  return text
    .replace(/\s*\n\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function fieldValue(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object" && v !== null) return JSON.stringify(v);
  return String(v);
}

interface Props {
  listing: Listing;
  jobTitle: string | null;
  jobCompany: string | null;
  isOnly: boolean;
  onDelete: () => void;
  onRelink: (targetJobId: string) => void;
  onUpdate: (body: ListingUpdate) => void;
}

export function ListingCard({
  listing: l,
  jobTitle,
  jobCompany,
  isOnly,
  onDelete,
  onRelink,
  onUpdate,
}: Props) {
  const [relinking, setRelinking] = useState(false);
  const [editing, setEditing] = useState(false);

  // Captured listings remain scraper-owned; manual listings have no other editor.
  const editable = l.platform === "manual";

  const link = postingUrl(l.platform, l.platform_id, l.url);
  const isStubLink = !l.url && !!link;

  // Edit the stored description; preamble cleanup is presentation-only.
  const rawDescription = typeof l.meta.description === "string" ? l.meta.description.trim() : "";
  const description = stripJdPreamble(rawDescription, [l.title, jobTitle]);
  const companyUrl = typeof l.meta.company_url === "string" ? l.meta.company_url : "";

  // Estimated dates render only at the precision supported by their evidence.
  const posted = readPosted(l.meta, { platform: l.platform, capturedAt: l.captured_at });

  // Fields with dedicated presentation do not repeat in the metadata grid.
  const consumed = new Set(["description", "company_url", ...POSTED_META_KEYS]);
  const fields = Object.entries(l.meta).filter(([k, v]) => !consumed.has(k) && !isEmptyValue(v));

  // Copy a self-contained listing and report the settled clipboard result.
  async function copyDescription() {
    const header = [l.title || jobTitle, l.company ?? jobCompany].filter(Boolean).join(" — ");
    const payload = [...(header ? [header] : []), ...(link ? [link] : []), "", description].join(
      "\n",
    );
    try {
      await navigator.clipboard.writeText(payload);
      toast.info("Copied the job description.");
    } catch (err) {
      toast.error(`Could not copy the job description. ${describeError(err)}`);
    }
  }

  return (
    <div className="group flex flex-col gap-1 rounded border border-line bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-ink">{platformLabel(l.platform)}</span>
        <span className="flex items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
          {/* Keep the copy action with the listing it copies. */}
          {description && (
            <IconButton
              size="sm"
              label="Copy job description"
              onClick={copyDescription}
              className={NEUTRAL}
            >
              <Copy size={14} />
            </IconButton>
          )}
          {editable && (
            <IconButton
              size="sm"
              label="Edit listing"
              active={editing}
              activeMeans="expanded"
              onClick={() => setEditing((v) => !v)}
              className={editing ? "text-violet-600 dark:text-violet-300" : NEUTRAL}
            >
              <Pencil size={14} />
            </IconButton>
          )}
          <IconButton
            size="sm"
            label="Relink to another job"
            active={relinking}
            activeMeans="expanded"
            onClick={() => setRelinking((v) => !v)}
            className={relinking ? "text-violet-600 dark:text-violet-300" : NEUTRAL}
          >
            <Link2 size={14} />
          </IconButton>
          <InlineConfirm
            trigger={<Trash2 size={14} />}
            triggerLabel="Delete listing"
            confirmLabel={isOnly ? "Delete listing (removes job)?" : "Delete listing?"}
            onConfirm={onDelete}
          />
        </span>
      </div>

      {relinking && (
        <RelinkPicker
          currentJobId={l.job_id}
          platform={l.platform}
          platformId={l.platform_id}
          matchTitle={jobTitle ?? l.title ?? ""}
          matchCompany={jobCompany ?? l.company ?? ""}
          dissolvesSource={isOnly}
          onPick={(targetJobId) => {
            setRelinking(false);
            onRelink(targetJobId);
          }}
          onCancel={() => setRelinking(false)}
        />
      )}

      {editing && (
        <ListingEditForm
          initialUrl={l.url ?? ""}
          initialDescription={rawDescription}
          onCancel={() => setEditing(false)}
          onSave={(url, desc) => {
            // Merge into the existing bag so other detail keys survive, since PATCH
            // replaces the whole `meta` column. A cleared value drops the key.
            const meta: Record<string, unknown> = { ...l.meta };
            if (desc) meta.description = desc;
            else delete meta.description;
            onUpdate({ url, meta });
            setEditing(false);
          }}
        />
      )}

      {!editing && (
        <>
          <MetaLine
            items={[
              link && (
                <UrlLink
                  key="link"
                  href={link}
                  label={isStubLink ? `find ${l.platform_id}` : "Posting"}
                  title={isStubLink ? "Reconstructed link (not yet captured)" : link}
                />
              ),
              companyUrl && <UrlLink key="company" href={companyUrl} label="Company" />,
              // The date, and what it's worth. Focusable and tappable because the
              // qualification ("accurate to the month") is the substance, and
              // hover-only would hide it from half the people reading it.
              <Tooltip key="posted" label={posted.tooltip}>
                <span tabIndex={0} className={posted.known ? "" : "text-ink-faint"}>
                  {posted.known ? `Posted ${posted.text}` : "Posting date unknown"}
                </span>
              </Tooltip>,
              // Preserve when the listing closed.
              l.closed_at && (
                <span key="closed" className="text-red-600 dark:text-red-400">
                  Closed {fmtDate(l.closed_at)}
                </span>
              ),
              l.apply_type && APPLY_TYPE_LABELS[l.apply_type],
            ]}
          />

          {fields.length > 0 && (
            <dl className="mt-1 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-micro">
              {fields.map(([k, v]) => {
                const value = fieldValue(v);
                const url = /^https?:\/\//.test(value);
                return (
                  <div key={k} className="contents">
                    <dt className="text-ink-muted">{fieldLabel(k)}</dt>
                    {/* Non-URL values expose their full text beyond visual truncation. */}
                    <dd className="min-w-0 text-ink-soft">
                      {url ? (
                        <div className="truncate">
                          <UrlLink href={value} />
                        </div>
                      ) : (
                        <Tooltip label={value} className="block min-w-0 truncate">
                          <span tabIndex={0}>
                            <Linkify text={value} />
                          </span>
                        </Tooltip>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
          {description && (
            <div className="mt-1 border-t border-line pt-2">
              <ExpandableText
                text={description}
                previewText={flattenForPreview(description)}
                lines={2}
                className="text-prose leading-relaxed text-ink-soft"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
