# Server hang investigation — 2026-09-09

The running checkout was `8290c1f`, including `620fe59` (bounded Turso sync shutdown), with local-first Turso enabled, a 10-second HTTP socket-progress timeout, and 60-second periodic pulls.

## Observed incident

Local service-journal times (CEST):

- 10:59:59: last completed request before the stall.
- 16:35:34: termination requested; Uvicorn logged “Waiting for connections to close.”
- 16:36:21: systemd began stopping the service.
- 16:37:51: the 90-second systemd stop deadline expired; SIGKILL terminated the process group and the service restarted.

The server had recovered before inspection. Health, dashboard, vocabulary, and statistics requests succeeded. No stack from the original stalled process was available, so its precise cause remains unconfirmed. The logs do establish that request draining prevented Uvicorn from reaching the cleanup changed by `620fe59`.

## Confirmed defect

An isolated process using the installed FastAPI stack, production `get_conn` and `service_factory`, and in-memory SQLite reproduced a worker-pool deadlock. After briefly holding the database lock to accumulate requests, 40 requests completed, but 41 left all 40 workers waiting in `get_conn`. The admitted request held the connection lock while waiting for worker capacity to execute its service or endpoint. The synchronous health route also stalled. No Turso connection or user database was used.

An experimental asynchronous admission queue allowed all 60 requests to finish. The fix retains request serialization and commit/rollback behavior while moving admission outside the worker pool, bounding lock waits, and reporting future stalls. Standard launchers also bound Uvicorn request draining. The regression exercises real dependency scheduling, contention, health responsiveness, rollback, queued cancellation, busy responses, and recovery in a subprocess with an outer timeout.

This fixes a demonstrated failure path consistent with the incident; it does not establish that Turso, network interruption, or a particular browser request triggered this outage. Future timeouts capture thread stacks before restart so another cause can be distinguished.
