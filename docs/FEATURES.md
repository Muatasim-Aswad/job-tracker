# Job Tracker features

Job Tracker streamlines the job-search process around one principle: a job remains the same opportunity wherever you encounter it. Listings, actions, notes, status changes, and materials can accumulate in one record instead of being scattered across pages and tools.

The product automates work when a supported source provides reliable evidence and leaves consequential judgments—such as whether two listings are genuinely the same job—to you.

For installation and the current support matrix, see the [project README](../README.md). For internal boundaries and implementation decisions, see [Architecture](ARCHITECTURE.md).

## One opportunity, one history

A job and the listings that represent it are related but distinct. One job can retain several listing URLs and their history, so a repost or another source does not need to become a disconnected application record.

Actions and context stay at the appropriate scope. Notes, events, status, and hiding belong to a tracked job. Blocking belongs to a company and warns you about tracked jobs from that company.

### Reposts stay connected

When Job Tracker finds a possible repost, it suggests a match using the normalized company and title. When descriptions are available, their similarity provides additional evidence.

You decide whether the suggestion is correct. Confirming a match consolidates the linked listings, application status and history, events, and material records. Dismissing it records a false match so the same incorrect suggestion does not keep returning. Jobs are never merged automatically.

## Capture what can be captured

The browser extension reduces repeated entry on supported sources:

- Opening a supported LinkedIn job detail can capture its listing information and record that it was seen.
- Applying on LinkedIn can advance the tracked job when the extension detects reliable evidence of the application.
- LinkedIn's Applied page can import historical applications.
- Supported LinkedIn job emails in Gmail can record a rejection using the email timestamp.
- Listing closure can be detected without treating one expired URL as proof that the entire opportunity disappeared.

A pre-application job closes automatically only when all of its linked listings are closed. Jobs at applied or later stages keep their application status because a hiring process may continue after its listing closes.

Jobs from sources without a built-in integration can still be created manually from the extension popup.

## Decide with context

Decision signals lift useful details out of a listing while retaining the surrounding text:

- required years of experience, including numeric ranges and decimals;
- languages;
- pay information;
- seniority and custom terms;
- applicant and apply-click counts;
- listing age;
- blocked-company warnings.

On LinkedIn, Job Tracker can also show how many times you previously applied to the same company. These signals help you inspect relevant evidence faster; they do not replace your judgment or claim to measure decision accuracy.

Optional persistent actions, including title outlining and automatic hiding, are off by default.

## Act where you encounter the job

Supported pages can expose tracker controls beside the job, reducing the need to switch to the dashboard for routine triage. Because those actions update the shared job record, their meaning is not tied to one webpage.

The extension popup provides a compact workflow from other browsing contexts. Its search can be seeded from supported pages and domains, ATS URLs, and Gmail subjects to reduce typing. From the popup you can:

- search tracked jobs;
- advance a job through the funnel;
- backdate a status change;
- comment on the current status;
- add a note;
- create a job manually.

The popup does not provide generic editing of every job field. Full record management remains in the dashboard.

## Follow the application through

The dashboard keeps the search visible as a drag-and-drop Kanban workflow. Each job retains a timeline that records update provenance and time spent at each stage.

History remains correctable rather than disposable. You can undo a transition, reopen a job, and edit an event's timestamp or comment without erasing the rest of the record.

Attention rules identify applications that have waited too long at applied or in-process stages. Adding a note can reset attention, and the dashboard can filter the queue or mark a job ghosted.

Custom fields support reusable vocabulary suggestions. Structured material records track which CV, cover letter, or other material accompanied an application, including requested and provided states. Job Tracker records the material's role and status; it does not upload or store the file itself.

## Local by default

Job Tracker is a single-user, self-hosted application:

- Local SQLite is the default database.
- Turso synchronization is optional.
- The extension talks only to the configured Job Tracker server.
- There is no third-party analytics.
- Optional search diagnostics are off by default.
- Gmail integration recognizes supported job messages in the browser and sends only the structured job and action data needed by the tracker; it does not send or store the email body as a job description.

See [Privacy](../PRIVACY.md) for captured fields, permissions, retention, and deletion, and [Security](../SECURITY.md) for the supported localhost threat model.

## Built to support more sources

LinkedIn jobs and supported LinkedIn job emails in Gmail are the only built-in integrations today. The shared job model is separate from source-specific capture, allowing new sources to be added without redefining the tracked opportunity or its history.

Built-in adapters can extend the public extension. Private or organization-specific adapters can live in a local overlay without being committed to the public repository. See the [extension adapter guide](../apps/extension/README.md) and [private overlay guide](PRIVATE.md) for implementation instructions.

Site layouts change, so source-specific capture occasionally needs an adapter update. The README's [support table](../README.md#whats-built-in-today) remains the authority for what is currently built in.
