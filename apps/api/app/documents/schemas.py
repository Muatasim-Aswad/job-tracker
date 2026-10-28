from typing import Annotated, Literal

from pydantic import BaseModel, StringConstraints

from app.core.enums import DocumentType


class DocumentCreate(BaseModel):
    creation_key: (
        Annotated[str, StringConstraints(min_length=1, max_length=200, pattern=r"\S")] | None
    ) = None
    type: DocumentType
    requested: Literal["required", "optional"] | None = None
    provided: bool = False
    content: str | None = None


class DocumentUpdate(BaseModel):
    """Fields to change on an existing document."""

    type: DocumentType | None = None
    requested: Literal["required", "optional"] | None = None
    provided: bool | None = None
    content: str | None = None
