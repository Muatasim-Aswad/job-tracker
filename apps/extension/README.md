# Job Tracker — browser extension

Captures listings into your Job Tracker server and adds status, star, hide, and skip controls to supported pages. Adapters also detect application and rejection signals.

Each supported site is a small **adapter**. Built-in ones (LinkedIn, and LinkedIn job emails in Gmail) ship under `src/adapters/builtin/`; your own go in the gitignored `src/adapters/local/<board>/`, so private scrapers are never tracked by the public repo. [`docs/PRIVATE.md`](../../docs/PRIVATE.md) covers how that overlay is stored and installed.

---

## Requirements

- Complete the [project requirements and setup](../../docs/DEPLOYMENT.md).
- A Chromium browser (Chrome / Edge / Brave).
- A running Job Tracker server (default `http://localhost:3456`).

## Build & load

Complete the [workspace setup](../../docs/DEVELOPMENT.md#local-development), then build from the repository root:

```bash
pnpm run build:ext
```

Then in the browser: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select **`apps/extension/dist/`**. After a source change, rebuild and hit the reload ↻ on the extension card. Commands below also run from the repository root.

For a versioned release ZIP, follow the [extension loading procedure](../../docs/DEPLOYMENT.md#load-the-extension). Keep its version matched to the installed server artifact.

> The loaded artifact is always `dist/`, never the raw source. The build (Vite + [`@crxjs/vite-plugin`](https://crxjs.dev)) bundles the content script, service worker, and popup, and generates the MV3 `manifest.json`.

### Versioning

`manifest.config.ts` derives the manifest version from the root `VERSION`, shared by all components. See the [versioning rules](../../docs/DEVELOPMENT.md#releases-and-versions) and [release history](../../CHANGELOG.md).

The worker checks the configured server's `/version.json` on startup and every 30 seconds. Different product versions, or different verified revisions at the same version, show an amber `↑` on the toolbar and replace the popup Settings gear with an amber arrow. Opening Settings shows the mismatch banner below the header divider, with both versions and, when needed, revisions. No update link or blocking dialog is shown. A red `!` connection warning takes priority; failed identity checks and unknown development revisions alone do not imply a mismatch. Checks use only the configured server, with no release-service lookup.

Use `pnpm --filter job-tracker-extension typecheck` for focused iteration and the [repository gate](../../docs/DEVELOPMENT.md#quality-gate) before calling a change done.

## Configure the server address

The extension uses the server address saved in **Settings → Server**, falling back to the build's `VITE_SERVER_URL` or `http://localhost:3456`. The compact row shows the active host and connection status; its pencil opens the address editor. Enter an HTTP(S) origin without a path, credentials, query, or fragment. The checkmark requests browser access, tests the connection, and saves only on success; denial or failure leaves the current server unchanged and shows an inline error. The cross cancels editing. The reset icon appears when the field differs from the build default and restores that address in the field; save to apply it and remove the override. Every icon has a tooltip and accessible label.

Switching updates requests and dashboard links, clears server-specific runtime caches and form-fill suggestions, and preserves browser preferences. Existing form values remain untouched. Already-issued requests may complete on their original server, but their responses cannot populate the new server's state. Optional HTTP(S) host patterns allow access requests for user-selected servers; they do not grant access to every server at installation.

To customize the build default, copy `.env.example` to `.env`, set `VITE_SERVER_URL`, and rebuild. The extension never stores or sends the optional `X-API-Key`; use an unset `API_KEY` for direct local access or a trusted intermediary that injects it.

## LinkedIn Easy Apply form fill

The **Settings → LinkedIn Easy Apply Forms** switch defaults to on. Turning it off removes markers and the panel and cancels pending scans, unsent captures, and suggestion lookups; already-issued saves may finish. The switch is stored on the configured server; the summary expanded/collapsed Boolean remains in browser-local storage. Scanning waits for shared settings to load. Question and answer values stay in runtime memory. The summary preference survives rerenders; steps without field status have no panel.

The scanner runs in the top document, matching same-origin frames, and open shadow roots. It scans only an open dialog with controls that names Easy Apply in its attributes or first appeared within five seconds of an Easy Apply activation. Legacy and SDUI layouts share accessible-name discovery: labels, `aria-labelledby`, `aria-label`, radio legends/group labels, or LinkedIn's leading per-question text. Matching visible radio prompts retain required `*`; live character counters never become identity-bearing help text. Step title and progress identify forward, backward, and repeated steps. Scanning waits for lazy fields to settle.

Supported controls are text inputs, textareas, classified numeric inputs, single-choice selects, ordinary single-choice radios, and LinkedIn's **Location (city)** typeahead. Request-local choice options map to server-owned option IDs.

Equivalent single-choice radios and dropdowns share one Question after the API identity update, so a remembered or verified answer works across LinkedIn's two modal layouts when the remaining identity evidence and active options match. Existing choice Questions are retained separately; their verified Answers can be explicitly linked to the new Question. The extension continues reading and filling each control in its actual DOM form.

Existing values are preserved. An empty field can receive an eligible verified or provisional fill; an agreeing value is reported without being written, and a differing value requires the explicit **Use my answer** action after a live-value recheck. **Revert** affects only a value the extension still owns; a radio choice filled into an empty group offers none, because the host cannot clear a radio group. One failed or unresolved field does not block an independent safe fill.

The summary counts current extension-written values as **filled**, including fills from remembered values, and agreeing untouched values as **already match**. Successful user captures, remembered-value clears, **Keep existing**, and **Revert** have separate **remembered**, **cleared**, **kept**, and **reverted** counts, shown only when present. These are current-step field states, not cumulative activity totals.

Only a trusted user change is remembered automatically after it settles. A value already present when scanning is remembered only through **Remember existing**, and a value written by the extension is never captured as user input. Clearing sends no old value and invalidates remembered knowledge. Saves for the same Question run in input order; an older response cannot discard a newer edit or clear, replace its status, or refill a pending clear. Numeric capture waits for clean host-validation evidence or forward step progress. Eligible values flush before a step change; changing the field again retries a transport failure.

New controls enter resolution after their identity stays stable across two scans. Numeric identity requires `type="number"` or numeric/decimal input mode and defaults to integer without an explicit decimal signal. LinkedIn's years-of-experience controls declare neither, so both modal layouts treat them as text. Integer write guards still reject decimals.

The legacy **Location (city)** typeahead fills as text. A typeahead linked through `aria-controls` or `aria-owns` types the stored value and presses only an exact-text suggestion. If none appears within three seconds, it restores the previous value and requests manual completion. Delayed selection and rollback require the same enabled scanner, root, step, control identity, and owned write. Suggestion-list rendering can reschedule scans without cancelling a valid selection. Typing search text is never captured; a trusted pointer/Enter pick or clear is required.

A selected first option is an existing value even when its HTML value equals its label or is omitted. Only native empty-option semantics or recognized placeholder prompts make it empty; unnamed selected options and multiple-selection controls stay manual.

Controls with up to 512 choices retain complete option identity; larger controls stay manual so one oversized field cannot reject the whole resolution batch. Unlinked typeaheads, malformed radio groups, consent and utility controls, and repeatable profile sections remain local/manual and are omitted from resolution. Résumé selectors, file inputs, and top-choice preferences have no request, marker, or status. The preselected follow-company preference is cleared once outside form-fill knowledge; users can select it afterward. The scanner never invokes application navigation, review, submission, consent, profile, file, résumé, follow-company, or top-choice actions.

## Listing availability

The shared capture engine sends `capture_kind: "detail"` only after the current detail pane supplies a nonblank title and description. Card and closure-only updates use `partial`. The API assigns `last_detail_captured_at` from its own clock only when a full-detail capture succeeds; adapters do not supply that timestamp. Full captures retain their existing per-document deduplication and retry behavior.

LinkedIn’s current job header supplies availability evidence. The gray “Not currently accepting applications” notice records **Unavailable** without changing the job’s funnel status; the red “No longer accepting applications” notice retains closure handling. Captures retain the exact notice and observation time, and repeat when availability changes. A visible, enabled Apply control records **Open**; missing, hidden, disabled, or unrelated controls do not. The detail banner presents unavailable applications as a neutral chip.

## Keyboard

Open the popup with **Alt+J**; rebind or clear it at `chrome://extensions/shortcuts`. Type to search, then use the controls below.

On an open LinkedIn job-detail view, press **Alt+H** to hide or unhide the current job, or **Alt+T** to move it forward to **To apply**. The shortcuts are inactive while an input, textarea, select, or editable region has focus. **Alt+H** changes only Job Tracker's hidden flag rather than invoking LinkedIn's dismiss action, while **Alt+T** does nothing when **To apply** is not a valid forward move.

Discovery cards expose one **Skip job** action instead of separate hide and site-dismiss actions. Before application, it records **Skipped** and invokes the site's native dismissal when available. Expanded job views expose both **Hide** and **Skip job**; Skip disappears once the job has reached **Applied** or any later or terminal state.

| Key | Action |
| --- | --- |
| `↑` / `↓` | move the highlight through results |
| `Enter` | open the highlighted result (or the first one) |
| `Backspace` | outside a text field, back out one level: add form → detail → results → clear search |
| `Esc` | close the browser popup |
| `1`–`9` | on a job, pick the Nth status move |
| `n` | on a job, start a note |
| `a` | open the fast-add form |
| `Ctrl`/`⌘ + Enter` | submit the open form (status / note / add) |

Single-letter and digit keys are ignored while a text field is focused, so they never swallow what you're typing.

LinkedIn job-alert, Viewed Jobs reminder, and profile-match recommendation emails opened in Gmail provide an **Open new jobs (N)** action after tracker state loads. The count and opened background tabs include only unaffected jobs; hidden, blocked, **To apply**, applied/later, and terminal jobs are excluded under either display mode. A listing already open in any LinkedIn job tab is not opened again. A tab opened by this action closes itself after LinkedIn reports that the recorded posting no longer accepts applications or was removed and Job Tracker successfully saves that closure; manually opened tabs never auto-close.

## Shared settings and keyword rules

The configured server stores description highlights, title rules, Easy Apply enablement, filtered-job Dim/Hide mode, and search-diagnostic scope/expiry. The worker loads settings on startup and popup access, checks for changes every 30 seconds, and broadcasts successful edits to open content frames and the popup. Settings edits show errors and reject stale revisions rather than overwriting another client's changes. Switching servers clears the active rules and disables form filling until that server's settings arrive; old responses are discarded.

The server stores defaults when its settings row is absent: description highlights enabled, no title rules, Easy Apply on, filtered jobs hidden, and diagnostics Never. Saved choices—including all highlights disabled or cleared—survive restarts. Old browser settings are ignored. Theme, server selection, and summary expansion stay local.

Popup Settings keeps Easy Apply, filtered-job Dim/Hide, and diagnostic capture as immediate controls. **Manage keyword highlights and rules ↗** opens the configured server's dashboard directly at `/?view=jobs&settings=extension`. Search diagnostics follows the link. Manage description highlights and create, view, enable/disable, edit, or delete title rules in the dashboard. The dashboard supports Contains, Starts with, and Does not contain, one list of alternatives, and Outline job card, Hide, Star, or Skip.

Matching is case-insensitive, treats punctuation literally, and uses Unicode word boundaries around words/phrases. Starts with ignores leading whitespace; Does not contain matches only a nonempty title containing none of the alternatives. All matching rules run in saved order. Outline affects presentation; Hide, Star, and Skip use ordinary server events after listing state has loaded. Blocked-company cards are excluded, Skip respects pre-application guards and sends its observed status as a server-side transaction precondition, and automatic Skip never invokes the site's native dismissal. Removing or disabling a rule does not undo prior events.

## Search seeding & diagnostics

When the popup opens off-platform or on a LinkedIn job page, it tries to pre-fill the search box with the company, tagging each guess with the **rule** that produced it:

- `domain-label` — the domain label on a career site / company page
- `ats-path` — the company segment in a known ATS URL (Greenhouse, Lever, …)
- `gmail-subject` — parsed from the open email's subject (the tab title) on Gmail
- `gmail-subject-fallback` — the subject's first meaningful word when no company shape matches
- `linkedin-title` — the company segment of a LinkedIn `/jobs/view/` tab title (`Role | Company | LinkedIn`)
- `typed` — you edited/typed the query yourself
- `none` — nothing worth seeding (box left empty)

Search diagnostics use one scope under **Settings → Search diagnostics**: **Never**, **30 minutes**, or **Always**. A fresh install is Never and sends no search-log request. Both active scopes store the full debugging context: page host, automatic seed and extraction rule, the seed's result count, final query and result count, and clicked job ID. Seed replacement is derived by comparing seed to final query, and a click from the presence of a job ID. Scope and expiry are shared server settings. The server discards submissions when capture is disabled or its temporary window has expired, including submissions from stale clients. It keeps the newest 1,000 rows. The dashboard’s **Extension settings → Search diagnostics → Clear stored data** erases them; clearing is unavailable in the popup. See [`PRIVACY.md`](../../PRIVACY.md) for the complete data flow.

---

## Write your own adapter

An adapter is one object implementing the [`Adapter`](src/adapters/types.ts) contract. Only `matches` and `findCards` are required; everything else is optional and called only when present.

```ts
// src/adapters/local/myboard/adapter.ts
import type { Adapter } from "../../types";
// Capture-capable adapters import shared engine helpers from ../../../engine.js.
// DOM-only adapters (just findCards) need no imports.
import { captureCards } from "../../../engine.js";

export const myBoardAdapter: Adapter = {
  matches: (host) => host === "jobs.myboard.com",

  // Map your prefixed render key back to the API's (platform, bare id).
  naturalKey: (id) =>
    id.startsWith("MB-")
      ? { platform: "myboard", platform_id: id.slice(3) }
      : null,

  // Tag each NEW list card: set dataset.jhId (a prefixed render key) plus
  // jobUrl / jobTitle / jobCompany, and return the tagged cards.
  findCards(doc) {
    const cards: HTMLElement[] = [];
    doc.querySelectorAll(".vacancy:not([data-jh-id])").forEach((el) => {
      const card = el as HTMLElement;
      const a = card.querySelector(
        'a[href*="/job/"]',
      ) as HTMLAnchorElement | null;
      if (!a) return;
      const m = a.href.match(/\/job\/(\d+)/);
      if (!m) return;
      card.dataset.jhId = "MB-" + m[1];
      card.dataset.jobUrl = a.href;
      card.dataset.jobTitle =
        card.querySelector("h3")?.textContent?.trim() || "";
      card.dataset.jobCompany = "My Board";
      // Optional visible card facts. The list capture patches these into existing
      // metadata, so revisiting the list cannot erase a detail-page description.
      card.dataset.jobMeta = JSON.stringify({
        location: card.querySelector(".location")?.textContent?.trim() || null,
        salary: card.querySelector(".salary")?.textContent?.trim() || null,
      });
      cards.push(card);
    });
    // Optional: persist discovery cards without marking them seen. Successful
    // upserts are deduplicated; reserve `autoEmit(id, "seen")` for detail views.
    captureCards(cards);
    return cards;
  },
};
```

Then register the host so the content script is injected there. Add the match glob to a `hosts.json` next to your adapter:

`src/adapters/local/hosts.json`:

```json
["https://jobs.myboard.com/*"]
```

Rebuild with `pnpm run build:ext` and reload the extension. Registration needs no engine edit.

- `platform` is a free-form string on the server — adding an adapter needs no server change.
- The engine asks every registered adapter's `naturalKey` in turn, so your prefix is owned entirely by your adapter.
- See the exported helpers in [engine.ts](src/engine.ts) for what a capture-capable adapter can call (`captureListingOnce`, `injectDetailButtons`, `autoEmit`, the banner/detail helpers, `toNaturalKey`, `detailText`, …).

### Built-in vs. local adapters

|  | Location | Tracked in the public repo? |
| --- | --- | --- |
| Built-in (LinkedIn, Gmail) | `src/adapters/builtin/**` + `src/adapters/builtin/hosts.json` | yes — shipped |
| Local (yours) | `src/adapters/local/<board>/adapter.ts` + `src/adapters/local/hosts.json` | no — gitignored |

The engine doesn't care either way: `import.meta.glob` picks up whatever local adapters exist, or none on a clone where the folder is absent.

---

## Layout

```text
extension/
  manifest.config.ts     # generates the MV3 manifest (matches come from hosts.json)
  vite.config.ts         # Vite + CRXJS
  src/
    content.ts           # content-script entry: builds the adapter set, calls engine.start()
    engine.ts            # barrel re-exporting the engine toolkit adapters import
    engine/              # the site-agnostic engine, one file per concern:
                         #   scan, capture, readModel, bars, matches, blocklist,
                         #   statusSelect, menu, offline, bridge, keywords,
                         #   settings, diagnostics, dom (pure helpers), create, types
    registry.ts          # the active adapter set + toNaturalKey (breaks the engine↔adapter cycle)
    messages.ts          # the typed content-script ⇄ service-worker message contract
    background.ts        # service worker: proxies API calls for the content scripts
    config.ts            # SERVER_URL / API_BASE_URL (from VITE_SERVER_URL)
    icons.ts             # inline SVG icons for injected UI
    content.css          # injected card/banner styles
    form-fill/           # all-frame LinkedIn discovery, safe scanner, settings, UI
    popup/               # the standalone React popup mini-client:
                         #   Popup/Detail/AddForm/Results/Settings + main.tsx,
                         #   api.ts (direct fetch — the popup is on the extension
                         #   origin), EasyApplyToggle, seed, subject, eventDate, theme
    adapters/
      types.ts           # the Adapter contract
      posted.ts          # shared posting-date helpers
      builtin/
        hosts.json       # built-in adapters' match globs
        linkedin/        # identity.ts, web.ts (DOM), gmail.ts (DOM-only), fixtures/
      local/             # your adapters, one dir per board + hosts.json (gitignored)
```
