"""The product version, read from the selected application's canonical file.

The extension manifest, API metadata, generated wheel metadata, and `vX.Y.Z`
release tag all derive from that one file, so a release bump is a single edit.
The source `apps/api/pyproject.toml` value is only a checkout placeholder;
`scripts/build-wheel.sh` replaces it in an isolated staging tree.

Read at import rather than copied into a constant: a missing or unreadable
`VERSION` is a broken checkout, and failing loudly beats serving a version that
silently disagrees with the shipped extension.
"""

from app.core.paths import resolve_paths

VERSION_PATH = resolve_paths().version_file

PRODUCT_VERSION = VERSION_PATH.read_text().strip()
