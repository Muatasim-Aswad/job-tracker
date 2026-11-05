from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

PreparationLane = Literal["human_only", "agent_assisted", "agent_led", "unknown"]
SubmissionActor = Literal["human", "agent", "unknown"]
SubmissionChannel = Literal["easy_apply", "external_form", "email", "other", "unknown"]
NarrativeKind = Literal[
    "cover_letter", "motivation_letter", "screening_answers", "email", "other", "unknown"
]
NarrativeProvenance = Literal[
    "human_authored", "agent_generated", "agent_drafted_human_edited", "reused_existing", "unknown"
]
ReferenceKind = Literal["agent_run", "agent_artifact", "submission_evidence", "external"]
ReferenceRole = Literal["preparation", "narrative", "submission", "evidence", "other"]


class StrictWorkflowModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class NarrativeUsage(StrictWorkflowModel):
    kind: NarrativeKind
    provenance: NarrativeProvenance


class WorkflowReference(StrictWorkflowModel):
    """Opaque locator for a canonical artifact; the artifact owns its own details."""

    kind: ReferenceKind
    role: ReferenceRole
    ref: str = Field(min_length=1, max_length=2048)


class ApplicationWorkflowData(StrictWorkflowModel):
    preparation_lane: PreparationLane
    submission_actor: SubmissionActor
    submission_channel: SubmissionChannel
    narratives: list[NarrativeUsage] = Field(max_length=16)
    # Null means not measured, rather than an estimate or an inferred zero.
    measured_human_time_seconds: int | None = Field(ge=0)
    references: list[WorkflowReference] = Field(max_length=64)

    @model_validator(mode="after")
    def validate_sets(self) -> ApplicationWorkflowData:
        narrative_kinds = [item.kind for item in self.narratives]
        if len(narrative_kinds) != len(set(narrative_kinds)):
            raise ValueError("narrative kind must be unique")
        references = [(item.kind, item.role, item.ref) for item in self.references]
        if len(references) != len(set(references)):
            raise ValueError("workflow references must be unique")
        return self


class ApplicationWorkflow(ApplicationWorkflowData):
    job_id: str
    submitted_event_id: int
    revision: int
    created_at: str
    updated_at: str
