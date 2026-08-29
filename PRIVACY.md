# Privacy

Job Tracker is a self-hosted personal tool. It has no third-party analytics, advertising SDKs, or developer-operated telemetry service. The browser extension sends data only to the Job Tracker server address compiled into it (localhost by default).

## Browser permissions

- **Site access for LinkedIn and Gmail** lets the content script identify supported job pages and LinkedIn job emails, add tracker controls, and capture a listing when applicable.
- **Access to the configured `/api/*` origin** lets the extension read and update your tracker.
- **Storage** keeps extension preferences, including keyword rules and the diagnostics opt-in.
- **Active tab** lets the popup derive a suggested company search from the page you opened it on.
- **Scripting** and **web navigation** restore the controls after supported sites replace a page during in-app navigation.
- **Alarms** periodically check whether your configured server is reachable.

The extension reads supported pages' visible job-card and job-detail content. For LinkedIn captures this can include the platform listing ID and URL, external application URL, title, company and company URL, location, workplace/apply type, salary, posting date, fit indicators, and job-description text. On Gmail, it inspects rendered content in the browser to recognize supported LinkedIn job messages and extract the structured job and action data needed by the tracker. It does not send or store the email body as a job description. Manually entered jobs and notes contain exactly what you submit.

On LinkedIn Easy Apply, the extension reads visible question prompts, section and help text, supported control characteristics, option labels, and whether a control is already non-empty. Resolution requests do not contain the control's current value. A value is sent only after a trusted user change settles, after you explicitly choose **Remember existing**, or as a value-free clear. Verified Answers returned for filling exist in the page's runtime memory and in the form control they fill, but are not saved to browser storage. The only form-fill browser settings are the on/off and summary expanded/collapsed Boolean preferences.

Unsupported or ambiguous controls are classified in the page and are not sent in the resolution payload. Job Tracker does not read or write file contents, résumé controls, repeatable profile sections, consent controls, follow-company controls, top-choice controls, or unsupported choices, and it never navigates, reviews, or submits an application.

## Storage and diagnostics

The server stores jobs, listings, events, notes, documents, application-workflow analytics, preferences, form-fill knowledge, and diagnostics in SQLite/libSQL. Application-workflow analytics can include opaque references to agent runs, artifacts, submission evidence, or external resources; the referenced content and agent cost details are not copied into that record. Form-fill knowledge includes verified Answer values and current remembered values awaiting review. The default is a local `apps/api/jobtracker.db` file. Optional Turso modes synchronize that database—including those private values and workflow references—to the Turso account you configure; using Turso means that provider processes and stores the synced database under its own terms.

Form-fill collection and list responses omit private values; a detail request returns a value only when the editor needs it. All form-fill API responses, including errors, use `Cache-Control: no-store`. The clients put only enum view state, opaque resource IDs, filters, and opaque cursors in URLs. Form-fill values are not copied into request paths, headers, browser history state, status toasts, extension error messages, or application history. Server access and validation logs contain method, path, status, and fixed error reasons rather than request bodies. Optional lifecycle reasons are retained metadata, so do not type an Answer or remembered value into a reason field.

Application-workflow responses and errors also use `Cache-Control: no-store`. Their reference locators are retained database content, so callers should use stable opaque identifiers where possible and should not put secrets or credentials in them.

Answer history is value-free. Capture history is also value-free, and a Capture's retained value is removed when it is superseded, cleared, ignored, applied, or loses a resolved conflict. Clearing never creates a reusable empty value. The current Answer value remains until you update it or delete the database; disabling an Answer or Match preserves it and its relationships.

Search diagnostics use a **Never**, **30 minutes**, or **Always** scope. A fresh install uses Never and sends and stores nothing. Both active scopes store the timestamp, page host, automatic seed and extraction rule, the seed's result count, the final query and result count, and clicked job ID. Seed replacement is derived by comparing the seed and final query; a click is derived from the presence of a job ID. Diagnostics remain on your configured Job Tracker server, are capped at the newest 1,000 rows, and can be erased at any time with **Clear stored data** in extension settings. If that database is configured to sync with Turso, the diagnostic rows sync with it as part of the database.

## Backup, deletion, and uninstall

Follow the API's tested [backup and restore procedure](apps/api/README.md#backup--restore) to export the database as a SQLite snapshot. Manual backups, automatic pre-replacement backups, and pre-pull recovery snapshots contain the retained form-fill values present in the source database. Delete every backup or recovery copy as well as the database file (and its `.sync` sibling in local-first mode) to remove local server data. If Turso is configured, deleting local files does not delete the remote database; remove it separately in your Turso account.

Removing the extension deletes its browser-local settings but does **not** delete records already stored by the server. Removing the repository or uninstalling dependencies likewise leaves database and backup files until you delete them explicitly.
