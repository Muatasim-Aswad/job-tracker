# Security

## Supported versions

Security fixes are provided for the latest versioned release and the current code on the `main` branch. Update to the newest release or revision before reporting an issue that may already be fixed.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting for this repository. Include the affected component, reproduction steps, impact, and any suggested mitigation. For ordinary defects, use the public issue tracker.

## Deployment boundary

Job Tracker supports a single user running the server on localhost. Its default host binding, trusted-host checks, and CORS allowlist reduce exposure, but none of them authenticate anyone.

The optional `API_KEY` is meant for scripts, or a trusted intermediary that injects `X-API-Key`. The dashboard and extension never send that header, and the key is not a user-authentication system.

Exposing the server beyond localhost requires security work this project does not supply: TLS, real authentication and authorization, secret management, network access controls, rate limiting, logging and monitoring, backups, and timely patching of the host and dependencies. Put any deliberate remote deployment behind a VPN or authenticated reverse proxy, and assess it against your own threat model.
