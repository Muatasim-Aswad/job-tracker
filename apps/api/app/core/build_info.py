"""Public build identity; installed artifacts never consult Git or user settings."""

from __future__ import annotations

import json
import os
import re
import subprocess
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import TypedDict, cast

_GIT_ERRORS = (OSError, subprocess.SubprocessError)


class BuildInfo(TypedDict):
    version: str
    revision: str
    commit_time: str | None
    build_time: str
    dev: bool


def epoch_time(epoch: str) -> str:
    if not epoch.isdecimal():
        raise ValueError("SOURCE_DATE_EPOCH must be a nonnegative integer")
    return datetime.fromtimestamp(int(epoch), UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def validate_info(value: object, version: str) -> BuildInfo:
    if re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version) is None:
        raise ValueError("invalid product version")
    if not isinstance(value, dict) or set(value) != {
        "version",
        "revision",
        "commit_time",
        "build_time",
        "dev",
    }:
        raise ValueError("invalid build identity fields")
    if value["version"] != version or type(value["dev"]) is not bool:
        raise ValueError("build identity disagrees with product version")
    revision = value["revision"]
    if not isinstance(revision, str) or (
        revision != "dev" and re.fullmatch(r"[0-9a-f]{40,64}", revision) is None
    ):
        raise ValueError("invalid public build revision")
    if value["dev"] != (revision == "dev"):
        raise ValueError("build dev state disagrees with revision")
    for key in ("commit_time", "build_time"):
        timestamp = value[key]
        if key == "commit_time" and value["dev"] and timestamp is None:
            continue
        if (
            not isinstance(timestamp, str)
            or re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", timestamp) is None
        ):
            raise ValueError("invalid public build timestamp")
        datetime.strptime(timestamp, "%Y-%m-%dT%H:%M:%SZ")
    if value["dev"] and value["commit_time"] is not None:
        raise ValueError("dev builds cannot claim a verified commit time")
    return cast(BuildInfo, value)


def source_info(root: Path, environ: Mapping[str, str] | None = None) -> BuildInfo:
    environment = os.environ if environ is None else environ
    version = (root / "VERSION").read_text().strip()
    if re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version) is None:
        raise ValueError("invalid product version")
    build_time = epoch_time(environment.get("SOURCE_DATE_EPOCH", "315532800"))
    dev: BuildInfo = {
        "version": version,
        "revision": "dev",
        "commit_time": None,
        "build_time": build_time,
        "dev": True,
    }
    attested = None
    if environment.get("APP_IDENTITY_ATTESTED") == "1":
        attested = validate_info(
            {
                "version": version,
                "revision": environment.get("APP_REVISION", ""),
                "commit_time": environment.get("APP_COMMIT_TIME") or None,
                "build_time": environment.get("APP_BUILD_TIME", ""),
                "dev": environment.get("APP_REVISION") == "dev",
            },
            version,
        )
        if attested["build_time"] != build_time:
            raise ValueError("APP_BUILD_TIME disagrees with SOURCE_DATE_EPOCH")
    # Do not accidentally inherit a parent checkout's identity for an export.
    if not (root / ".git").exists():
        return attested or dev
    try:

        def git(*args: str) -> str:
            return subprocess.check_output(
                ["git", "-C", str(root), *args], stderr=subprocess.DEVNULL, text=True, timeout=5
            ).strip()

        if Path(git("rev-parse", "--show-toplevel")).resolve() != root.resolve():
            return dev
        try:
            revision = git("rev-parse", "--verify", "HEAD")
        except subprocess.CalledProcessError:
            # A tracked export can have a temporary index, but no original Git commit.
            return attested or dev
        if git("status", "--porcelain", "--untracked-files=normal"):
            return dev
        commit_time = epoch_time(git("show", "-s", "--format=%ct", "HEAD"))
        result = validate_info(
            {**dev, "revision": revision, "commit_time": commit_time, "dev": False}, version
        )
        if attested is not None and attested != result:
            raise ValueError("attested identity disagrees with the original source commit")
        return result
    except _GIT_ERRORS:
        return dev


def installed_info(root: Path, *, packaged: bool, allow_git: bool = True) -> BuildInfo:
    version = (root / "VERSION").read_text().strip()
    metadata = root / "BUILD_INFO.json"
    if packaged and metadata.is_file():
        return validate_info(json.loads(metadata.read_text()), version)
    if packaged:
        raise ValueError("packaged application is missing BUILD_INFO.json")
    if allow_git:
        return source_info(root)
    return validate_info(
        {
            "version": version,
            "revision": "dev",
            "commit_time": None,
            "build_time": epoch_time("315532800"),
            "dev": True,
        },
        version,
    )
