"""Stable identity conflicts preserve existing exception and HTTP behavior."""

from typing import Literal

from app.shared.errors import ConflictError


class IdentityConflict(ConflictError):
    def __init__(
        self, code: Literal["false_match_conflict", "job_merged"], current: dict[str, object]
    ) -> None:
        self.code = code
        super().__init__(code, current)
