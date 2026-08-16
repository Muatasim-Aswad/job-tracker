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

## Form Fill workspace

The **Form Fill** view manages reusable Answers and the **Needs review** queues for provisional Captures and actionable Questions. An active Match removes its Question from that queue unless a Capture conflict still needs a decision; unmatched, disabled, and retired Matches remain actionable. The two review queues refresh every two seconds while the dashboard is visible, and an unqualified review link opens the queue that currently has work. Answer detail is the only Answer collection surface that receives its private value. Question detail exposes its singleton Match, affected Answer relationship, option bindings, sightings, Capture conflict IDs, and value-free lifecycle history.

All mutations use the revision currently shown in the drawer. A `409` keeps the user's draft intact and presents the server's current value-free summary with explicit review, copy, and discard choices; the client does not retry or overwrite optimistically. Applying a Capture is always an explicit create/update/retarget/rebind workflow, while a Match-only save consumes one identical non-conflicting Capture and leaves a differing Capture for review. Competing Captures require an explicit revision-checked winner. Complete option bindings are one-to-one. Answer vocabularies and option-binding sets with more than five entries start collapsed; Answer vocabularies are searchable when expanded, selected choices appear first, and each option-binding selector places its current choice first.

Form-fill URLs contain only enum view state and opaque Answer, Capture, or Question IDs. Filters and opaque cursors are the only list query data; prompts and values never enter the URL or browser history. Success toasts and the global error path are value-free, and detail cache entries are removed when their drawers close.

Workspace-wide architecture and conventions are documented in [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).
