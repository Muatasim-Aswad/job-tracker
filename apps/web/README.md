# Job Tracker dashboard

The dashboard is the React client for Job Tracker. For installation and normal use, follow the [root README](../../README.md).

## Development

Complete the [workspace setup](../../docs/DEVELOPMENT.md#local-development), then start the API in one terminal using its [direct-run command](../api/README.md#run-the-api-directly).

Start the Vite development server from the repository root in another:

```bash
pnpm run dev:web
```

Open <http://localhost:5173>. Vite proxies `/api`, `/docs`, `/openapi.json`, and `/version.json` to the API on port 3456. A production build is emitted to `apps/web/dist`; FastAPI serves that directory at <http://localhost:3456> and requires the SPA entry document to revalidate so rebuilds load the current asset hashes.

Run the dashboard tests and checks from the repository root:

```bash
pnpm exec vp run -F web test
pnpm exec vp run -F web typecheck
pnpm run build:web
```

## Installable app

Production builds include a PWA manifest, app icons, and a Workbox service worker through `vite-plugin-pwa`. Use the browser's **Install app** or **Add to Home Screen** action on HTTPS or localhost; plain HTTP on a remote host cannot register the worker. Installation keeps the existing server and database. The app shell can reopen offline, but reads and writes still need the server.

`src/sw.ts` fetches entry documents from the network first, falling back to the precached canonical shell only on network failure. Only build assets are precached. `/version.json` is excluded from precache and runtime routes; API responses, external requests, and navigation query strings are never stored by the worker. Updates activate after existing app tabs/windows close; reopening gets the current build. Vite development does not register a worker. Test the built app with `pnpm --filter web exec vp preview` and DevTools' Application and offline controls.

`public/app-icon.svg` owns the PWA icon artwork. Regenerate its tracked PNG variants with `rsvg-convert`:

```bash
rsvg-convert -w 192 -h 192 -o apps/web/public/pwa-192.png apps/web/public/app-icon.svg
rsvg-convert -w 512 -h 512 -o apps/web/public/pwa-512.png apps/web/public/app-icon.svg
rsvg-convert -w 180 -h 180 -o apps/web/public/apple-touch-icon.png apps/web/public/app-icon.svg
```

## Job drawer

The header separates Title/Close from Company/Edit and Star/Hide/Copy. Phone field inputs stack, disclosure targets grow, and Add job scrolls within short viewports.

Listings, Custom fields, Documents, and Timeline start expanded and show counts. `jt.collapsedJobSections` stores only collapsed section keys, shared across jobs. Collapsing hides mounted content and preserves drafts; Add expands its section, and attention-driven Add note expands Timeline before focusing the composer. `CollapsibleSection` and `SectionHeader` share disclosure/add controls; the drawer owns persistence.

Captured listing cards show application availability independently of job status, retain the original platform notice, and show the observation date with the precise local time available by hover or focus. Recorded closures keep their closure date.

## Application header

Jobs and Form Fill share search/count, filters, and order controls, including 38px sizing, keyboard focus, and narrow-screen wrapping. Desktop Add/Refresh sit beside the app name. On phones they move into the burger menu after workspace navigation; the current workspace is marked and disabled. Search/filter/order remain together below branding. Menu arrow and Tab navigation use visible, enabled controls; Escape restores the menu trigger. Collapsed drawer content stays outside focus-trap boundaries.

The funnel highlights changed filters or display options. Jobs groups attention, starred, Easy Apply, hidden, and blocked-company filters, with A/S/E/H/B shortcuts and attention count. Clear filters empties search and restores collection defaults while preserving order. Workspace, collection, filter, order, and display preferences persist locally; explicit URL state wins, and extension job links open Jobs. Search text and drafts are not stored.

## About and build checks

**About** is available only in the burger menu in both workspaces. Its dialog shows the compiled running version, revision, commit/build times in UTC, and verified or development state. The server identity is checked on startup, visible window focus, return from a hidden tab, and Check again/Retry. A fixed `/version.json` request uses `no-store`, omits credentials and referrers, rejects redirects, validates the public identity schema, and bounds the request and body read to five seconds. Failure stays visible in About and never claims the running build is current.

A different identity exposes the server build and Reload; reload is always explicit and retains unsaved-draft confirmation and the native unload warning. Verified revisions produce one update notice per revision; `jt.buildNotices.v1` stores only validated public revision IDs, with an in-memory fallback if storage is unavailable. No development notice is emitted: identical dev metadata cannot prove identical source. About uses the existing modal focus trap, restores the burger trigger, and suppresses application shortcuts while open. The service worker additionally filters the identity endpoint from injected precache entries; no runtime route handles it.

## Form Fill workspace

The [feature guide](../../docs/FEATURES.md#fill-supported-easy-apply-questions) owns the user workflow; [architecture](../../docs/ARCHITECTURE.md#form-fill-knowledge) owns identities and lifecycle. The following dashboard rules govern presentation and client state.

### Collections and controls

Form Fill scrolls below the fixed application header with a viewport-edge scrollbar and centered content. `CollectionToolbar` portals each list's search/filter/order controls into the header host. Collection tabs stay below it; accessible region names replace repeated visible headings. Navigation/control help appears on hover or keyboard focus. Action tooltips ignore touch; values, validation, review summaries, and clearing warnings stay visible.

Review inbox has one row per exact Question needing a Match or holding a current Capture, including differing Captures on active Matches. It excludes muted Questions by default and refreshes every two seconds while visible. Search covers prompt/section/help. Independent Matched and Dismissed filters include settled and muted Questions even from an empty inbox. Show question details reveals context/choice counts; Show source details reveals source/frequency. Saved answers defaults to active Answers, with a separate paused filter/style. Show details reveals description, type, question count, and badges. Every Show… checkbox defaults off; Clear filters resets display choices too.

Both lists default to Most recent and order all pages on the server. Answer order uses update time, all-Match count, or A–Z; Question order uses last-seen time, observation count, or A–Z. Menus place Most recent first, count order second, and A–Z last; changing order resets pagination. Loaded counts show + while more pages exist and distinguish loading/failure from zero. Main lists prefetch near Load more without revealing rows until requested; that control appears only with another page.

Filter panels close on Escape, outside click, or focus leaving; Escape restores funnel focus. Add/order controls have accessible names and tooltips; order uses the Jobs keyboard menu. New answer sits beside the app name on desktop and in the phone menu.

### Answer selection

The Question drawer exposes the chooser directly. The Question-scoped [candidate endpoint](../api/README.md#form-fill-knowledge) ranks structurally compatible suggestions before pagination and returns short private value previews. Rows show name/preview with separators and omit repeated descriptions, type/count badges, policy, and usage. Search matching existing answers broadens candidates within compatible type/active-option count; + creates an Answer. Empty suggestions invite search or creation.

The picker loads more near its scroll end, keeps loading/Retry inside the scroller, and retains rows on failure. Without intersection observation, a manual control remains. Selection replaces search/results with the chosen card; its cancel icon returns to results. Choosing fetches full detail for value, policy, and bindings. Candidate queries run only while choosing, retain server order, and discard inactive previews when the picker closes. Drawer searches remain local. Choices resolve through Question options or Answer vocabulary; missing labels read unavailable rather than exposing IDs.

### Editing and review

Drawers use the Question prompt or Answer name as their title and put values before collapsed source, details, management, and activity. Secondary headings/labels stay muted and consistently spaced; value text remains prominent. Contextual and existing values keep accessible labels without repeated visible labels; blank standalone fields keep visible labels. Fixed types appear as metadata and fixed choice labels as selectable text. Long choices use a plain disclosure with an accessible group name.

New Answers default to Automatic filling. Answer details groups value type, fill behavior, Stable key, and Description; existing fill settings live under Manage answer with policy/paused state in its heading. Contextual names/descriptions/identifiers/usage start collapsed; automatic keys track the name until customized. Stable-key and incomplete-save guidance lives in tooltips. The pencil edits an existing Answer's title as part of the value draft, committed by Save answer.

Question-context creation fixes compatible value type, active choice vocabulary, and one-to-one bindings, then saves Answer/Match atomically. Its header/back arrow returns to the chooser with the unsaved-change guard; standalone creation uses New answer. Question help/requirements live in Question details, or Answer details during contextual creation.

Review shows old/proposed values, filling, affected Questions, and complete bindings. Identical unambiguous labels get editable one-to-one suggestions requiring review. Up to ten choices remain inline; larger sets support search/collapse. Incomplete sets open automatically with an unmatched-only filter; complete long sets/vocabularies start collapsed. Comparison cards follow value controls before settings/details, omit repeated explanations, and retain warnings/provenance. Impact summaries require valid value/choice/fill changes; new-answer summaries require a valid value. Draft or revision changes, including description/policy, invalidate review.

A single remembered value has a primary review action beside the Answer chooser/card. Completion closes both Capture and underlying Question drawers. Save actions remain fixed; success closes the drawer, Save and review next advances the inbox, and failure preserves drafts. Saved-answer/inbox badges share styling. Value cleared badges count dismissed Captures separately from Question status; value-free events appear in Activity history. Legacy Dismissed/combined-filter links map to inbox filters; opaque Capture links open detail. Dismissal removes the value permanently; Match pause/retirement and Question dismissal remain distinct.

Answer drafts keep the snapshot and revision they started from across background refreshes. Reviewing a conflict explicitly updates that base while preserving the draft; discarding replaces both. Match and Capture review approve the exact draft and Answer, Question, Match, current-Answer, and Capture revisions; a changed context requires review again for scalar and choice Questions. Capture review waits for agreeing Question/Match snapshots and current Capture/Answer details. Reactivating a paused or removed Match is shown in its change review.

All mutations use expected revisions. A 409 keeps the draft and offers review/copy/discard without automatic retry. Applying a Capture explicitly creates, updates, retargets, or rebinds; Match-only saving consumes one identical non-conflicting Capture and leaves differing values pending. Conflict resolution requires a winner from the complete current set.

### Private client state

Close, internal navigation, and browser history confirm before discarding unsaved edits; reload/tab closure uses the native warning. Drafts remain in memory. Form-fill collections and presence polls receive value-free summaries; full details, candidate previews, and resolution actions are intentional private responses. URLs/history contain only enum view state, opaque resource IDs, filters, and cursors. Prompts/values never enter them, success toasts, or global errors. Detail/candidate caches are removed when drawers close.
