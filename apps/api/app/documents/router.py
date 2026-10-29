from fastapi import APIRouter, Depends, Query, Response

from app.core.deps import service_factory
from app.documents.models import Document
from app.documents.schemas import DocumentCreate, DocumentOperation, DocumentUpdate
from app.documents.service import DocumentService

router = APIRouter(tags=["documents"])

get_service = service_factory(DocumentService)


@router.get("/document-operations", response_model=DocumentOperation)
def get_document_operation(
    operation_key: str = Query(min_length=1, max_length=200, pattern=r"\S"),
    service: DocumentService = Depends(get_service),
) -> DocumentOperation:
    """Look up a durable creation receipt without creating or restoring a document."""
    return service.operation(operation_key)


@router.post("/jobs/{job_id}/documents", response_model=Document, status_code=201)
def create_document(
    job_id: str,
    body: DocumentCreate,
    response: Response,
    service: DocumentService = Depends(get_service),
) -> Document:
    document, created = service.add(job_id, body)
    response.status_code = 201 if created else 200
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
