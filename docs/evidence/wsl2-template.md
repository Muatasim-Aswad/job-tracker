# WSL2 runtime validation evidence template

Copy this template to an approved evidence location and complete it without personal job, browser, credential, database, or log data. A blank or failed item means the candidate release lacks complete WSL2 approval evidence.

## Environment

| Field                              | Value |
| ---------------------------------- | ----- |
| Date (UTC)                         |       |
| Runtime version                    |       |
| Runtime artifact filename          |       |
| Runtime SHA-256                    |       |
| Extension ZIP filename and SHA-256 |       |
| Windows edition/build              |       |
| WSL version                        |       |
| Linux distribution/version         |       |
| Architecture                       |       |
| Windows Chromium browser/version   |       |
| Localhost forwarding observation   |       |

## Results

| Step | Pass / fail / skipped | Non-sensitive evidence or reason |
| --- | --- | --- |
| Artifact checksum verified in Linux filesystem |  |  |
| Active mutable roots are outside `/mnt/c` |  |  |
| `validate-wsl2.sh` lifecycle harness |  |  |
| Packaged paths and private permissions |  |  |
| Startup, readiness, dashboard, and clean shutdown |  |  |
| Persistence across application-file replacement |  |  |
| Offline backup and restore to a recovery target |  |  |
| Windows-host localhost reachability |  |  |
| Windows Chromium loaded the versioned extension ZIP |  |  |
| Extension called the localhost API |  |  |
| Extension captured a synthetic listing |  |  |
| Persistence and browser reconnection after `wsl --shutdown` |  |  |

## Conclusion

The candidate release is not approved for the supported Windows 11 WSL2 x86_64 path unless every required result is recorded as pass and the evidence is reviewed. Notes:
