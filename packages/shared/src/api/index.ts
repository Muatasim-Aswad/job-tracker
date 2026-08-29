// The one place API shapes are defined for TS: the generated OpenAPI types
// (schema.ts, produced from the FastAPI app by scripts/gen-api-types.sh and never
// hand-edited) surfaced as named entity types, plus the shared fetch client.
// Regenerate with `pnpm --filter @job-tracker/shared gen:api`; CI fails on drift.
import type { components } from "./schema";
import type { Status } from "../funnel";

export * from "./client";
export type { components, paths } from "./schema";

type Schemas = components["schemas"];

// A response serializes EVERY field of its model, so a Python field with a default —
// `title: str | None = None` — is always on the wire even though OpenAPI marks it
// optional, a default making it non-required for *input* only. `Read<T>` restores that
// for the read models: nothing is `?`/`undefined`, only the genuine `| null`s remain.
// That's what lets consumers treat `job.title` as `string | null` and `job.meta` as
// always-present without a hand-written shape.
type Read<T> = Required<T>;

// The server types `status` as a bare string on its read models, since it's read back
// from the DB, but every one of these responses carries a settled funnel status.
// Narrowing to the Status union is what keeps the dashboard's STATUS_LABEL/
// STATUS_ACCENT indexing and its optimistic `project()` replay exhaustively typed.
// (The extension's read-model, which adds a synthetic "untracked" state, keeps its own
// string-status type — see messages.ts.)
export type Job = Omit<Read<Schemas["Job"]>, "status"> & { status: Status };
export type JobSummary = Omit<Read<Schemas["JobSummary"]>, "status"> & { status: Status };
export type JobDetail = Omit<
  Read<Schemas["JobDetail"]>,
  "status" | "listings" | "events" | "documents"
> & {
  status: Status;
  // The generated nested arrays reference the un-narrowed schema element types, so
  // re-point them at the narrowed read models above.
  listings: Listing[];
  events: JobEvent[];
  documents: JobDocument[];
};
export type JobMatch = Omit<Read<Schemas["JobMatch"]>, "status"> & { status: Status };
// POST /events + corrections return the canonical id alongside the settled state.
export type JobMutationState = Omit<Read<Schemas["JobMutationState"]>, "status"> & {
  status: Status;
};
export type JobState = Omit<JobMutationState, "job_id">;

export type PrimaryListing = Read<Schemas["PrimaryListing"]>;
export type Attention = Read<Schemas["Attention"]>;
export type Listing = Read<Schemas["Listing"]>;
export type ListingCreate = Schemas["ListingCreate"];
export type ListingUpdate = Schemas["ListingUpdate"];
export type ListingUpsertResult = Schemas["ListingUpsertResult"];
// One row of the batched state lookup — has the synthetic "untracked" status, so its
// `status` stays a bare string (unlike the narrowed read models above).
export type ListingState = Read<Schemas["ListingState"]>;

// The logged-event row is the Pydantic model `Event`; its name collides with the
// `Event` enum, so Pydantic emits the model as the `-Output` half of the split.
export type JobEvent = Read<Schemas["Event-Output"]>;
export type EventItem = Schemas["EventItem"];

export type JobDocument = Read<Schemas["Document"]>;
export type DocumentCreate = Schemas["DocumentCreate"];
export type DocumentUpdate = Schemas["DocumentUpdate"];

export type MetaKey = Read<Schemas["MetaKey"]>;
export type MetaVocabulary = Read<Schemas["MetaVocabulary"]>;

export type BlockedCompany = Read<Schemas["BlockedCompany"]>;
export type CompanyAppliedCount = Read<Schemas["CompanyAppliedCount"]>;

export type Stats = Read<Schemas["Stats"]>;
