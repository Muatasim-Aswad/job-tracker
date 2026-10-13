#!/usr/bin/env python3
"""Scan one clean committed candidate and its verified release artifacts locally."""

import argparse
import hashlib
import json
import os
import posixpath
import re
import runpy
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from contextlib import ExitStack
from pathlib import Path, PurePosixPath


class ScanError(Exception):
    pass


def run(command, *, cwd, env=None):
    result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, check=False)
    if result.returncode:
        raise ScanError(
            f"{Path(command[0]).name} failed (exit {result.returncode}); output withheld"
        )
    return result.stdout


def git(source, *args):
    return run(
        [
            "git",
            "--no-replace-objects",
            "-c",
            "core.fsmonitor=false",
            "-C",
            str(source),
            *args,
        ],
        cwd=source,
    )


def safe_path(name, *, directory=False):
    if (
        name.startswith("/")
        or "\\" in name
        or ":" in name
        or any(ord(c) < 32 for c in name)
    ):
        raise ScanError("unsafe archive path")
    if directory and name in (".", "./"):
        return None
    while name.startswith("./"):
        name = name[2:]
    name = name.rstrip("/") if directory else name
    if directory and name == ".":
        return None
    parts = name.split("/")
    if not name or any(part in ("", ".", "..") for part in parts):
        raise ScanError("unsafe archive path")
    return PurePosixPath(name).as_posix()


def forbidden_path(name, *, artifact=False):
    parts = PurePosixPath(name).parts
    if any(
        part in (".git", "node_modules", "__pycache__")
        or (
            part == "local"
            and (artifact or not name.startswith("templates/private-overlay/"))
        )
        or part.endswith(".local.md")
        or (".env" in part and (artifact or not part.endswith(".env.example")))
        or re.search(r"\.(?:db|sqlite|sqlite3)(?:$|[.-])", part)
        for part in parts
    ) or name.startswith("docs/plans/"):
        return True
    return artifact and any(
        part in ("tests", "fixtures")
        or "fixture" in part
        or part.endswith((".pyc", ".map"))
        for part in parts
    )


def archive_members(archive, *, source_inventory=None):
    members = []
    seen = set()
    files = set()
    total = 0
    entries = (
        archive.getmembers()
        if isinstance(archive, tarfile.TarFile)
        else archive.infolist()
    )
    for entry in entries:
        if isinstance(entry, tarfile.TarInfo):
            directory = entry.isdir()
            name = safe_path(entry.name, directory=directory)
            if entry.issym() and source_inventory is not None:
                target = entry.linkname
                if (
                    source_inventory.get(name) != b"120000"
                    or target.startswith("/")
                    or "\\" in target
                    or ":" in target
                    or any(ord(c) < 32 for c in target)
                ):
                    raise ScanError("unsafe source link")
                target = posixpath.normpath(
                    posixpath.join(posixpath.dirname(name), target)
                )
                if source_inventory.get(target) not in (b"100644", b"100755"):
                    raise ScanError(
                        "source link must target a tracked public regular file"
                    )
                try:
                    entry = archive.getmember(target)
                except KeyError as error:
                    raise ScanError(
                        "source link target is missing from export"
                    ) from error
                if not entry.isreg():
                    raise ScanError("source link target is not regular")
            elif source_inventory is not None and not directory:
                if source_inventory.get(name) == b"120000":
                    raise ScanError("source link differs from tracked inventory")
            if not (directory or entry.isreg()) or entry.issparse():
                raise ScanError("archive contains a link or special file")
            size = entry.size
        else:
            directory = entry.is_dir()
            mode = entry.external_attr >> 16
            kind = stat.S_IFMT(mode)
            if kind not in (0, stat.S_IFDIR if directory else stat.S_IFREG):
                raise ScanError("archive contains a link or special file")
            if entry.flag_bits & 1:
                raise ScanError("encrypted archive member")
            name = safe_path(entry.filename, directory=directory)
            size = entry.file_size
        if name in seen:
            raise ScanError("duplicate archive path")
        if directory and size:
            raise ScanError("archive directory contains data")
        seen.add(name)
        if name is None:
            continue
        if not directory:
            files.add(name)
        total += size
        members.append((name, directory, entry))
    if len(members) > 100_000 or total > 2 * 1024**3:
        raise ScanError("archive exceeds extraction limits")
    for name in seen - {None}:
        if any(str(parent) in files for parent in PurePosixPath(name).parents):
            raise ScanError("archive file/directory collision")
    return members


def extract(archive, members, destination):
    destination.mkdir()
    for name, directory, entry in members:
        path = destination / name
        if directory:
            path.mkdir(parents=True, exist_ok=True)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            stream = (
                archive.extractfile(entry)
                if isinstance(archive, tarfile.TarFile)
                else archive.open(entry)
            )
            with stream, path.open("xb") as output:
                shutil.copyfileobj(stream, output)
            if isinstance(entry, tarfile.TarInfo) and entry.mode & 0o111:
                path.chmod(0o755)


def clean_revision(source, revision):
    commit = (
        git(
            source,
            "rev-parse",
            "--verify",
            "--end-of-options",
            f"{revision}^{{commit}}",
        )
        .decode()
        .strip()
    )
    if commit != git(source, "rev-parse", "HEAD").decode().strip():
        raise ScanError("candidate revision must be the checkout HEAD")
    inventory = {}
    for record in git(source, "ls-tree", "-rz", "--full-tree", commit).split(b"\0"):
        if not record:
            continue
        metadata, raw_name = record.split(b"\t", 1)
        mode, kind, _ = metadata.split()
        name = safe_path(os.fsdecode(raw_name))
        if (
            mode not in (b"100644", b"100755", b"120000")
            or kind != b"blob"
            or forbidden_path(name)
        ):
            raise ScanError("candidate tracks a non-public path, link, or submodule")
        inventory[name] = mode
    if git(source, "status", "--porcelain", "--untracked-files=no"):
        raise ScanError("candidate tracked files must be clean")
    return commit, inventory


def snapshot_release(release, destination, version):
    names = {
        f"job-tracker-{version}-linux-x86_64.tar.gz": "runtime",
        f"job-tracker-extension-{version}.zip": "extension",
        f"job_tracker-{version}-py3-none-any.whl": "wheel",
    }
    entries = list(release.iterdir())
    if {p.name for p in entries} != {*names, "SHA256SUMS"} or any(
        not stat.S_ISREG(p.lstat().st_mode) for p in entries
    ):
        raise ScanError("release directory must contain exactly four regular files")
    destination.mkdir()
    for path in entries:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, "rb") as original:
            if not stat.S_ISREG(os.fstat(original.fileno()).st_mode):
                raise ScanError("release input changed to a non-regular file")
            with (destination / path.name).open("xb") as output:
                shutil.copyfileobj(original, output)
    manifest = (destination / "SHA256SUMS").read_bytes()
    hashes = {}
    for line in manifest.decode("ascii").splitlines():
        match = re.fullmatch(r"([0-9a-f]{64}) [ *]([^/\\]+)", line)
        if not match or match[2] not in names or match[2] in hashes:
            raise ScanError("invalid checksum inventory")
        hashes[match[2]] = match[1]
    if set(hashes) != set(names):
        raise ScanError(
            "checksum inventory must cover all three artifacts exactly once"
        )
    for name, expected in hashes.items():
        with (destination / name).open("rb") as artifact:
            if hashlib.file_digest(artifact, "sha256").hexdigest() != expected:
                raise ScanError("artifact checksum mismatch")
    return names, hashlib.sha256(manifest).hexdigest()


def scan_candidate(source, revision, release, scanner, *, source_date_epoch=315532800):
    commit, inventory = clean_revision(source, revision)
    with tempfile.TemporaryDirectory(prefix="job-tracker-scan-") as temporary:
        work = Path(temporary)
        scan = work / "scan"
        scan.mkdir()
        source_tar = work / "source.tar"
        git(source, "archive", "--format=tar", f"--output={source_tar}", commit)
        with tarfile.open(source_tar) as archive:
            members = archive_members(archive, source_inventory=inventory)
            if {name for name, directory, _ in members if not directory} != set(
                inventory
            ):
                raise ScanError("source export differs from exact tracked inventory")
            extract(archive, members, scan / "source")
        exported = scan / "source"
        version = (exported / "VERSION").read_text().strip()
        if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
            raise ScanError("candidate VERSION must be plain SemVer")
        copies = work / "release"
        names, checksum = snapshot_release(release, copies, version)
        artifacts = scan / "artifacts"
        artifacts.mkdir()
        with ExitStack() as stack:
            opened = []
            for name, label in names.items():
                if label == "runtime":
                    archive = stack.enter_context(tarfile.open(copies / name))
                else:
                    archive = stack.enter_context(zipfile.ZipFile(copies / name))
                members = archive_members(archive)
                if any(forbidden_path(path, artifact=True) for path, _, _ in members):
                    raise ScanError("artifact contains a private or developer path")
                opened.append((archive, members, label))
            for archive, members, label in opened:
                extract(archive, members, artifacts / label)
        schema = runpy.run_path(str(exported / "apps/api/app/core/build_info.py"))
        expected = schema["validate_info"](
            {
                "version": version,
                "revision": commit,
                "commit_time": schema["epoch_time"](
                    git(source, "show", "-s", "--format=%ct", commit).decode().strip()
                ),
                "build_time": schema["epoch_time"](str(source_date_epoch)),
                "dev": False,
            },
            version,
        )
        for path in (
            "runtime/BUILD_INFO.json",
            "runtime/apps/web/dist/version.json",
            "extension/version.json",
            "wheel/app/resources/BUILD_INFO.json",
            "wheel/app/resources/apps/web/dist/version.json",
        ):
            try:
                actual = schema["validate_info"](
                    json.loads((artifacts / path).read_text()), version
                )
            except (ValueError, OSError) as error:
                raise ScanError("invalid or missing artifact build identity") from error
            if actual != expected:
                raise ScanError("artifact build identity does not match candidate")
        env = {
            "PATH": os.environ.get("PATH", os.defpath),
            "HOME": str(work / "home"),
            "LC_ALL": "C",
            "APP_IDENTITY_ATTESTED": "1",
            "APP_REVISION": commit,
            "APP_COMMIT_TIME": expected["commit_time"],
            "APP_BUILD_TIME": expected["build_time"],
            "SOURCE_DATE_EPOCH": str(source_date_epoch),
        }
        Path(env["HOME"]).mkdir()
        run(
            ["bash", str(exported / "scripts/check-release-contents.sh"), str(copies)],
            cwd=work,
            env=env,
        )
        ignore = work / "empty-ignore"
        ignore.touch()
        run(
            [
                scanner,
                "dir",
                ".",
                "--redact",
                "--no-banner",
                "--no-color",
                "--ignore-gitleaks-allow",
                "--gitleaks-ignore-path",
                str(ignore),
                "--config",
                str(exported / "scripts/release-scan-gitleaks.toml"),
            ],
            cwd=scan,
            env=env,
        )
        return commit, checksum


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source", type=Path, default=Path(__file__).resolve().parent.parent
    )
    parser.add_argument(
        "--revision",
        required=True,
        help="reviewed candidate commit (must be clean HEAD)",
    )
    parser.add_argument(
        "--release-dir",
        required=True,
        type=Path,
        help="final sanitized four-file release directory",
    )
    parser.add_argument(
        "--source-date-epoch",
        type=int,
        default=315532800,
        help="explicit deterministic build epoch (default: 315532800); environment identity overrides are ignored",
    )
    args = parser.parse_args()
    scanner = os.environ.get("GITLEAKS_BIN") or shutil.which("gitleaks")
    if not scanner:
        parser.error("set GITLEAKS_BIN or install gitleaks on PATH")
    scanner = shutil.which(scanner)
    if not scanner:
        parser.error("GITLEAKS_BIN must name an executable")
    scanner = str(Path(scanner).resolve())
    try:
        commit, checksum = scan_candidate(
            args.source.resolve(),
            args.revision,
            args.release_dir.resolve(),
            scanner,
            source_date_epoch=args.source_date_epoch,
        )
    except (
        ScanError,
        OSError,
        ValueError,
        tarfile.TarError,
        zipfile.BadZipFile,
    ) as error:
        print(f"scan-release: {error}", file=sys.stderr)
        return 1
    print(f"scan-release OK: revision={commit} SHA256SUMS={checksum} (local only)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
