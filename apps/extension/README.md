# Job Tracker — browser extension

Captures job listings from the sites you browse and lets you triage them (status / star / hide) straight from the page, against your Job Tracker server. It injects an action bar onto job cards and detail views, auto-detects signals like _applied_ / _rejected_, and captures the listing into the tracker.

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

The manifest's version is not set here. `manifest.config.ts` reads the repository root `VERSION` file, the one product version shared with the dashboard and the server, so the extension is never bumped on its own — a user-visible change anywhere in the product decides the next number. The rules are in the [development guide](../../docs/DEVELOPMENT.md#releases-and-versions); the notes are in [`CHANGELOG.md`](../../CHANGELOG.md).

Run `pnpm build` and `pnpm typecheck` before calling a change done.

## Configure the server address

The API/dashboard origin lives in **one** place. Copy the example env and edit it:

```bash
cp .env.example .env      # then set VITE_SERVER_URL, e.g. https://tracker.example.com
pnpm build
```

`VITE_SERVER_URL` feeds both the in-page fetches ([config.ts](src/config.ts)) and the manifest's `host_permissions` ([manifest.config.ts](manifest.config.ts)), defaulting to `http://localhost:3456`. The extension never stores or sends the server's optional `X-API-Key`, so keep `API_KEY` unset for a direct local connection or put a trusted intermediary in front to inject the header — otherwise every API call gets a `401`.

## LinkedIn Easy Apply form fill

The **Settings → Easy Apply form fill** switch is enabled by default. Turning it off immediately removes form-fill markers and the panel and stops further scans or captures. Its Boolean state is the only form-fill value saved in `chrome.storage`; question and answer values are never stored there.

The dedicated LinkedIn entry runs in the top document and matching same-origin frames. It waits for lazy fields to settle and re-establishes its safe baseline on forward, backward, and repeated steps. Supported controls are ordinary text and textarea inputs, classified numeric inputs, selects, and Yes/No radio groups whose request-local options can be bound to server-owned option IDs.

Existing values are preserved. An empty field can receive an eligible verified or provisional fill; an agreeing value is reported without being written, and a differing value requires the explicit **Use my answer** action after a live-value recheck. **Revert** affects only a value the extension still owns. One failed or unresolved field does not block an independent safe fill.

Only a trusted user change is remembered automatically after it settles. A value already present when scanning is remembered only through **Remember existing**, and a value written by the extension is never captured as user input. Clearing sends no old value and invalidates the current remembered value. Numeric capture waits for clean host-validation evidence or forward step progress. Eligible pending values flush before a step change, and a failed transport attempt may be retried by changing the field again.

Supported controls that appear after a step's initial render enter resolution only after their identity remains stable across two scans. Typeaheads, ambiguous numeric fields, non-Yes/No radio groups, utility/consent checkboxes, and repeatable profile sections stay local and manual and are omitted from resolution requests. Résumé selectors and file inputs are ignored entirely: they produce no request, marker, or status entry. The scanner never clicks or invokes Next, Continue, Review, Submit, consent, profile, file, or résumé actions, and it never navigates or submits an application.

## Keyboard

Open the popup from any tab with **Alt+J** (rebind or clear it at `chrome://extensions/shortcuts`). Inside the popup the flow is keyboard-first — type to search, then:

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

## Search seeding & diagnostics

When the popup opens off-platform it tries to pre-fill the search box with the company, tagging each guess with the **rule** that produced it:

- `domain-label` — the domain label on a career site / company page
- `ats-path` — the company segment in a known ATS URL (Greenhouse, Lever, …)
- `gmail-subject` — parsed from the open email's subject (the tab title) on Gmail
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
import {
  injectDetailButtons,
  autoEmit,
  refreshStates,
  renderJob,
} from "../../../engine.js";

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
      cards.push(card);
    });
    return cards;
  },
};
```

Then register the host so the content script is injected there. Add the match glob to a `hosts.json` next to your adapter:

`src/adapters/local/hosts.json`:

```json
["https://jobs.myboard.com/*"]
```

Rebuild (`pnpm build`) and reload. That's the whole loop: **drop a file + a host line + rebuild.** No edits to the shared engine.

- `platform` is a free-form string on the server — a new adapter needs **zero server changes**.
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
