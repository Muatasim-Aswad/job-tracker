from fastapi import APIRouter, Depends, Response

from app.core.deps import service_factory
from app.documents.models import Document
from app.documents.schemas import DocumentCreate, DocumentUpdate
from app.documents.service import DocumentService

router = APIRouter(tags=["documents"])

get_service = service_factory(DocumentService)


@router.post("/jobs/{job_id}/documents", response_model=Document, status_code=201)
def create_document(
    job_id: str,
    body: DocumentCreate,
    response: Response,
    service: DocumentService = Depends(get_service),
) -> Document:
    document = service.add(job_id, body)
    response.headers["Content-Location"] = f"/api/jobs/{document.job_id}"
    return document


@router.patch("/documents/{document_id}", response_model=Document)
def update_document(
    document_id: int, body: DocumentUpdate, service: DocumentService = Depends(get_service)
) -> Document:
    """Update only the supplied document fields."""
    return service.update(document_id, body)


@router.delete("/documents/{document_id}", status_code=204)
def delete_document(document_id: int, service: DocumentService = Depends(get_service)) -> Response:
    service.delete(document_id)
    return Response(status_code=204)
