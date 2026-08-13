"""Conservative, versioned identity for exact observed Questions and Options."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

from app.form_fill.schemas import ResolutionField

NORMALIZER_VERSION = 1

_WHITESPACE = re.compile(r"\s+")
_TRAILING_REQUIRED = re.compile(r"(?:\s*\*|\s*\(\s*required\s*\))+$", re.IGNORECASE)
_PUNCTUATION = str.maketrans(
    {
        "‘": "'",
        "’": "'",
        "‛": "'",
        "“": '"',
        "”": '"',
        "‐": "-",
        "‑": "-",
        "‒": "-",
        "–": "-",
        "—": "-",
        "―": "-",
        "…": "...",
    }
)


def normalize_evidence(value: str | None) -> str:
    if value is None:
        return ""
    normalized = unicodedata.normalize("NFKC", value).translate(_PUNCTUATION)
    normalized = _TRAILING_REQUIRED.sub("", normalized.strip())
    return _WHITESPACE.sub(" ", normalized).casefold()


def normalize_token(value: str | None) -> str:
    return normalize_evidence(value)


def _digest(parts: object) -> str:
    encoded = json.dumps(parts, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(encoded.encode()).hexdigest()


@dataclass(frozen=True)
class OptionIdentity:
    client_option_id: str
    normalized_label: str
    raw_label: str
    stable_option_key: str
    status: Literal["active", "disabled"]

    @property
    def key(self) -> tuple[str, str]:
        return self.normalized_label, self.stable_option_key


@dataclass(frozen=True)
class QuestionIdentity:
    signature: str
    identity_kind: str
    site_scope: str
    adapter_id: str
    adapter_version: str
    stable_field_key: str
    control_kind: str
    normalized_question: str
    raw_question: str
    normalized_section: str
    raw_section: str | None
    normalized_help: str
    raw_help: str | None
    autocomplete_token: str
    option_set_hash: str
    options: tuple[OptionIdentity, ...]


def build_identity(
    *, site_scope: str, adapter_id: str, adapter_version: str, field: ResolutionField
) -> QuestionIdentity:
    normalized_question = normalize_evidence(field.prompt)
    normalized_section = normalize_evidence(field.section)
    normalized_help = normalize_evidence(field.help)
    autocomplete_token = normalize_token(field.autocomplete_token)
    stable_field_key = normalize_token(field.stable_field_key)
    options = tuple(
        OptionIdentity(
            client_option_id=option.client_option_id,
            normalized_label=normalize_evidence(option.label),
            raw_label=option.label,
            stable_option_key=normalize_token(option.stable_option_key),
            status="disabled" if option.disabled else "active",
        )
        for option in field.options
    )
    enabled_options = sorted(
        (option.normalized_label, option.stable_option_key)
        for option in options
        if option.status == "active"
    )
    option_set_hash = _digest(enabled_options) if enabled_options else ""
    canonical_scope = normalize_token(site_scope)
    canonical_adapter = normalize_token(adapter_id)
    canonical_adapter_version = normalize_token(adapter_version)
    if stable_field_key:
        identity_kind = "adapter_key"
        signature_parts: object = {
            "normalizer_version": NORMALIZER_VERSION,
            "site_scope": canonical_scope,
            "adapter_id": canonical_adapter,
            "adapter_version": canonical_adapter_version,
            "stable_field_key": stable_field_key,
            "control_kind": field.control_kind,
            "option_set_hash": option_set_hash,
        }
    else:
        identity_kind = "generic_signature"
        signature_parts = {
            "normalizer_version": NORMALIZER_VERSION,
            "site_scope": canonical_scope,
            "control_kind": field.control_kind,
            "normalized_question": normalized_question,
            "normalized_section": normalized_section,
            "normalized_help": normalized_help,
            "autocomplete_token": autocomplete_token,
            "option_set_hash": option_set_hash,
        }
    return QuestionIdentity(
        signature=_digest(signature_parts),
        identity_kind=identity_kind,
        site_scope=canonical_scope,
        adapter_id=canonical_adapter,
        adapter_version=canonical_adapter_version,
        stable_field_key=stable_field_key,
        control_kind=field.control_kind,
        normalized_question=normalized_question,
        raw_question=field.prompt,
        normalized_section=normalized_section,
        raw_section=field.section,
        normalized_help=normalized_help,
        raw_help=field.help,
        autocomplete_token=autocomplete_token,
        option_set_hash=option_set_hash,
        options=options,
    )
