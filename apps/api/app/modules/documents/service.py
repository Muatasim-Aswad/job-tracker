from app.infra.database import Conn
from app.modules.documents.models import Document
from app.modules.documents.repository import DocumentRepository
from app.modules.documents.schemas import DocumentCreate, DocumentOperation, DocumentUpdate
from app.modules.jobs.repository import JobRepository
from app.shared.errors import ConflictError, NotFoundError
from app.shared.hashing import stable_hash
from app.shared.timeutil import utc_now


class DocumentService:
    def __init__(self, conn: Conn) -> None:
        self.documents = DocumentRepository(conn)
        self.jobs = JobRepository(conn)

    def add(self, job_id: str, data: DocumentCreate) -> tuple[Document, bool]:
        requested_job_id = job_id
        job_id = self.jobs.resolve_id(job_id) or job_id
        # Preserve legacy creation-key fingerprints when adding the new optional field.
        request_hash = stable_hash(
            data.model_dump(mode="json", exclude={"creation_key", "operation_key"})
        )
        assert request_hash is not None
        if data.operation_key is not None:
            prior = self.documents.operation(data.operation_key)
            if prior is not None:
                receipt = self.operation(data.operation_key)
                if receipt.job_id != job_id or prior["request_hash"] != request_hash:
                    raise ConflictError("document_operation_key_conflict", receipt.model_dump())
                if receipt.status == "deleted":
                    raise ConflictError("document_operation_deleted", receipt.model_dump())
                document = self.documents.get(receipt.document_id)
                assert document is not None
                return document, False
        job_id = self.jobs.resolve_id(requested_job_id) or ""
        if not job_id:
            raise NotFoundError(f"job {requested_job_id} not found")
        if data.creation_key is not None:
            prior = self.documents.creation(data.creation_key)
            if prior is not None:
                document = self.documents.get(int(prior["document_id"]))
                assert document is not None
                if document.job_id != job_id or prior["request_hash"] != request_hash:
                    raise ConflictError(
                        "document_creation_key_conflict",
                        {"document_id": document.id, "job_id": document.job_id},
                    )
                return document, False
        now = utc_now()
        document_id = self.documents.insert(
            job_id, str(data.type), data.requested, data.provided, data.content, now, now, data.meta
        )
        document = self.documents.get(document_id)
        assert document is not None
        if data.creation_key is not None:
            self.documents.remember_creation(data.creation_key, document_id, request_hash)
        if data.operation_key is not None:
            self.documents.remember_operation(
                data.operation_key, document_id, job_id, request_hash, now
            )
        return document, True

    def operation(self, key: str) -> DocumentOperation:
        prior = self.documents.operation(key)
        if prior is None:
            raise NotFoundError("document operation not found")
        document = self.documents.get(int(prior["document_id"]))
        return DocumentOperation(
            operation_key=key,
            document_id=int(prior["document_id"]),
            job_id=document.job_id if document else str(prior["job_id"]),
            status="present" if document else "deleted",
            created_at=str(prior["created_at"]),
        )

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
