"""Form-fill pagination."""

from __future__ import annotations

import base64
import hashlib
import json
from typing import cast

from app.modules.form_fill.schemas import AnswerSort
from app.modules.form_fill.storage import _json
from app.modules.form_fill.values import QuestionSort
from app.shared.errors import InvalidCursorError


def _filter_fingerprint(filters: object) -> str:
    return hashlib.sha256(_json(filters).encode()).hexdigest()


def _encode_cursor(payload: dict[str, object]) -> str:
    return base64.urlsafe_b64encode(_json(payload).encode()).decode().rstrip("=")


def _cursor_payload(cursor: str) -> dict[str, object]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode())
        if not isinstance(payload, dict):
            raise ValueError

        return cast(dict[str, object], payload)
    except TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError:
        raise InvalidCursorError from None


def _decode_cursor(
    cursor: str, fingerprint: str, sort: QuestionSort | AnswerSort
) -> tuple[object, str]:
    try:
        payload = _cursor_payload(cursor)
        if payload.get("filters") != fingerprint or payload.get("sort") != sort:
            raise ValueError

        value = payload["value"]
        resource_id = payload["id"]
        if sort in ("last_seen", "prompt", "updated_at", "label") and (not isinstance(value, str)):
            raise ValueError

        if sort in ("seen_count", "mapping_count") and (
            not isinstance(value, int) or isinstance(value, bool)
        ):
            raise ValueError

        if not isinstance(resource_id, str):
            raise ValueError

        return (value, resource_id)
    except KeyError, TypeError, ValueError:
        raise InvalidCursorError from None


def _decode_time_cursor(cursor: str, fingerprint: str, sort: str) -> tuple[str, str]:
    try:
        payload = _cursor_payload(cursor)
        if payload.get("filters") != fingerprint or payload.get("sort") != sort:
            raise ValueError

        value, resource_id = (payload["value"], payload["id"])
        if not isinstance(value, str) or not isinstance(resource_id, str):
            raise ValueError

        return (value, resource_id)
    except KeyError, TypeError, ValueError:
        raise InvalidCursorError from None
