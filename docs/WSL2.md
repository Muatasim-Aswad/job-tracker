# Windows 11 WSL2 x86_64

The Linux x86_64 runtime bundle is supported inside Windows 11 WSL2 on x86_64. Version 1.1.0 was validated with WSL 2.7.11, Ubuntu 26.04 LTS, Chrome, and Edge; the reviewed record is [`docs/evidence/wsl2-1.1.0.md`](evidence/wsl2-1.1.0.md). Native Windows, Git Bash, Windows-mounted active state, and other architectures remain unsupported.

Run this only in the Linux filesystem of a WSL2 distribution. Never store an active SQLite or libSQL database, its `.sync` family, configuration, state, or backups under `/mnt/c`: Windows-mounted filesystems do not provide the locking and filesystem behavior this lifecycle requires. Copy the downloaded runtime archive and `SHA256SUMS` into the Linux filesystem first.

From the repository checkout, run the lifecycle harness with a downloaded release:

```bash
bash scripts/validate-wsl2.sh \
  --artifact ~/Downloads/job-tracker-X.Y.Z-linux-x86_64.tar.gz \
  --extension ~/Downloads/job-tracker-extension-X.Y.Z.zip \
  --checksums ~/Downloads/SHA256SUMS
```

The harness requires `uv`, Bash, `curl`, `tar`, `unzip`, and standard GNU/Linux utilities. `--checksums` is mandatory for a real run. The harness finds the one checksum entry for each exact supplied filename, calculates each supplied runtime/archive path directly, and refuses a mismatch. It also requires the WSL2 kernel marker and `x86_64`, then requires both archive filenames to agree with the extracted runtime `VERSION`. It validates extraction, packaged paths and POSIX permissions, startup/readiness, persistence, offline backup, restore to a separate recovery target, application-file replacement, and clean shutdown. It binds only to `127.0.0.1:34658`; without `--keep-work`, it creates every mutable test root under a disposable Linux temporary directory and removes it on exit. `bash scripts/validate-wsl2.sh --self-test` checks the repository contract without claiming external WSL2 evidence.

After the harness passes, complete the human Windows-host checks in the evidence template:

1. Re-run the harness with `--keep-work` and note the printed retained path as `WSL2_WORK`. This mode stores its retained profile below `${XDG_STATE_HOME:-$HOME/.local/state}/job-tracker-validation`, rather than `/tmp`, so a tmpfs-backed temporary directory cannot erase the persistence evidence during `wsl --shutdown`. The harness rejects a retained root under `/mnt`. Start the published default port only against this retained synthetic profile — never normal user roots:

   ```bash
   env -i PATH="$PATH" HOME="$WSL2_WORK/home" \
     XDG_DATA_HOME="$WSL2_WORK/data" XDG_CONFIG_HOME="$WSL2_WORK/config" \
     XDG_STATE_HOME="$WSL2_WORK/state" JOB_TRACKER_BACKUP_DIR="$WSL2_WORK/backups" \
     UV_CACHE_DIR="$WSL2_WORK/uv-cache" "$WSL2_WORK/app/job-tracker" start --port 3456
   ```

   From Windows Chromium, browse to `http://localhost:3456/`. Modern WSL2 normally forwards localhost automatically; if it does not, record the WSL IP and the Windows/WSL networking configuration instead of exposing the server beyond localhost.

2. Extract the versioned extension ZIP on Windows, open `chrome://extensions`, enable Developer mode, and load the extracted directory. Confirm its version matches the runtime and that its localhost permission is `http://localhost:3456/api/*`.
3. Use a non-personal synthetic listing on a supported public fixture or disposable test page. Confirm the extension reaches the localhost API, captures it, and displays the expected result without recording personal browsing or job data in the evidence.
4. Shut down WSL with `wsl --shutdown`, reopen the same distribution, restart the runtime from Linux storage, and confirm the browser can reconnect and the synthetic listing persists.

Record every result, including a failure or skipped step, in a copy of [`docs/evidence/wsl2-template.md`](evidence/wsl2-template.md). A release is not approved for this supported path until its required artifact and lifecycle evidence has been reviewed.
