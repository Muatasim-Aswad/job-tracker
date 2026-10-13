#!/usr/bin/env python3
"""Generate untracked identity or explicit original-source export attestation."""

import argparse
import json
import shlex
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps/api"))
from app.core.build_info import source_info  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--format", choices=("json", "shell"), default="json")
    parser.add_argument("--require-release", action="store_true")
    args = parser.parse_args()
    info = source_info(args.root.resolve())
    if args.require_release and info["dev"]:
        parser.error("release attestation requires clean, verified original source")
    if args.format == "shell":
        values = {
            "APP_IDENTITY_ATTESTED": "1", "APP_REVISION": info["revision"],
            "APP_COMMIT_TIME": info["commit_time"] or "", "APP_BUILD_TIME": info["build_time"],
        }
        output = "\n".join(f"export {key}={shlex.quote(value)}" for key, value in values.items()) + "\n"
    else:
        output = json.dumps(info, sort_keys=True, indent=2) + "\n"
    if args.output:
        args.output.write_text(output)
    else:
        print(output, end="")


if __name__ == "__main__":
    main()
