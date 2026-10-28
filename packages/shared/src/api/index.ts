// Named entities and fetch helpers over generated FastAPI types. Regenerate schema.ts
// with pnpm --filter @job-tracker/shared gen:api; checks reject contract drift.
import type { components } from "./schema";
import type { Status } from "../funnel";

export * from "./client";
export type { components, paths } from "./schema";

type Schemas = components["schemas"];

// FastAPI serializes defaulted response fields that OpenAPI marks optional.
// Require their presence while preserving nullable values.
type Read<T> = Required<T>;

// Stored jobs carry settled funnel statuses; narrow them for exhaustive client use.
// ListingState also represents synthetic untracked results and keeps string status.
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
export type JobState = Pick<JobMutationState, "status" | "hidden" | "starred">;

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

export type DescriptionHighlight = Required<Schemas["DescriptionHighlight"]>;
export type TitleRule = Required<Schemas["TitleRule"]>;
export type SearchDiagnostics = Required<Schemas["SearchDiagnostics"]>;
export type Preferences = Omit<
  Required<Schemas["Preferences"]>,
  "description_highlights" | "title_rules" | "search_diagnostics"
> & {
  description_highlights: DescriptionHighlight[];
  title_rules: TitleRule[];
  search_diagnostics: SearchDiagnostics;
};
export type PreferencesState = { revision: string; settings: Preferences };
export type PreferencesPatch = Partial<Preferences>;
