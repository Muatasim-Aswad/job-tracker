from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from app.core.build_info import installed_info, source_info, validate_info


def _git(root: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def _source(root: Path) -> str:
    (root / "VERSION").write_text("1.2.0\n")
    _git(root, "init", "-q")
    _git(root, "add", "VERSION")
    _git(
        root,
        "-c",
        "user.name=Synthetic",
        "-c",
        "user.email=synthetic@example.invalid",
        "commit",
        "-qm",
        "synthetic build source",
    )
    return _git(root, "rev-parse", "HEAD")


def test_clean_source_dirty_source_and_untracked_inputs(tmp_path: Path) -> None:
    revision = _source(tmp_path)
    info = source_info(tmp_path, {})
    assert info["revision"] == revision
    assert info["dev"] is False
    assert info["commit_time"] is not None
    assert info["build_time"] == "1980-01-01T00:00:00Z"
    assert source_info(tmp_path, {}) == info
    (tmp_path / "untracked-public.txt").write_text("synthetic")
    assert source_info(tmp_path, {})["revision"] == "dev"
    (tmp_path / "untracked-public.txt").unlink()
    (tmp_path / "VERSION").write_text("1.2.1\n")
    assert source_info(tmp_path, {})["commit_time"] is None


def test_exports_require_attested_original_identity(tmp_path: Path) -> None:
    original = tmp_path / "original"
    original.mkdir()
    _source(original)
    info = source_info(original, {})
    export = tmp_path / "export"
    export.mkdir()
    (export / "VERSION").write_text("1.2.0\n")
    assert source_info(export, {})["dev"] is True
    fields = {
        "APP_IDENTITY_ATTESTED": "1",
        "APP_REVISION": info["revision"],
        "APP_COMMIT_TIME": info["commit_time"] or "",
        "APP_BUILD_TIME": info["build_time"],
    }
    assert source_info(export, fields) == info
    _git(export, "init", "-q")
    _git(export, "add", "VERSION")
    assert source_info(export, fields) == info
    fields["APP_BUILD_TIME"] = "2000-01-01T00:00:00Z"
    with pytest.raises(ValueError, match="SOURCE_DATE_EPOCH"):
        source_info(export, fields)


def test_installed_identity_needs_no_git_and_rejects_corrupt_metadata(tmp_path: Path) -> None:
    (tmp_path / "VERSION").write_text("1.2.0\n")
    info = source_info(tmp_path, {})
    (tmp_path / "BUILD_INFO.json").write_text(json.dumps(info))
    assert installed_info(tmp_path, packaged=True, allow_git=False) == info
    with pytest.raises(ValueError, match="product version"):
        validate_info({**info, "version": "9.8.7"}, "1.2.0")
    with pytest.raises(ValueError, match="revision"):
        validate_info({**info, "revision": "private/string"}, "1.2.0")
    (tmp_path / "BUILD_INFO.json").unlink()
    with pytest.raises(ValueError, match="missing"):
        installed_info(tmp_path, packaged=True)


def test_version_endpoint_is_uncached_head_safe_and_outside_schema(client: object) -> None:
    get = client.get("/version.json")  # type: ignore[attr-defined]
    head = client.head("/version.json")  # type: ignore[attr-defined]
    assert get.status_code == head.status_code == 200
    assert get.headers["cache-control"] == head.headers["cache-control"] == "no-store"
    assert head.content == b""
    assert head.headers["content-length"] == get.headers["content-length"]
    assert set(get.json()) == {"version", "revision", "commit_time", "build_time", "dev"}
    assert "/version.json" not in client.get("/openapi.json").json()["paths"]  # type: ignore[attr-defined]
    assert client.get("/health").json()["revision"] == get.json()["revision"]  # type: ignore[attr-defined]
