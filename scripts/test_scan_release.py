#!/usr/bin/env python3
"""Synthetic scanner tests; never scan the repository or candidate artifacts."""

import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location(
    "scan_release", Path(__file__).with_name("scan-release.py")
)
scan = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scan)
REVISION = "a" * 40


def tar_bytes(entries, links=None):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        for name, content, kind in entries:
            entry = tarfile.TarInfo(name)
            entry.type = kind
            entry.size = len(content) if kind == tarfile.REGTYPE else 0
            if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                entry.linkname = "../../outside"
            archive.addfile(
                entry, io.BytesIO(content) if kind == tarfile.REGTYPE else None
            )
        for name, target in (links or {}).items():
            entry = tarfile.TarInfo(name)
            entry.type = tarfile.SYMTYPE
            entry.linkname = target
            archive.addfile(entry)
    return output.getvalue()


def zip_bytes(entries):
    output = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(output, "w") as archive:
            for name, content, mode in entries:
                entry = zipfile.ZipInfo(name)
                entry.create_system = 3
                entry.external_attr = mode << 16
                archive.writestr(entry, content)
    return output.getvalue()


class ScanTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="job-tracker-scan-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "checkout"
        self.source.mkdir()
        self.release = self.root / "release"
        self.release.mkdir()
        self.record = self.root / "scanner.json"
        self.checker_record = self.root / "checker"
        self.scanner = self.root / "gitleaks-stub"
        self.scanner.write_text(
            f"#!{sys.executable}\n"
            "import json, os, pathlib, sys\n"
            "root = pathlib.Path(sys.argv[2]).resolve()\n"
            "assert sys.argv[1] == 'dir'\n"
            "assert '--redact' in sys.argv and '--ignore-gitleaks-allow' in sys.argv\n"
            "assert pathlib.Path(sys.argv[sys.argv.index('--config')+1]) == root / 'source/scripts/release-scan-gitleaks.toml'\n"
            "assert not any(k.startswith('GITLEAKS_') for k in os.environ)\n"
            f"assert pathlib.Path({str(self.checker_record)!r}).exists()\n"
            "assert pathlib.Path(os.environ['HOME']).is_relative_to(root.parent)\n"
            "files = {str(p.relative_to(root)): p.read_text() for p in root.rglob('*') if p.is_file()}\n"
            f"pathlib.Path({str(self.record)!r}).write_text(json.dumps(files))\n"
        )
        self.scanner.chmod(0o755)
        self.source_files = {
            "VERSION": b"1.2.0\n",
            "apps/api/app/core/build_info.py": (
                Path(__file__).resolve().parent.parent
                / "apps/api/app/core/build_info.py"
            ).read_bytes(),
            "README.md": b"synthetic public source\n",
            "scripts/release-scan-gitleaks.toml": (
                Path(__file__).with_name("release-scan-gitleaks.toml")
            ).read_bytes(),
            "apps/api/.env.example": b"EXAMPLE_ONLY=true\n",
            "templates/private-overlay/overlay/apps/web/src/platforms/local/example.ts": b"synthetic public scaffold\n",
            "scripts/check-release-contents.sh": (
                f"#!/usr/bin/env bash\nset -euo pipefail\n"
                f'test -f "$1/SHA256SUMS"\n'
                f"printf checked > '{self.checker_record}'\n"
            ).encode(),
        }
        self.runtime = "job-tracker-1.2.0-linux-x86_64.tar.gz"
        self.extension = "job-tracker-extension-1.2.0.zip"
        self.wheel = "job_tracker-1.2.0-py3-none-any.whl"
        self.identity = {
            "version": "1.2.0",
            "revision": REVISION,
            "commit_time": "2025-01-01T00:00:00Z",
            "build_time": "1980-01-01T00:00:00Z",
            "dev": False,
        }
        self.write_artifacts(self.identity)
        self.dirty = False
        self.mode = b"100644"
        self.source_links = {}
        self.export_extra = []
        self.git_patch = patch.object(scan, "git", side_effect=self.git)
        self.git_patch.start()
        self.addCleanup(self.git_patch.stop)

    def write_artifacts(self, identity):
        metadata = json.dumps(identity).encode()
        (self.release / self.runtime).write_bytes(
            tar_bytes(
                [
                    ("VERSION", b"1.2.0\n", tarfile.REGTYPE),
                    ("BUILD_INFO.json", metadata, tarfile.REGTYPE),
                    ("apps/web/dist/version.json", metadata, tarfile.REGTYPE),
                ]
            )
        )
        (self.release / self.extension).write_bytes(
            zip_bytes(
                [
                    ("manifest.json", b"{}", stat.S_IFREG | 0o644),
                    ("version.json", metadata, stat.S_IFREG | 0o644),
                ]
            )
        )
        (self.release / self.wheel).write_bytes(
            zip_bytes(
                [
                    ("app/cli.py", b"synthetic wheel", stat.S_IFREG | 0o644),
                    ("app/resources/BUILD_INFO.json", metadata, stat.S_IFREG | 0o644),
                    (
                        "app/resources/apps/web/dist/version.json",
                        metadata,
                        stat.S_IFREG | 0o644,
                    ),
                ]
            )
        )
        self.write_checksums()

    def write_checksums(self):
        (self.release / "SHA256SUMS").write_text(
            "".join(
                f"{hashlib.sha256((self.release / name).read_bytes()).hexdigest()}  {name}\n"
                for name in (self.runtime, self.extension, self.wheel)
            )
        )

    def git(self, source, *args):
        self.assertEqual(source, self.source)
        if args[0] == "rev-parse":
            return (REVISION + "\n").encode()
        if args[0] == "status":
            self.assertIn("--untracked-files=no", args)
            return b" M README.md\n" if self.dirty else b""
        if args[0] == "show":
            self.assertEqual(args, ("show", "-s", "--format=%ct", REVISION))
            return b"1735689600\n"
        if args[0] == "ls-tree":
            self.assertEqual(args[-1], REVISION)
            return b"".join(
                (b"120000" if name in self.source_links else self.mode)
                + b" blob "
                + b"b" * 40
                + b"\t"
                + name.encode()
                + b"\0"
                for name in (*self.source_files, *self.source_links)
            )
        if args[0] == "archive":
            self.assertEqual(args[-1], REVISION)
            output = Path(
                next(
                    arg.removeprefix("--output=")
                    for arg in args
                    if arg.startswith("--output=")
                )
            )
            output.write_bytes(
                tar_bytes(
                    [
                        (name, content, tarfile.REGTYPE)
                        for name, content in self.source_files.items()
                    ]
                    + self.export_extra,
                    links=self.source_links,
                )
            )
            return b""
        self.fail(f"unexpected Git call: {args}")

    def execute(self):
        return scan.scan_candidate(
            self.source, REVISION, self.release, str(self.scanner)
        )

    def rejected(self, message):
        with self.assertRaisesRegex(scan.ScanError, message):
            self.execute()
        self.assertFalse(self.record.exists())

    def test_exact_export_and_extracted_artifacts_exclude_checkout_state(self):
        for name in (
            ".env",
            "jobtracker.db",
            "adapters/local/secret.txt",
            "untracked.txt",
        ):
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("synthetic ignored value")
        with patch.dict(
            os.environ,
            {
                "GITLEAKS_CONFIG": "/not-read",
                "GITLEAKS_CONFIG_TOML": "not-read",
                "APP_IDENTITY_ATTESTED": "1",
                "APP_REVISION": "b" * 40,
                "APP_BUILD_TIME": "not-read",
                "SOURCE_DATE_EPOCH": "0",
            },
        ):
            commit, checksum = self.execute()
        self.assertEqual(commit, REVISION)
        self.assertEqual(
            checksum,
            hashlib.sha256((self.release / "SHA256SUMS").read_bytes()).hexdigest(),
        )
        files = json.loads(self.record.read_text())
        self.assertEqual(
            set(files),
            {f"source/{name}" for name in self.source_files}
            | {
                "artifacts/runtime/VERSION",
                "artifacts/runtime/BUILD_INFO.json",
                "artifacts/runtime/apps/web/dist/version.json",
                "artifacts/extension/manifest.json",
                "artifacts/extension/version.json",
                "artifacts/wheel/app/cli.py",
                "artifacts/wheel/app/resources/BUILD_INFO.json",
                "artifacts/wheel/app/resources/apps/web/dist/version.json",
            },
        )
        self.assertTrue(
            all("synthetic ignored value" not in value for value in files.values())
        )

    def test_dirty_source_refused_before_export(self):
        self.dirty = True
        self.rejected("must be clean")

    def test_tracked_public_source_link_is_materialized_without_following_checkout(
        self,
    ):
        self.source_links = {"CLAUDE.md": "README.md"}
        (self.source / "CLAUDE.md").symlink_to("/not-read")
        self.execute()
        files = json.loads(self.record.read_text())
        self.assertEqual(files["source/CLAUDE.md"], "synthetic public source\n")

    def test_source_links_require_a_tracked_public_regular_target(self):
        for target in (
            "../outside",
            "/absolute",
            "missing",
            ".env",
            "README.md/child",
            "CLAUDE.md",
            "other-link",
        ):
            with self.subTest(target=target):
                self.source_links = {"CLAUDE.md": target, "other-link": "README.md"}
                self.rejected("source link")

    def test_nested_source_link_can_reference_tracked_parent_file(self):
        self.source_links = {"docs/alias.md": "../README.md"}
        self.execute()
        files = json.loads(self.record.read_text())
        self.assertEqual(files["source/docs/alias.md"], "synthetic public source\n")

    def test_stale_dev_and_wrong_time_artifacts_fail_before_checker_and_scan(self):
        for changed in (
            {"revision": "b" * 40},
            {"revision": "dev", "dev": True, "commit_time": None},
            {"commit_time": "2025-01-02T00:00:00Z"},
            {"build_time": "2000-01-01T00:00:00Z"},
        ):
            with self.subTest(changed=changed):
                self.write_artifacts({**self.identity, **changed})
                self.rejected("does not match candidate")
                self.assertFalse(self.checker_record.exists())

    def test_each_extracted_surface_requires_valid_matching_identity(self):
        for name in (
            "app/resources/BUILD_INFO.json",
            "app/resources/apps/web/dist/version.json",
        ):
            for changed in ({"revision": "b" * 40}, {"build_time": "invalid"}):
                with self.subTest(name=name, changed=changed):
                    self.write_artifacts(self.identity)
                    with zipfile.ZipFile(self.release / self.wheel) as archive:
                        entries = [
                            (e.filename, archive.read(e), e.external_attr >> 16)
                            for e in archive.infolist()
                        ]
                    entries = [
                        (
                            p,
                            json.dumps({**self.identity, **changed}).encode()
                            if p == name
                            else content,
                            mode,
                        )
                        for p, content, mode in entries
                    ]
                    (self.release / self.wheel).write_bytes(zip_bytes(entries))
                    self.write_checksums()
                    self.rejected("identity")
                    self.assertFalse(self.checker_record.exists())

    def test_explicit_deterministic_epoch_is_required_for_nondefault_build_time(self):
        self.write_artifacts({**self.identity, "build_time": "2000-01-01T00:00:00Z"})
        self.rejected("does not match candidate")
        commit, _ = scan.scan_candidate(
            self.source,
            REVISION,
            self.release,
            str(self.scanner),
            source_date_epoch=946684800,
        )
        self.assertEqual(commit, REVISION)

    def test_non_head_revision_refused(self):
        with patch.object(scan, "git", side_effect=[b"b" * 40, REVISION.encode()]):
            self.rejected("must be the checkout HEAD")

    def test_tracked_private_files_and_links_refused(self):
        for name in (
            "apps/api/.env",
            "apps/api/jobtracker.db",
            "apps/web/src/platforms/local/private.ts",
            "docs/plans/private.md",
        ):
            with self.subTest(name=name):
                self.source_files[name] = b"not exported"
                self.rejected("non-public")
                del self.source_files[name]
        self.mode = b"120000"
        self.rejected("link")

    def test_source_archive_inventory_must_match_git_tree(self):
        self.export_extra = [("extra.txt", b"extra", tarfile.REGTYPE)]
        self.rejected("exact tracked inventory")

    def test_checksum_failure_prevents_extraction_and_checker(self):
        (self.release / self.wheel).write_bytes(b"tampered")
        self.rejected("checksum mismatch")
        self.assertFalse(self.checker_record.exists())

    def test_checksum_inventory_refuses_missing_duplicate_and_unsafe_entries(self):
        manifest = self.release / "SHA256SUMS"
        original = manifest.read_text()
        for text in (
            original.splitlines()[0] + "\n",
            original + original.splitlines()[0] + "\n",
            original.replace(self.wheel, "../outside"),
        ):
            with self.subTest(text=text[:20]):
                manifest.write_text(text)
                self.rejected("checksum inventory")

    def test_release_inventory_refuses_extra_files_and_links(self):
        extra = self.release / "extra"
        extra.write_text("extra")
        self.rejected("exactly four regular files")
        extra.unlink()
        wheel = self.release / self.wheel
        wheel.unlink()
        wheel.symlink_to(self.release / self.extension)
        self.rejected("exactly four regular files")

    def test_unsafe_tar_entries_rejected_before_any_artifact_extraction(self):
        invalid = (
            [
                [(name, b"bad", tarfile.REGTYPE)]
                for name in (
                    "../escape",
                    "/absolute",
                    "dir/../escape",
                    "C:/escape",
                    "dir\\escape",
                )
            ]
            + [
                [("VERSION", b"bad", kind)]
                for kind in (
                    tarfile.SYMTYPE,
                    tarfile.LNKTYPE,
                    tarfile.FIFOTYPE,
                    tarfile.CHRTYPE,
                )
            ]
            + [
                [
                    ("VERSION", b"a", tarfile.REGTYPE),
                    ("./VERSION", b"b", tarfile.REGTYPE),
                ],
                [
                    ("parent", b"a", tarfile.REGTYPE),
                    ("parent/child", b"b", tarfile.REGTYPE),
                ],
                [("./", b"", tarfile.DIRTYPE), (".", b"", tarfile.DIRTYPE)],
                [("/", b"", tarfile.DIRTYPE)],
            ]
        )
        for entries in invalid:
            with self.subTest(entries=entries):
                (self.release / self.runtime).write_bytes(tar_bytes(entries))
                self.write_checksums()
                self.rejected("archive")
                self.assertFalse(self.checker_record.exists())

    def test_unsafe_zip_entries_rejected_before_runtime_extraction(self):
        invalid = (
            [
                [(name, b"bad", stat.S_IFREG | 0o644)]
                for name in (
                    "../escape",
                    "/absolute",
                    "dir/../escape",
                    "C:/escape",
                    "dir\\escape",
                )
            ]
            + [
                [("bad", b"../../outside", kind | 0o644)]
                for kind in (stat.S_IFLNK, stat.S_IFIFO, stat.S_IFCHR)
            ]
            + [[("same", b"a", stat.S_IFREG), ("./same", b"b", stat.S_IFREG)]]
        )
        original_extract = scan.extract
        for entries in invalid:
            with self.subTest(entries=entries):
                (self.release / self.wheel).write_bytes(zip_bytes(entries))
                self.write_checksums()
                with patch.object(
                    scan, "extract", wraps=original_extract
                ) as extraction:
                    self.rejected("archive")
                    self.assertEqual(extraction.call_count, 1)
                self.assertFalse(self.checker_record.exists())

    def test_private_artifact_paths_refused(self):
        for name in (
            "apps/api/.env",
            "apps/api/.env.example",
            "apps/api/jobtracker.db",
            "apps/api/app/local/private.py",
            "apps/api/tests/fixture.py",
            "apps/web/dist/asset.js.map",
        ):
            with self.subTest(name=name):
                (self.release / self.runtime).write_bytes(
                    tar_bytes([(name, b"not extracted", tarfile.REGTYPE)])
                )
                self.write_checksums()
                self.rejected("private or developer")

    def test_valid_root_directory_and_zip_directory_entries(self):
        (self.release / self.runtime).write_bytes(
            tar_bytes(
                [
                    ("./", b"", tarfile.DIRTYPE),
                    ("./apps/", b"", tarfile.DIRTYPE),
                    ("./apps/api/", b"", tarfile.DIRTYPE),
                    ("./apps/api/app/", b"", tarfile.DIRTYPE),
                    ("./apps/api/app/main.py", b"synthetic runtime", tarfile.REGTYPE),
                    (
                        "./BUILD_INFO.json",
                        json.dumps(self.identity).encode(),
                        tarfile.REGTYPE,
                    ),
                    (
                        "./apps/web/dist/version.json",
                        json.dumps(self.identity).encode(),
                        tarfile.REGTYPE,
                    ),
                ]
            )
        )
        (self.release / self.extension).write_bytes(
            zip_bytes(
                [
                    ("assets/", b"", stat.S_IFDIR | 0o755),
                    ("assets/app.js", b"synthetic extension", stat.S_IFREG | 0o644),
                    (
                        "version.json",
                        json.dumps(self.identity).encode(),
                        stat.S_IFREG | 0o644,
                    ),
                ]
            )
        )
        self.write_checksums()
        self.execute()
        files = json.loads(self.record.read_text())
        self.assertEqual(
            files["artifacts/runtime/apps/api/app/main.py"], "synthetic runtime"
        )
        self.assertEqual(
            files["artifacts/extension/assets/app.js"], "synthetic extension"
        )

    def test_content_checker_failure_prevents_scan_and_hides_output(self):
        self.source_files["scripts/check-release-contents.sh"] = (
            b"echo synthetic-sensitive-checker-output >&2\nexit 7\n"
        )
        self.rejected("bash failed \\(exit 7\\); output withheld")

    def test_scanner_failure_is_fatal_and_hides_output(self):
        self.scanner.write_text(
            "#!/bin/sh\necho synthetic-sensitive-scanner-output >&2\nexit 1\n"
        )
        self.rejected("gitleaks-stub failed \\(exit 1\\); output withheld")

    def test_cli_honors_explicit_scanner_binary(self):
        with (
            patch.dict(os.environ, {"GITLEAKS_BIN": str(self.scanner)}),
            patch.object(
                sys,
                "argv",
                [
                    "scan-release.py",
                    "--source",
                    str(self.source),
                    "--revision",
                    REVISION,
                    "--release-dir",
                    str(self.release),
                ],
            ),
            patch("sys.stdout", new_callable=io.StringIO) as output,
        ):
            self.assertEqual(scan.main(), 0)
            self.assertIn(f"revision={REVISION}", output.getvalue())


@unittest.skipUnless(
    os.environ.get("GITLEAKS_BIN"),
    "explicit scanner required for synthetic policy checks",
)
class GitleaksPolicyTests(unittest.TestCase):
    def test_public_key_exception_preserves_secret_detection_at_same_paths(self):
        root = Path(__file__).resolve().parent.parent
        key = re.search(
            r'  key: "([^"]+)"',
            (root / "apps/extension/manifest.config.ts").read_text(),
        )[1]
        with tempfile.TemporaryDirectory(
            prefix="job-tracker-policy-test-"
        ) as temporary:
            work = Path(temporary)
            target = work / "scan"
            public = {
                "source/apps/extension/manifest.config.ts": f'key: "{key}"; // gitleaks:allow\n',
                "artifacts/extension/manifest.json": json.dumps({"key": key}) + "\n",
            }
            ignore = work / "empty-ignore"
            ignore.touch()
            command = [
                os.environ["GITLEAKS_BIN"],
                "dir",
                ".",
                "--redact",
                "--no-banner",
                "--ignore-gitleaks-allow",
                "--gitleaks-ignore-path",
                str(ignore),
                "--config",
                str(root / "scripts/release-scan-gitleaks.toml"),
            ]

            def execute(files):
                shutil.rmtree(target, ignore_errors=True)
                for name, content in files.items():
                    path = target / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(content)
                return subprocess.run(
                    command,
                    cwd=target,
                    env={"PATH": os.defpath, "HOME": str(work)},
                    capture_output=True,
                ).returncode

            self.assertEqual(execute(public), 0)
            control = hashlib.sha256(b"synthetic policy fixture").hexdigest()
            synthetic = f'api_key = "{control}"; // gitleaks:allow\n'
            for name in public:
                with self.subTest(name=name):
                    self.assertEqual(
                        execute({**public, name: public[name] + synthetic}), 1
                    )
            self.assertEqual(execute({**public, "other.ts": f'key: "{key}";\n'}), 1)
            for nested in (
                "source/scan/source/apps/extension/manifest.config.ts",
                "artifacts/scan/artifacts/extension/manifest.json",
            ):
                with self.subTest(nested=nested):
                    self.assertEqual(execute({**public, nested: f'key: "{key}";\n'}), 1)
            changed = {
                **public,
                "artifacts/extension/manifest.json": json.dumps(
                    {"key": key[:-1] + "C"}
                ),
            }
            self.assertEqual(execute(changed), 1)


if __name__ == "__main__":
    unittest.main()
