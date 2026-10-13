from app.core.db import Conn
from app.core.errors import NotFoundError
from app.core.timeutil import utc_now
from app.documents.models import Document
from app.documents.repository import DocumentRepository
from app.documents.schemas import DocumentCreate, DocumentUpdate
from app.jobs.repository import JobRepository


class DocumentService:
    def __init__(self, conn: Conn) -> None:
        self.documents = DocumentRepository(conn)
        self.jobs = JobRepository(conn)

    def add(self, job_id: str, data: DocumentCreate) -> Document:
        requested_job_id = job_id
        job_id = self.jobs.resolve_id(job_id) or ""
        if not job_id:
            raise NotFoundError(f"job {requested_job_id} not found")
        now = utc_now()
        document_id = self.documents.insert(
            job_id, str(data.type), data.requested, data.provided, data.content, now, now
        )
        document = self.documents.get(document_id)
        assert document is not None
        return document

    def update(self, document_id: int, data: DocumentUpdate) -> Document:
        if self.documents.get(document_id) is None:
            raise NotFoundError(f"document {document_id} not found")
        fields = data.model_dump(exclude_unset=True)
        if "type" in fields:
            fields["type"] = str(fields["type"])
        if "provided" in fields:
            fields["provided"] = int(fields["provided"])
        self.documents.update(document_id, fields, utc_now())
        document = self.documents.get(document_id)
        assert document is not None
        return document

    def delete(self, document_id: int) -> None:
        if self.documents.get(document_id) is None:
            raise NotFoundError(f"document {document_id} not found")
        self.documents.delete_by_id(document_id)
