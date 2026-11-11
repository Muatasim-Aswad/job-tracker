from fastapi import APIRouter, Query, Response

from app.modules.documents.dependencies import ServiceDep
from app.modules.documents.models import Document
from app.modules.documents.schemas import DocumentCreate, DocumentOperation, DocumentUpdate

router = APIRouter(tags=["documents"])


@router.get("/document-operations", response_model=DocumentOperation)
def get_document_operation(
    *, operation_key: str = Query(min_length=1, max_length=200, pattern=r"\S"), service: ServiceDep
) -> DocumentOperation:
    """Look up a durable creation receipt without creating or restoring a document."""
    return service.operation(operation_key)


@router.post("/jobs/{job_id}/documents", response_model=Document, status_code=201)
def create_document(
    *, job_id: str, body: DocumentCreate, response: Response, service: ServiceDep
) -> Document:
    document, created = service.add(job_id, body)
    response.status_code = 201 if created else 200
    response.headers["Content-Location"] = f"/api/jobs/{document.job_id}"
    return document


@router.patch("/documents/{document_id}", response_model=Document)
def update_document(*, document_id: int, body: DocumentUpdate, service: ServiceDep) -> Document:
    """Update only the supplied document fields."""
    return service.update(document_id, body)


@router.delete("/documents/{document_id}", status_code=204)
def delete_document(*, document_id: int, service: ServiceDep) -> Response:
    service.delete(document_id)
    return Response(status_code=204)
