# Job Tracker — browser extension

Captures listings into your Job Tracker server and adds status, star, hide, and skip controls to supported pages. Adapters also detect application and rejection signals.

Each supported site is a small **adapter**. Built-in ones (LinkedIn, and LinkedIn job emails in Gmail) ship under `src/adapters/builtin/`; your own go in the gitignored `src/adapters/local/<board>/`, so private scrapers are never tracked by the public repo. [`docs/PRIVATE.md`](../../docs/PRIVATE.md) covers how that overlay is stored and installed.

---

## Requirements

- Complete the root [project requirements and setup](../../README.md#requirements).
- A Chromium browser (Chrome / Edge / Brave).
- A running Job Tracker server (default `http://localhost:3456`).

## Build & load

```bash
pnpm install
pnpm build          # emits the loadable extension into dist/
```

Then in the browser: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the **`dist/`** folder. After any source change, run `pnpm build` again and hit the reload ↻ on the extension card.

For a versioned release ZIP, follow the root [extension loading procedure](../../README.md#load-the-extension). Keep its version matched to the installed server artifact.

> The loaded artifact is always `dist/`, never the raw source. The build (Vite + [`@crxjs/vite-plugin`](https://crxjs.dev)) bundles the content script, service worker, and popup, and generates the MV3 `manifest.json`.

### Versioning

`manifest.config.ts` derives the manifest version from the root `VERSION`, shared by all components. See the [versioning rules](../../docs/DEVELOPMENT.md#releases-and-versions) and [release history](../../CHANGELOG.md).

Run `pnpm build` and `pnpm typecheck` before calling a change done.

## Configure the server address

Copy the example environment file, set `VITE_SERVER_URL`, and rebuild:

```bash
cp .env.example .env      # then set VITE_SERVER_URL, e.g. https://tracker.example.com
pnpm build
```

`VITE_SERVER_URL` feeds both the in-page fetches ([config.ts](src/config.ts)) and the manifest's `host_permissions` ([manifest.config.ts](manifest.config.ts)), defaulting to `http://localhost:3456`. The extension never stores or sends the server's optional `X-API-Key`, so keep `API_KEY` unset for a direct local connection or put a trusted intermediary in front to inject the header — otherwise every API call gets a `401`.

## LinkedIn Easy Apply form fill

The **Settings → Easy Apply form fill** switch defaults to on. Turning it off removes markers and the panel and cancels pending scans, unsent captures, and suggestion lookups; already-issued saves may finish. Only the switch and summary expanded/collapsed preference are saved in `chrome.storage`, as device-local Booleans. Question and answer values stay in runtime memory. The summary preference survives rerenders; steps without field status have no panel.

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

## Search seeding & diagnostics

When the popup opens off-platform or on a LinkedIn job page, it tries to pre-fill the search box with the company, tagging each guess with the **rule** that produced it:

- `domain-label` — the domain label on a career site / company page
- `ats-path` — the company segment in a known ATS URL (Greenhouse, Lever, …)
- `gmail-subject` — parsed from the open email's subject (the tab title) on Gmail
- `gmail-subject-fallback` — the subject's first meaningful word when no company shape matches
- `linkedin-title` — the company segment of a LinkedIn `/jobs/view/` tab title (`Role | Company | LinkedIn`)
- `typed` — you edited/typed the query yourself
- `none` — nothing worth seeding (box left empty)

Search diagnostics use one scope under **Settings → Search diagnostics**: **Never**, **30 minutes**, or **Always**. A fresh install is Never and sends no search-log request. Both active scopes store the full debugging context: page host, automatic seed and extraction rule, the seed's result count, final query and result count, and clicked job ID. Seed replacement is derived by comparing seed to final query, and a click from the presence of a job ID. The server keeps the newest 1,000 rows; **Clear stored data** erases them. See [`PRIVACY.md`](../../PRIVACY.md) for the complete data flow.

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

Rebuild with `pnpm build` and reload the extension. Registration needs no engine edit.

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
