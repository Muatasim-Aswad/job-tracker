import json

from app.application_workflows.models import ApplicationWorkflow
from app.application_workflows.schemas import ApplicationWorkflowPut
from app.core.db import Conn, Row, execute, query_one

_COLUMNS = (
    "job_id, submitted_event_id, preparation_lane, submission_actor, submission_channel, "
    "narratives_json, measured_human_time_seconds, references_json, revision, created_at, "
    "updated_at"
)


def _json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _to_workflow(row: Row) -> ApplicationWorkflow:
    data = dict(row)
    data["narratives"] = json.loads(data.pop("narratives_json"))
    data["references"] = json.loads(data.pop("references_json"))
    return ApplicationWorkflow(**data)


class ApplicationWorkflowRepository:
    def __init__(self, conn: Conn) -> None:
        self.conn = conn

    def get_for_job(self, job_id: str) -> ApplicationWorkflow | None:
        row = query_one(
            self.conn, f"SELECT {_COLUMNS} FROM application_workflows WHERE job_id = ?", (job_id,)
        )
        return _to_workflow(row) if row else None

    def insert(self, job_id: str, data: ApplicationWorkflowPut, now: str) -> None:
        execute(
            self.conn,
            "INSERT INTO application_workflows ("
            "job_id, submitted_event_id, preparation_lane, submission_actor, submission_channel, "
            "narratives_json, measured_human_time_seconds, references_json, revision, created_at, "
            "updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
            (
                job_id,
                data.submitted_event_id,
                data.preparation_lane,
                data.submission_actor,
                data.submission_channel,
                _json([item.model_dump() for item in data.narratives]),
                data.measured_human_time_seconds,
                _json([item.model_dump() for item in data.references]),
                now,
                now,
            ),
        )

    def update(
        self, job_id: str, data: ApplicationWorkflowPut, expected_revision: int, now: str
    ) -> bool:
        row = query_one(
            self.conn,
            "UPDATE application_workflows SET submitted_event_id = ?, preparation_lane = ?, "
            "submission_actor = ?, submission_channel = ?, narratives_json = ?, "
            "measured_human_time_seconds = ?, references_json = ?, revision = revision + 1, "
            "updated_at = ? WHERE job_id = ? AND revision = ? RETURNING revision",
            (
                data.submitted_event_id,
                data.preparation_lane,
                data.submission_actor,
                data.submission_channel,
                _json([item.model_dump() for item in data.narratives]),
                data.measured_human_time_seconds,
                _json([item.model_dump() for item in data.references]),
                now,
                job_id,
                expected_revision,
            ),
        )
        return row is not None

    def delete_for_job(self, job_id: str) -> None:
        execute(self.conn, "DELETE FROM application_workflows WHERE job_id = ?", (job_id,))
