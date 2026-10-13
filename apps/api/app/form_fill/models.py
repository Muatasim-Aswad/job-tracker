from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.form_fill.schemas import ControlKind, ReviewState


@dataclass(frozen=True)
class Question:
    id: str
    signature: str
    identity_kind: Literal["generic_signature", "adapter_key"]
    site_scope: str
    adapter_id: str
    adapter_version: str
    stable_field_key: str
    normalizer_version: int
    control_kind: ControlKind
    normalized_question: str
    raw_question: str
    normalized_section: str
    raw_section: str | None
    normalized_help: str
    raw_help: str | None
    autocomplete_token: str
    option_set_hash: str
    review_state: ReviewState
    revision: int
    capture_conflict: bool
    last_unresolved_reason: str | None
    seen_count: int
    last_seen_scan_id: str
    first_seen_at: str
    last_seen_at: str


@dataclass(frozen=True)
class QuestionOption:
    id: str
    question_id: str
    normalized_label: str
    raw_label: str
    stable_option_key: str
    status: Literal["active", "disabled"]
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class QuestionPage:
    items: list[Question]
    has_more: bool
