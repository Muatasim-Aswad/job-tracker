"""Read the product version from the selected application root at import time; missing VERSION aborts startup. Release authority and staged wheel metadata are documented in docs/DEVELOPMENT.md."""

from app.core.paths import resolve_paths

VERSION_PATH = resolve_paths().version_file

PRODUCT_VERSION = VERSION_PATH.read_text().strip()
