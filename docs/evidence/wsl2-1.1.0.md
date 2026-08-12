# Windows 11 WSL2 1.1.0 validation evidence

This record contains only non-sensitive release evidence. All active state stayed in disposable or retained WSL Linux-filesystem roots, browser input was synthetic/non-personal, and no credentials, environment files, existing databases, personal browser data, usernames, or hostnames are recorded.

## Environment

| Field | Value |
| --- | --- |
| Date | 2026-08-12 |
| Tested source commit | `39d63166cd5e3a782f3962cc54c5490555252949` |
| Product version | `1.1.0` |
| Runtime artifact | `job-tracker-1.1.0-linux-x86_64.tar.gz` |
| Runtime SHA-256 | `4af03f165a406326a666a4847e959743e5ef28400127c08ab9e18726d97bde67` |
| Extension artifact | `job-tracker-extension-1.1.0.zip` |
| Extension SHA-256 | `087d17cd1447f1a95e547495fbd134d50238658c3669e39d8efde2d1e8a360bd` |
| Windows host | Windows 11 Pro 24H2, build 26100.7462, 64-bit |
| WSL | 2.7.11.0, kernel 6.18.33.2-2 |
| Distribution | Ubuntu 26.04 LTS, WSL version 2 |
| Architecture | x86_64 |
| Source toolchain | Node 22.22.2, pnpm 11.15.0, uv 0.11.28, CPython 3.14 |
| Windows browsers | Chrome 151.0.7922.110 and Edge 151.0.4129.78 |
| Localhost forwarding | Windows browsers reached the WSL server on `http://localhost:3456/` |

## Results

| Step | Result | Non-sensitive evidence |
| --- | --- | --- |
| Candidate, artifact, and Git-bundle integrity | PASS | All transported and official checksums matched; the detached checkout matched the tested source commit and remained clean. |
| Source setup and complete gate | PASS | The pinned toolchain completed setup and `scripts/check.sh`; a first attempt identified the previously undocumented `zip` prerequisite, then the complete unchanged gate passed after installation. |
| Normal WSL2 lifecycle harness | PASS | Extraction, permissions, startup, readiness, dashboard, persistence, offline backup, separate-target restore, application replacement, and clean shutdown passed. |
| Retained-profile lifecycle harness | PASS | The retained run passed after its root was placed in persistent WSL ext4 storage rather than tmpfs. |
| Runtime identity | PASS | Health reported version 1.1.0 before and after restart. |
| Windows Chrome extension flow | PASS | The exact artifact loaded, displayed version 1.1.0, reached the API, captured synthetic input, and displayed it in the dashboard. |
| Windows Edge extension flow | PASS | The same artifact loaded, displayed version 1.1.0, reached the API, captured synthetic input, and displayed it in the dashboard. |
| Persistence across `wsl --shutdown` | PASS | A genuine WSL shutdown and fresh boot preserved the synthetic listing in persistent Linux storage; both the API and browser confirmed it after restart. |

The first retained run used the harness's former `/tmp` default, which was tmpfs on this distribution and therefore disappeared during `wsl --shutdown`. The test was repeated with a persistent Linux-filesystem root and passed. The harness now defaults `--keep-work` to the persistent XDG state root and rejects retained roots under `/mnt`. Release preparation now also documents and preflights `zip`.

One startup produced a short burst of duplicate-match reads after the extension page opened before the server was ready. It did not reproduce with normal server-then-extension ordering and did not affect capture or persistence, so it is retained as a non-blocking observation rather than a confirmed defect.

## Reviewed conclusion

Every required lifecycle and Windows-host browser result passed. The evidence supports the Linux x86_64 runtime bundle and public Chromium extension on Windows 11 WSL2 x86_64 when active databases, configuration, state, and backups remain in the WSL Linux filesystem. Native Windows remains unsupported.
