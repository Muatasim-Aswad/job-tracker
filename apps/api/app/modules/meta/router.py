from fastapi import APIRouter

from app.modules.meta import service
from app.modules.meta.schemas import MetaVocabulary
from app.platform.dependencies import ConnDep

router = APIRouter(tags=["meta"])


@router.get("/health")
def health() -> dict[str, bool]:
    """DB-free liveness probe for the extension's reachability poll."""
    return {"ok": True}


@router.get("/meta/vocabulary", response_model=MetaVocabulary)
def get_vocabulary(*, entity: str = "jobs", conn: ConnDep) -> MetaVocabulary:
    """Return previously used metadata keys and values, most-used first."""
    return service.vocabulary(conn, entity)


@router.get("/meta/note-titles", response_model=list[str])
def get_note_titles(*, conn: ConnDep) -> list[str]:
    """Return previously used note titles, most-used first."""
    return service.note_titles(conn)
