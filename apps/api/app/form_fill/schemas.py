from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

ControlKind = Literal[
    "text",
    "textarea",
    "integer",
    "decimal",
    "date",
    "checkbox_boolean",
    "radio",
    "select",
    "checkbox_group",
    "multi_select",
]
ChoiceControlKind = Literal["radio", "select", "checkbox_group", "multi_select"]
ReviewState = Literal["open", "ignored"]
MappingStatus = Literal["active", "disabled", "retired"]


class ResolutionPage(BaseModel):
    site_scope: str = Field(min_length=1, max_length=253)
    adapter_id: str = Field(min_length=1, max_length=64)
    adapter_version: str = Field(min_length=1, max_length=64)
    platform: str = Field(min_length=1, max_length=64)
    platform_id: str = Field(min_length=1, max_length=256)


class ResolutionOption(BaseModel):
    client_option_id: str = Field(min_length=1, max_length=128)
    label: str = Field(min_length=1, max_length=1000)
    stable_option_key: str | None = Field(default=None, max_length=256)
    disabled: bool = False


class ResolutionField(BaseModel):
    client_field_id: str = Field(min_length=1, max_length=128)
    prompt: str = Field(min_length=1, max_length=2000)
    section: str | None = Field(default=None, max_length=1000)
    help: str | None = Field(default=None, max_length=4000)
    control_kind: ControlKind
    stable_field_key: str | None = Field(default=None, max_length=256)
    autocomplete_token: str | None = Field(default=None, max_length=128)
    required: bool
    max_length: int | None = Field(default=None, ge=1, le=100_000)
    has_value: bool
    user_confirmed: bool = False
    options: list[ResolutionOption] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def validate_control_options(self) -> ResolutionField:
        choice = self.control_kind in {"radio", "select", "checkbox_group", "multi_select"}
        if choice and not self.options:
            raise ValueError("choice controls require options")
        if not choice and self.options:
            raise ValueError("non-choice controls cannot include options")
        option_ids = [option.client_option_id for option in self.options]
        if len(option_ids) != len(set(option_ids)):
            raise ValueError("client_option_id must be unique within a field")
        return self


class ResolutionRequest(BaseModel):
    scan_id: str = Field(min_length=1, max_length=128)
    application_context_id: str = Field(min_length=1, max_length=128)
    page: ResolutionPage
    fields: list[ResolutionField] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_field_ids(self) -> ResolutionRequest:
        field_ids = [field.client_field_id for field in self.fields]
        if len(field_ids) != len(set(field_ids)):
            raise ValueError("client_field_id must be unique within a scan")
        return self


class OptionIdentityPair(BaseModel):
    client_option_id: str
    question_option_id: str


class SetTextAction(BaseModel):
    kind: Literal["set_text"]
    value: str


class SetDecimalAction(BaseModel):
    kind: Literal["set_decimal"]
    value: str


class SetBooleanAction(BaseModel):
    kind: Literal["set_boolean"]
    value: bool


class SetDateAction(BaseModel):
    kind: Literal["set_date"]
    value: date


class SetSingleChoiceAction(BaseModel):
    kind: Literal["set_single_choice"]
    client_option_id: str


class SetMultiChoiceAction(BaseModel):
    kind: Literal["set_multi_choice"]
    client_option_ids: list[str]


ResolutionAction = Annotated[
    SetTextAction
    | SetDecimalAction
    | SetBooleanAction
    | SetDateAction
    | SetSingleChoiceAction
    | SetMultiChoiceAction,
    Field(discriminator="kind"),
]


class ResolutionResultBase(BaseModel):
    client_field_id: str
    question_id: str
    option_mappings: list[OptionIdentityPair] = Field(default_factory=list)


class ApprovedResult(ResolutionResultBase):
    status: Literal["approved"]
    answer_id: str
    answer_revision: int
    mapping_id: str
    mapping_revision: int
    action: ResolutionAction


class CapturedResult(ResolutionResultBase):
    status: Literal["captured"]
    capture_id: str
    capture_revision: int
    source: Literal["user_input", "confirmed_external", "unattributed_change"]
    action: ResolutionAction


class ConfirmationRequiredResult(ResolutionResultBase):
    status: Literal["confirmation_required"]
    answer_id: str
    answer_revision: int
    mapping_id: str
    mapping_revision: int


class BlockedResult(ResolutionResultBase):
    status: Literal["blocked"]
    reason: str


class ConflictResult(ResolutionResultBase):
    status: Literal["conflict"]
    capture_ids: list[str]
    reason: str


class UnresolvedResult(ResolutionResultBase):
    status: Literal["unresolved"]
    reason: str


class IgnoredResult(ResolutionResultBase):
    status: Literal["ignored"]
    reason: str


ResolutionResult = Annotated[
    ApprovedResult
    | CapturedResult
    | ConfirmationRequiredResult
    | BlockedResult
    | ConflictResult
    | UnresolvedResult
    | IgnoredResult,
    Field(discriminator="status"),
]


class ResolvedListingContext(BaseModel):
    job_id: str | None = None
    listing_id: str | None = None


class ResolutionResponse(BaseModel):
    scan_id: str
    listing_context: ResolvedListingContext
    results: list[ResolutionResult]


class QuestionOptionSummary(BaseModel):
    id: str
    normalized_label: str
    raw_label: str
    stable_option_key: str | None = None
    status: Literal["active", "disabled"]


class OptionBindingSummary(BaseModel):
    question_option_id: str
    answer_choice_id: str


class MappingSummary(BaseModel):
    id: str
    answer_id: str
    status: MappingStatus
    revision: int
    bindings: list[OptionBindingSummary] = Field(default_factory=list)


class AnswerSummary(BaseModel):
    id: str
    answer_key: str
    label: str
    value_kind: str
    status: Literal["active", "disabled"]
    fill_policy: Literal["auto", "confirm_each_time", "never"]
    revision: int


class CaptureSummary(BaseModel):
    id: str
    source: Literal["user_input", "confirmed_external", "unattributed_change"]
    value_kind: str
    status: Literal["current", "superseded", "applied", "ignored"]
    revision: int
    created_at: str


class KnowledgeEventSummary(BaseModel):
    id: str
    event: str
    before_revision: int | None = None
    after_revision: int | None = None
    reason: str | None = None
    created_at: str


class QuestionSummary(BaseModel):
    id: str
    site_scope: str
    control_kind: ControlKind
    raw_question: str
    review_state: ReviewState
    revision: int
    capture_conflict: bool
    last_unresolved_reason: str | None = None
    seen_count: int
    first_seen_at: str
    last_seen_at: str
    mapping: MappingSummary | None = None


class QuestionDetail(QuestionSummary):
    signature: str
    identity_kind: Literal["generic_signature", "adapter_key"]
    adapter_id: str
    adapter_version: str
    stable_field_key: str | None = None
    normalizer_version: int
    normalized_question: str
    normalized_section: str
    raw_section: str | None = None
    normalized_help: str
    raw_help: str | None = None
    autocomplete_token: str | None = None
    option_set_hash: str | None = None
    options: list[QuestionOptionSummary]
    answer: AnswerSummary | None = None
    current_captures: list[CaptureSummary] = Field(default_factory=list)
    events: list[KnowledgeEventSummary] = Field(default_factory=list)


class QuestionListResponse(BaseModel):
    items: list[QuestionSummary]
    next_cursor: str | None = None


class QuestionReviewUpdate(BaseModel):
    expected_revision: int = Field(ge=1)
    review_state: ReviewState
    reason: str | None = Field(default=None, max_length=1000)
