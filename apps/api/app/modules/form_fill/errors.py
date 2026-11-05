"""Stable knowledge-conflict codes with the existing exception/HTTP boundary."""

from typing import Literal

from app.shared.errors import ConflictError

type KnowledgeConflictCode = Literal[
    "answer_key_exists",
    "capture_conflict",
    "capture_key_reused",
    "capture_not_current",
    "capture_slot_occupied",
    "mapping_slot_occupied",
    "stale_conflict_set",
    "stale_resolution_context",
    "stale_revision",
]


class KnowledgeConflict(ConflictError):
    def __init__(self, code: KnowledgeConflictCode, current: object) -> None:
        self.code = code
        super().__init__(code, current)
