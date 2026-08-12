# macOS 1.1.0 validation evidence

This record contains only non-sensitive release evidence. The source checkout and browser profile were disposable, the browser input was synthetic/non-personal, and no credentials, environment files, existing databases, or personal browser data were read or copied.

## Environment

| Field | Value |
| --- | --- |
| Date | 2026-08-12 |
| Tested source commit | `39d63166cd5e3a782f3962cc54c5490555252949` |
| Product version | `1.1.0` |
| Machine | Physical Intel x86_64 Mac |
| Operating system | macOS 12.7.6, Darwin 21.6.0 |
| Toolchain | Node 22.22.2, pnpm 11.15.0, uv 0.11.28, CPython 3.14.3 |
| Browser | Google Chrome 150.0.7871.125 |
| Extension artifact | `job-tracker-extension-1.1.0.zip` |
| Extension SHA-256 | `087d17cd1447f1a95e547495fbd134d50238658c3669e39d8efde2d1e8a360bd` |

## Results

| Check | Result | Evidence summary |
| --- | --- | --- |
| Transported files, release checksums, and Git bundle | PASS | Every supplied checksum matched and the detached checkout matched the tested source commit. |
| Source setup | PASS | The pinned source toolchain completed `scripts/setup.sh`. |
| Complete macOS source gate | PASS | `scripts/check.sh` skipped only Linux x86_64 artifact production and completed every remaining gate. |
| Source server | PASS | Health and OpenAPI reported 1.1.0; the dashboard loaded and the foreground server stopped cleanly. |
| Exact extension and displayed version | PASS | Chrome loaded the supplied unpacked artifact and displayed version 1.1.0. |
| API connectivity and synthetic capture | PASS | The extension reached localhost, captured a synthetic listing, and the dashboard displayed it. |
| Restart and persistence | PASS | Chrome reconnected after a clean source-server restart and the synthetic listing remained. |

The first full-gate attempt ended in a mypy 2.3.0 internal error. The exact mypy command passed immediately afterward, and an unchanged complete gate rerun passed, so the observation was classified as a non-reproducing tool failure. Locale fallback warnings from the host configuration did not affect checksums, setup, builds, or the successful gate. Chrome provides the required Chromium-family evidence; Edge and Brave were not installed and are alternative supported browsers rather than additional release gates.

## Reviewed conclusion

The evidence supports the macOS source-checkout and public Chromium-extension claims for 1.1.0. It does not claim a packaged macOS runtime or wheel.
