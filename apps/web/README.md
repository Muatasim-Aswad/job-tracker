# Job Tracker dashboard

The dashboard is the React client for Job Tracker. For installation and normal use, follow the [root README](../../README.md).

## Development

Start the API in one terminal:

```bash
cd apps/api
uv run uvicorn app.main:app --port 3456 --reload
```

Start the Vite development server in another:

```bash
pnpm --filter web dev
```

Open <http://localhost:5173>. Vite proxies `/api`, `/docs`, and `/openapi.json` to the API on port 3456. A production build is emitted to `apps/web/dist`; FastAPI serves that directory at <http://localhost:3456> and requires the SPA entry document to revalidate so rebuilds load the current asset hashes.

Run the dashboard tests and checks from the repository root:

```bash
pnpm exec vp run -F web test
pnpm exec vp run -F web typecheck
pnpm run build:web
```

## Installable app

Production builds include a PWA manifest, app icons, and a Workbox service worker through `vite-plugin-pwa`. Use the browser's **Install app** or **Add to Home Screen** action on HTTPS or localhost; plain HTTP on a remote host cannot register the worker. Installation keeps the existing server and database. The app shell can reopen offline, but reads and writes still need the server.

`src/sw.ts` fetches entry documents from the network first, falling back to the precached canonical shell only on network failure. Only build assets are precached: API responses, external requests, and navigation query strings are never stored by the worker. Updates activate after existing app tabs/windows close; reopening gets the current build. Vite development does not register a worker. Test the built app with `pnpm --filter web exec vp preview` and DevTools' Application and offline controls.

`public/app-icon.svg` owns the PWA icon artwork. Regenerate its tracked PNG variants with `rsvg-convert`:

```bash
rsvg-convert -w 192 -h 192 -o apps/web/public/pwa-192.png apps/web/public/app-icon.svg
rsvg-convert -w 512 -h 512 -o apps/web/public/pwa-512.png apps/web/public/app-icon.svg
rsvg-convert -w 180 -h 180 -o apps/web/public/apple-touch-icon.png apps/web/public/app-icon.svg
```

## Job drawer

The header gives the title its own row with Close on the right. The second row pairs Company and Edit on the left, with Star and Hide together on the right and Copy separated by a small gap.

On phones, custom-field name and value inputs stack vertically. Disclosure headings have larger touch targets. The Add job dialog scrolls within the viewport on short screens.

Listings, Custom fields, Documents, and Timeline have collapsible headings with counts. Sections start expanded; collapsed section keys are stored in browser-local storage under `jt.collapsedJobSections`, shared across jobs and retained after reloads. Only section keys are saved. The status summary and actions remain visible. Collapsing hides mounted content, preserving an unsaved draft while the drawer remains open. Add actions expand their section; an attention-driven **Add note** request expands Timeline before focusing its composer. **CollapsibleSection** shares the heading, disclosure, and add behavior through **SectionHeader**; the drawer owns preferences through the existing persistent-set hook.

## Application header

Jobs and Form Fill share 38px search and toolbar controls, search/count styling, alignment, and narrow-screen wrapping. Action icons are unboxed at rest, with a background on hover or while their menu is open and a visible keyboard focus ring. Search/count, filters, and order share one row. On desktop, Add (when available) and Refresh sit beside the app name; the burger opens navigation and settings. Both workspaces use one funnel whose icon takes the accent color for active filters or changed display options. Jobs groups five labelled checkboxes under Show only and Visibility; its attention count and A/S/E/H/B shortcut hints appear inside the panel. A changed search or filter highlights the search bar and reveals **Clear filters**. Clearing restores the current collection's default filters and display options and empties search, preserving order. Form Fill counts remain loaded counts, with **+** when more pages exist.

On phones, workspace navigation, Add (when available), and Refresh move into the burger menu. A divider separates navigation from actions; the current workspace is marked and disabled. Search, filter, and order remain together below branding. Workspace, Form Fill collection, filters, ordering, and display choices survive reloads in browser-local storage; explicit URL state takes precedence, and extension job links always open Jobs. Search text and drafts are not stored.

## Form Fill workspace

Form Fill scrolls its full-width content area beneath the fixed application header, matching Jobs. The scrollbar sits at the viewport edge while the content stays centered. Page-wide search, the Review inbox order icon, and the filter funnel sit in the fixed application header; narrow screens keep search, filter, and order on one row below branding. Collection tabs remain below the header. Each list owns its query and display state; **CollectionToolbar** renders its controls into the header host through a React portal. Navigation tabs identify the workspace and collections without repeated visible headings; regions retain accessible names. General explanations appear on hover or keyboard focus over the relevant navigation tab or control; action tooltips ignore touch focus and emulated hover, keeping taps free of persistent bubbles. Keyboard focus and mouse hover still show help. Values, change summaries, validation, and clearing warnings remain visible where they inform a decision.

All Form Fill **Show…** display checkboxes default off. Choices remain browser-local, and **Clear filters** turns them off while preserving order.

The **Form Fill** view opens a question-centered **Review inbox**. Each exact Question appears once when it needs a Match or has a current Capture, including differing Captures on active Matches. Search includes prompt, section, and help; compact rows show question context and choice counts only when **Show question details** is enabled. Source and frequency metadata are shown only when **Show source details** is enabled. Search bars show the loaded matching count, with a **+** while more pages are available; hover text distinguishes loaded and complete counts, and loading or failure never appears as zero. Independent **Matched** and **Dismissed** checkboxes sit in the header filter panel beside a separate Display group, remain available for an empty inbox, and include existing active Matches and muted Questions in the same list; the default inbox excludes muted Questions. The inbox refreshes every two seconds while visible.

**Saved answers** defaults to active Answers; paused Answers have a separate filter and distinct styling. Rows show the Answer name by default; **Show details** in the filter panel reveals description, value type, question count, and badges. Both order menus place Most recent first, their count-based order second, and A–Z last. The count-based order is Most matched questions for Answers (all Matches regardless of state), and Most seen for Questions (observation count). Most recent uses Answer update time or Question last-seen time. Both lists default to Most recent. Orders apply on the server across all pages, and changing order starts a fresh pagination sequence. Collection reads never fetch Answer values. Main collections use a quiet **Load more** control at the end only while more pages exist; approaching it prefetches the next page without revealing rows. Answer selection uses the Question-scoped [candidate endpoint](../api/README.md#form-fill-knowledge), retaining server order across pages. Candidate rows show the name and a short value preview with thin separators and comfortable internal spacing, without type/count badges, fill policy, usage counts, or repeated descriptions. Approaching the picker’s scroll end loads another page automatically; loading and Retry stay inside the scroll area, failed loads retain existing rows, and browsers without intersection observation retain a quiet manual control. An empty suggestion list invites explicit search or creation; typing search finds broader candidates that still match type and active option count. A **+** icon beside search creates a new Answer; there are no separate Choose, Cancel, or New answer controls. Selection replaces search and candidates with the chosen Answer card; its cancel icon returns to the list. The Question drawer exposes this chooser directly rather than under a Saved answer disclosure. Selecting an Answer fetches its detail for the full value, fill policy, and binding review. Candidate queries are enabled only while choosing, have no inactive-cache retention, and discard previews when the picker closes. Saved-answer status and type filters open in the header funnel panel with an accessible name and tooltip; the funnel icon takes the accent color for a changed filter. Filter panels close on Escape, clicking outside, or moving focus outside; Escape returns focus to the funnel. The icon-only **New answer** button sits beside the app name on desktop and moves into the burger menu on phones. Add and order icons retain tooltips and accessible names; the order icon opens the same keyboard-operated choice menu as Jobs. Answer-chooser searches remain inside their drawers. Choice labels are resolved from the Question options or Answer vocabulary; missing options show a readable unavailable label, never an opaque ID.

Review shows the old and proposed values, fill behavior, affected Questions, and complete choice bindings. Identical, unambiguous option labels receive suggested one-to-one bindings, which remain editable and require explicit review. Up to ten choices stay inline; larger sets support search and collapse. Incomplete binding sets open automatically and support an unmatched-only filter; complete long sets and Answer vocabularies start collapsed. Drawers keep save actions visible and close after successful saves; **Save and review next** opens the next inbox Question. Failed saves retain the draft and drawer. Completing remembered-value review closes both its drawer and the underlying Question. A single remembered value gets a primary review action alongside the saved-answer chooser or selected card. Saved-answer and inbox badges share one style. Answer-editor comparison cards appear directly after the value controls, before fill settings and details. Saved-answer impact summaries appear only for valid changes to values, choices, or filling; new-answer summaries wait for a valid value.

Cleared remembered values appear as a secondary **Value cleared** badge on their Question row, with a count when several were dismissed. Current Question status remains separate; recent value-free events appear under **Activity history** in Question detail. There is no separate history table. Legacy Dismissed and combined-filter links open the corresponding Review inbox filters; opaque Capture links still open their detail. Filter state uses enum URL parameters. Dismissing a Capture clears its retained value and cannot restore it; pausing a Match, retiring it, and dismissing a Question remain separate operations.

All mutations use expected revisions. A `409` preserves the draft and offers review, copy, and discard choices without automatic retry. Applying a Capture remains an explicit create/update/retarget/rebind operation; Match-only saving consumes one identical non-conflicting Capture and leaves a differing Capture pending. Conflicts require an explicit winner from the complete current Capture set. Changing a draft or relevant revision invalidates its review, including description and fill-policy changes.

Drawers confirm before discarding unsaved edits on close, internal navigation, or browser history navigation; browser reload and tab closure use the native unsaved-change warning. Drafts remain in memory rather than persistent browser storage. Search fields use placeholders with visually hidden accessible labels. Field labels use smaller muted text; values use regular-weight dark text and an independent size. Stable-key guidance appears on hover or focus rather than as permanent copy. Values stay prominent. New Answers default to Automatic filling; value type and fill behavior live in collapsed **Answer details**, with fill behavior immediately after value type and Description after Stable key; existing Answers group its control under **Manage answer**, with the current policy or paused state visible in the collapsed heading. Contextual and existing value fields retain accessible labels while omitting repeated visible labels; saved Answer names appear as editable titles. Blank standalone creation fields keep visible labels. Fixed types are shown as metadata, and fixed choice labels are selectable text rather than read-only inputs. Choice values retain an accessible group name without a visible instruction or outer box; long lists use a plain disclosure. Secondary disclosure headings use consistent spacing and muted text. Contextual answer names, descriptions, identifiers, answer management, and usage lists start collapsed; automatic keys follow the name until customized.

Question-context creation uses the Question as its header and a back arrow to return to the chooser; standalone creation uses **New answer**. Back preserves the unsaved-change guard. Matching instructions and incomplete-form hints appear only in save tooltips. Review question and remembered-value drawers use the Question prompt as their title. Values come before collapsed source, Question details, management, and activity groups. Question help and requirements live in collapsed Question details, or Answer details during contextual creation. Comparison cards omit the repeated heading and automatic-fill explanation while retaining warnings and affected Questions. Conflicting values retain their warning and provenance. Saved-answer previews use a quiet name above the value and a compact fill-policy and usage line. Match and remembered-value actions retain explicit review, revision checks, and fixed save footers; remembered-value comparisons follow the value before answer settings.

Saved-answer names act as drawer titles; the pencil opens a name edit that joins the value draft and is committed with **Save answer**. Fixed value types appear under **Answer details**. Creating an Answer from Question detail locks its compatible value type and active choice vocabulary, then creates the Answer and Match atomically. Answer-owned labels, descriptions, values, and fill policies stay editable.

Form-fill URLs contain only enum view state and opaque Answer, Capture, or Question IDs. Filters and opaque cursors are the only list query data; prompts and values never enter the URL or browser history. Success toasts and the global error path are value-free, and detail and candidate cache entries are removed when their drawers close.

Workspace-wide architecture and conventions are documented in [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).
