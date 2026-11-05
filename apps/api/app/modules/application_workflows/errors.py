"""A singular workflow cannot be collapsed by an ownership move."""

from typing import Literal

from app.shared.errors import ConflictError


class WorkflowConflict(ConflictError):
    def __init__(
        self, code: Literal["application_workflow_conflict"], current: dict[str, object]
    ) -> None:
        self.code = code
        super().__init__(code, current)
