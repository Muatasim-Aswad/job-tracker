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

The **Form Fill** view opens a question-centered **Review inbox**. Each exact Question appears once when it needs a Match or has a current Capture, including differing Captures on active Matches. Search includes prompt, section, and help; rows show context and choice counts so similar variants remain distinguishable. **Include questions already handled** also exposes existing Matches. The inbox refreshes every two seconds while visible.

**Saved answers** defaults to active Answers; paused Answers have a separate filter and distinct styling. Collection reads never fetch Answer values. Searchable, paginated Answer pickers rank similar names within loaded compatible results and fetch the selected Answer detail for a value and fill-policy preview. Choice labels are resolved from the Question options or Answer vocabulary; missing options show a readable unavailable label, never an opaque ID.

Review shows the old and proposed values, fill behavior, affected Questions, and complete choice bindings. Identical, unambiguous option labels receive suggested one-to-one bindings, which remain editable and require explicit review. Incomplete binding sets open automatically and support search and an unmatched-only filter; complete long sets and Answer vocabularies start collapsed. Drawers keep save actions visible and offer **Save and review next** in the inbox.

**Dismissed** exposes muted Questions and ignored Capture history. Questions can be reopened. Dismissing a Capture explicitly clears its retained value; that value cannot be restored, so its detail links to the Question and explains how to remember a fresh value. Pausing a Match, retiring it, and dismissing a Question remain separate domain operations described in plain language.

All mutations use expected revisions. A `409` preserves the draft and offers review, copy, and discard choices without automatic retry. Applying a Capture remains an explicit create/update/retarget/rebind operation; Match-only saving consumes one identical non-conflicting Capture and leaves a differing Capture pending. Conflicts require an explicit winner from the complete current Capture set. Changing a draft or relevant revision invalidates its review, including description and fill-policy changes.

Drawers confirm before discarding unsaved edits on close, internal navigation, or browser history navigation; browser reload and tab closure use the native unsaved-change warning. Drafts remain in memory rather than persistent browser storage. Values and optional details precede advanced identifiers; automatic keys follow the name until customized.

Creating an Answer from Question detail locks its compatible value type and active choice vocabulary, then creates the Answer and Match atomically. Answer-owned labels, descriptions, values, and fill policies stay editable.

Form-fill URLs contain only enum view state and opaque Answer, Capture, or Question IDs. Filters and opaque cursors are the only list query data; prompts and values never enter the URL or browser history. Success toasts and the global error path are value-free, and detail cache entries are removed when their drawers close.

Workspace-wide architecture and conventions are documented in [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).
