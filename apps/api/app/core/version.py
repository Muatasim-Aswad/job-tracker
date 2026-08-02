"""The product version, read from the selected application's canonical file.

The extension manifest, the API metadata, and the `vX.Y.Z` release tag all
derive from that one file, so a release bump is a single edit and no component
can declare a version of its own. `apps/api/pyproject.toml`'s version is packaging
metadata that uv requires, not a release authority.

Read at import rather than copied into a constant: a missing or unreadable
`VERSION` is a broken checkout, and failing loudly beats serving a version that
silently disagrees with the shipped extension.
"""

from app.core.paths import resolve_paths

VERSION_PATH = resolve_paths().version_file

PRODUCT_VERSION = VERSION_PATH.read_text().strip()
