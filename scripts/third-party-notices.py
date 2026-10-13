#!/usr/bin/env python3
"""Attribute locked production Python dependencies using their distributed licenses."""

import argparse
import hashlib
import importlib.metadata
import io
import json
import tarfile
import tomllib
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# The locked pyturso wheel/sdist omit their license files. Pin the corresponding
# upstream release's attribution inputs, including its native vendored notices.
TURSO_COMMIT = "046e9cbf67d22491e8ecc941ec2891b02a9f3cad"
TURSO_LICENSES = {
    "LICENSE.md": "b646f9ee8bcaf87e8de75153b9df7a2861c7ac445c87e741768b3c2bccf47bc5",
    "NOTICE.md": "5aa4d5f316afa1fcc8f7a9fae2285e2f9eb35f836826daf368e6cab22a14e72a",
    "licenses/bindings/java/assertj-license.md": "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4",
    "licenses/bindings/java/errorprone-license.md": "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4",
    "licenses/bindings/java/logback-license.md": "a74afe5af3d2be4212df425cf7152e098f66eb02f3fb808a6effb747df7122f4",
    "licenses/bindings/java/spotless-license.md": "f1bf34973df4ab4a756700b3edb42ac344377a2d23c5c2137007a735b5b61a78",
    "licenses/bindings/python/sqlalchemy-mit-license.md": "e862bb5b904fb5513c3e14288d7a25a12eb0ecc7847a0a965d310e9a955e7cb9",
    "licenses/core/crossbeam-skiplist-apache-license.md": "a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2",
    "licenses/core/crossbeam-skiplist-mit-license.md": "5734ed989dfca1f625b40281ee9f4530f91b2411ec01cb748223e7eb87e201ab",
    "licenses/core/libm-mit-license.md": "23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3",
    "licenses/core/pastey-apache-license.md": "27ba0fdfa70b6adf9521f3a1b865cb9347261c018243fa074bab5ff5e54dd188",
    "licenses/core/pastey-mit-license.md": "23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3",
    "licenses/core/serde-apache-license.md": "122686c559146c3946e4ebd3f828a3e6d87ed41b6664772899ff0264b6f28475",
    "licenses/core/serde-mit-license.md": "23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3",
    "licenses/core/serde_json5-license.md": "58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd",
    "licenses/core/windows-apache.license.md": "c16f8dcf1a368b83be78d826ea23de4079fe1b4469a0ab9ee20563f37ff3d44b",
    "licenses/core/windows-mit-license.md": "7ed4b96bdab9fc581e04229c810adef21d1b91af6cce7a02762365406c2d86e3",
    "licenses/extensions/ipnetwork-apache-license.md": "b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1",
    "licenses/extensions/ipnetwork-mit-license.md": "69d42a32f6597af73843e0a4ffb3f3c11cafddf1df85986748c74296450a45ca",
}


def turso_licenses() -> list[tuple[str, str]]:
    def fetch(item: tuple[str, str]) -> tuple[str, str]:
        file, expected = item
        url = f"https://raw.githubusercontent.com/tursodatabase/turso/{TURSO_COMMIT}/{file}"
        with urllib.request.urlopen(url, timeout=30) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError("upstream attribution input checksum mismatch")
        return url, data.decode("utf8")

    with ThreadPoolExecutor(max_workers=8) as pool:
        return sorted(pool.map(fetch, TURSO_LICENSES.items()))


def source_licenses(package: dict) -> list[tuple[str, str]]:
    source = package.get("sdist")
    if not source:
        raise ValueError(f"no license or locked source for {package['name']}")
    with urllib.request.urlopen(source["url"], timeout=30) as response:
        data = response.read()
    if "sha256:" + hashlib.sha256(data).hexdigest() != source["hash"]:
        raise ValueError("locked license source checksum mismatch")
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        result = []
        for member in archive.getmembers():
            relative = Path(member.name).parts[1:]
            if member.isfile() and len(relative) == 1 and relative[0].lower().startswith(
                ("license", "licence", "notice", "copying")
            ):
                stream = archive.extractfile(member)
                if stream:
                    result.append((relative[0], stream.read().decode("utf8")))
        if not result:
            raise ValueError(f"locked source has no license for {package['name']}")
        return sorted(result)


def generate(lock: Path) -> tuple[list[dict], str]:
    packages = tomllib.loads(lock.read_text())["package"]
    by_name = {}
    for package in packages:
        by_name.setdefault(package["name"], []).append(package)
    root = by_name["job-tracker-api"][0]
    pending = list(root["dependencies"])
    seen = set()
    inventory = []
    notices = []
    while pending:
        edge = pending.pop()
        name = edge["name"]
        extras = tuple(edge.get("extra", []))
        if (name, extras) in seen:
            continue
        seen.add((name, extras))
        try:
            dist = importlib.metadata.distribution(name)
        except importlib.metadata.PackageNotFoundError:
            if "marker" in edge:
                continue  # an uninstalled platform-specific dependency is not shipped here
            raise
        candidates = [p for p in by_name[name] if p["version"] == dist.version]
        if len(candidates) != 1:
            raise ValueError(f"installed {name}@{dist.version} disagrees with lock")
        package = candidates[0]
        pending.extend(package.get("dependencies", []))
        for extra in extras:
            pending.extend(package.get("optional-dependencies", {}).get(extra, []))
        if any(item["name"] == name for item in inventory):
            continue
        licenses = []
        for file in dist.files or []:
            if any(part.lower().startswith(("license", "licence", "copying", "notice")) for part in file.parts):
                path = Path(dist.locate_file(file))
                if path.is_file():
                    licenses.append((str(file), path.read_text()))
        if not licenses:
            licenses = (turso_licenses() if (name, dist.version) == ("pyturso", "0.7.2")
                        else source_licenses(package))
        inventory.append({
            "name": name, "version": dist.version,
            "licenses": [{"file": file, "sha256": hashlib.sha256(text.encode()).hexdigest()}
                         for file, text in sorted(licenses)],
        })
        notices.append((name, f"## {name}@{dist.version}\n\n" + "\n".join(
            f"### {file}\n\n{text.strip()}\n" for file, text in sorted(licenses)
        )))
    return sorted(inventory, key=lambda p: p["name"]), (
        "Locked production Python dependency notices\n\n" + "\n".join(text for _, text in sorted(notices))
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lock", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    inventory, notices = generate(args.lock)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "THIRD_PARTY_NOTICES.python.txt").write_text(notices)
    (args.output_dir / "THIRD_PARTY_INVENTORY.python.json").write_text(json.dumps(inventory, indent=2) + "\n")


if __name__ == "__main__":
    main()
