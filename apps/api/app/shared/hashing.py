"""Stable hashing for change-detection. `stable_hash` backs the event-log novelty
rule, but is generic: an order-independent hash of an optional dict, treating
`None` and `{}` alike as absent."""

import hashlib
import json
from typing import Any


def stable_hash(value: dict[str, Any] | None) -> str | None:
    """Order-independent sha256 of a dict, `None`/`{}` → `None`. Canonicalizing on
    sorted keys is what makes semantically-equal dicts hash equal."""
    if not value:  # None or {} both mean "nothing here"
        return None
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()
