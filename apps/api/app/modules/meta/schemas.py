from pydantic import BaseModel


class MetaKey(BaseModel):
    """Metadata-key usage, sample values, and inferred value type."""

    key: str
    uses: int
    values: list[str]
    type: str  # boolean | integer | real | text | mixed


class MetaVocabulary(BaseModel):
    """Previously used metadata keys and values, ordered by frequency."""

    entity: str
    keys: list[MetaKey]
