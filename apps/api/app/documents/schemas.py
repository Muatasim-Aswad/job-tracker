from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

from app.core.enums import DocumentType


class DocumentCreate(BaseModel):
    operation_key: (
        Annotated[str, StringConstraints(min_length=1, max_length=200, pattern=r"\S")] | None
    ) = None
    creation_key: (
        Annotated[str, StringConstraints(min_length=1, max_length=200, pattern=r"\S")] | None
    ) = None
    type: DocumentType
    requested: Literal["required", "optional"] | None = None
    provided: bool = False
    content: str | None = None
    meta: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _one_retry_key(self) -> DocumentCreate:
        if self.operation_key is not None and self.creation_key is not None:
            raise ValueError("supply operation_key or creation_key, not both")
        return self


class DocumentOperation(BaseModel):
    operation_key: str
    document_id: int
    job_id: str
    status: Literal["present", "deleted"]
    created_at: str


class DocumentUpdate(BaseModel):
    """Fields to change on an existing document."""

    type: DocumentType | None = None
    requested: Literal["required", "optional"] | None = None
    provided: bool | None = None
    content: str | None = None
    meta: dict[str, Any] | None = None
