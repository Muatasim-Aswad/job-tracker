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
AnswerStatus = Literal["active", "disabled"]
FillPolicy = Literal["auto", "confirm_each_time", "never"]
AnswerValueKind = Literal[
    "text", "long_text", "decimal", "boolean", "date", "single_choice", "multi_choice"
]
CaptureSource = Literal["user_input", "confirmed_external", "unattributed_change"]
CaptureStatus = Literal["current", "superseded", "applied", "ignored"]

MAX_CHOICE_ITEMS = 512


class TextValue(BaseModel):
    kind: Literal["text"]
    value: str = Field(min_length=1, max_length=100_000)


class LongTextValue(BaseModel):
    kind: Literal["long_text"]
    value: str = Field(min_length=1, max_length=100_000)


class DecimalValue(BaseModel):
    kind: Literal["decimal"]
    value: str = Field(pattern=r"^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$", max_length=128)


class BooleanValue(BaseModel):
    kind: Literal["boolean"]
    value: bool


class DateValue(BaseModel):
    kind: Literal["date"]
    value: date


class AnswerSingleChoiceValue(BaseModel):
    kind: Literal["single_choice"]
    choice_key: str = Field(min_length=1, max_length=128)


class AnswerMultiChoiceValue(BaseModel):
    kind: Literal["multi_choice"]
    choice_keys: list[str] = Field(min_length=1, max_length=MAX_CHOICE_ITEMS)

    @model_validator(mode="after")
    def validate_choice_keys(self) -> AnswerMultiChoiceValue:
        if len(self.choice_keys) != len(set(self.choice_keys)):
            raise ValueError("choice_keys must be unique")
        return self


AnswerValue = Annotated[
    TextValue
    | LongTextValue
    | DecimalValue
    | BooleanValue
    | DateValue
    | AnswerSingleChoiceValue
    | AnswerMultiChoiceValue,
    Field(discriminator="kind"),
]


class CaptureSingleChoiceValue(BaseModel):
    kind: Literal["single_choice"]
    question_option_id: str = Field(min_length=1, max_length=128)


class CaptureMultiChoiceValue(BaseModel):
    kind: Literal["multi_choice"]
    question_option_ids: list[str] = Field(min_length=1, max_length=MAX_CHOICE_ITEMS)

    @model_validator(mode="after")
    def validate_option_ids(self) -> CaptureMultiChoiceValue:
        if len(self.question_option_ids) != len(set(self.question_option_ids)):
            raise ValueError("question_option_ids must be unique")
        return self


CaptureValue = Annotated[
    TextValue
    | LongTextValue
    | DecimalValue
    | BooleanValue
    | DateValue
    | CaptureSingleChoiceValue
    | CaptureMultiChoiceValue,
    Field(discriminator="kind"),
]


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
    options: list[ResolutionOption] = Field(default_factory=list, max_length=MAX_CHOICE_ITEMS)

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
    source: CaptureSource
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


class AnswerChoiceInput(BaseModel):
    choice_key: str = Field(min_length=1, max_length=128)
    display_label: str = Field(min_length=1, max_length=1000)
    status: Literal["active", "disabled"] = "active"


class AnswerChoiceSummary(AnswerChoiceInput):
    id: str


class OptionBindingInput(BaseModel):
    question_option_id: str = Field(min_length=1, max_length=128)
    answer_choice_id: str = Field(min_length=1, max_length=128)


class OptionBindingSummary(OptionBindingInput):
    pass


class NewOptionBindingInput(BaseModel):
    question_option_id: str = Field(min_length=1, max_length=128)
    answer_choice_key: str = Field(min_length=1, max_length=128)


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
    value_kind: AnswerValueKind
    status: AnswerStatus
    fill_policy: FillPolicy
    revision: int


class AnswerListItem(AnswerSummary):
    description: str | None = None
    mapping_count: int
    updated_at: str


class CaptureSummary(BaseModel):
    id: str
    source: CaptureSource
    value_kind: AnswerValueKind
    status: CaptureStatus
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


class AnswerCreate(BaseModel):
    answer_key: str = Field(min_length=1, max_length=256)
    label: str = Field(min_length=1, max_length=1000)
    description: str | None = Field(default=None, max_length=4000)
    value_kind: AnswerValueKind
    value: AnswerValue
    choices: list[AnswerChoiceInput] = Field(default_factory=list, max_length=MAX_CHOICE_ITEMS)
    fill_policy: FillPolicy = "auto"

    @model_validator(mode="after")
    def validate_value_and_choices(self) -> AnswerCreate:
        if self.value.kind != self.value_kind:
            raise ValueError("value kind must match value_kind")
        keys = [choice.choice_key for choice in self.choices]
        if len(keys) != len(set(keys)):
            raise ValueError("choice_key must be unique within an answer")
        if self.value_kind in {"single_choice", "multi_choice"} and not self.choices:
            raise ValueError("choice answers require a complete choice vocabulary")
        if self.value_kind not in {"single_choice", "multi_choice"} and self.choices:
            raise ValueError("non-choice answers cannot include choices")
        active_keys = {choice.choice_key for choice in self.choices if choice.status == "active"}
        selected_keys: set[str] = set()
        if isinstance(self.value, AnswerSingleChoiceValue):
            selected_keys = {self.value.choice_key}
        elif isinstance(self.value, AnswerMultiChoiceValue):
            selected_keys = set(self.value.choice_keys)
        if not selected_keys <= active_keys:
            raise ValueError("answer value must reference active answer choices")
        return self


class AnswerUpdate(BaseModel):
    expected_revision: int = Field(ge=1)
    label: str | None = Field(default=None, min_length=1, max_length=1000)
    description: str | None = Field(default=None, max_length=4000)
    value: AnswerValue | None = None
    choices: list[AnswerChoiceInput] | None = Field(default=None, max_length=MAX_CHOICE_ITEMS)
    fill_policy: FillPolicy | None = None
    status: AnswerStatus | None = None
    reason: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_choice_keys(self) -> AnswerUpdate:
        if self.choices is not None:
            keys = [choice.choice_key for choice in self.choices]
            if len(keys) != len(set(keys)):
                raise ValueError("choice_key must be unique within an answer")
        return self


class MappedQuestionSummary(BaseModel):
    id: str
    site_scope: str
    control_kind: ControlKind
    raw_question: str
    review_state: ReviewState
    revision: int
    mapping: MappingSummary


class AnswerDetail(AnswerSummary):
    description: str | None = None
    value: AnswerValue
    choices: list[AnswerChoiceSummary]
    mappings: list[MappedQuestionSummary]
    events: list[KnowledgeEventSummary]
    verified_at: str
    created_at: str
    updated_at: str


class AnswerListResponse(BaseModel):
    items: list[AnswerListItem]
    next_cursor: str | None = None


class MappingPut(BaseModel):
    answer_id: str = Field(min_length=1, max_length=128)
    expected_question_revision: int = Field(ge=1)
    expected_answer_revision: int = Field(ge=1)
    expected_mapping_revision: int | None = Field(default=None, ge=1)
    bindings: list[OptionBindingInput] = Field(default_factory=list, max_length=MAX_CHOICE_ITEMS)
    reason: str | None = Field(default=None, max_length=1000)


class QuestionAnswerCreate(BaseModel):
    expected_question_revision: int = Field(ge=1)
    expected_mapping_revision: int | None = Field(default=None, ge=1)
    answer_key: str = Field(min_length=1, max_length=256)
    label: str = Field(min_length=1, max_length=1000)
    description: str | None = Field(default=None, max_length=4000)
    value: AnswerValue
    choices: list[AnswerChoiceInput] = Field(default_factory=list, max_length=MAX_CHOICE_ITEMS)
    fill_policy: FillPolicy = "auto"
    bindings: list[NewOptionBindingInput] = Field(default_factory=list, max_length=MAX_CHOICE_ITEMS)
    reason: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_value_and_choices(self) -> QuestionAnswerCreate:
        keys = [choice.choice_key for choice in self.choices]
        if len(keys) != len(set(keys)):
            raise ValueError("choice_key must be unique within an answer")
        if self.value.kind in {"single_choice", "multi_choice"} and not self.choices:
            raise ValueError("choice answers require a complete choice vocabulary")
        if self.value.kind not in {"single_choice", "multi_choice"} and self.choices:
            raise ValueError("non-choice answers cannot include choices")
        active_keys = {choice.choice_key for choice in self.choices if choice.status == "active"}
        selected_keys: set[str] = set()
        if isinstance(self.value, AnswerSingleChoiceValue):
            selected_keys = {self.value.choice_key}
        elif isinstance(self.value, AnswerMultiChoiceValue):
            selected_keys = set(self.value.choice_keys)
        if not selected_keys <= active_keys:
            raise ValueError("answer value must reference active answer choices")
        return self


class MappingUpdate(BaseModel):
    expected_question_revision: int = Field(ge=1)
    expected_revision: int = Field(ge=1)
    status: MappingStatus
    reason: str | None = Field(default=None, max_length=1000)


class CapturePage(BaseModel):
    platform: str = Field(min_length=1, max_length=64)
    platform_id: str = Field(min_length=1, max_length=256)


class CaptureCreate(BaseModel):
    capture_key: str = Field(min_length=1, max_length=256)
    question_id: str = Field(min_length=1, max_length=128)
    application_context_id: str = Field(min_length=1, max_length=128)
    page: CapturePage
    source: CaptureSource
    value: CaptureValue | None = None
    mapping_id: str | None = Field(default=None, min_length=1, max_length=128)
    answer_revision_used: int | None = Field(default=None, ge=1)
    mapping_revision_used: int | None = Field(default=None, ge=1)
    cleared: bool = False

    @model_validator(mode="after")
    def validate_capture_context(self) -> CaptureCreate:
        if self.cleared == (self.value is not None):
            raise ValueError("cleared captures omit value; non-cleared captures require value")
        context = (self.mapping_id, self.answer_revision_used, self.mapping_revision_used)
        if any(item is not None for item in context) and not all(
            item is not None for item in context
        ):
            raise ValueError("mapping_id and both used revisions must be supplied together")
        return self


class CaptureRecordSummary(CaptureSummary):
    question_id: str
    application_context_id: str
    job_id: str | None = None
    listing_id: str | None = None
    mapping_id: str | None = None
    answer_revision_used: int | None = None
    mapping_revision_used: int | None = None
    value: CaptureValue | None = None
    updated_at: str
    resolved_at: str | None = None


class CaptureCreateResponse(BaseModel):
    capture: CaptureRecordSummary
    superseded_capture_id: str | None = None
    superseded_capture_ids: list[str] = Field(default_factory=list)


class CaptureUpdate(BaseModel):
    expected_revision: int = Field(ge=1)
    status: Literal["current", "ignored"]
    reason: str | None = Field(default=None, max_length=1000)


class CaptureDetail(CaptureRecordSummary):
    question: QuestionSummary
    answer: AnswerSummary | None = None
    mapping: MappingSummary | None = None
    events: list[KnowledgeEventSummary]


class CaptureListResponse(BaseModel):
    items: list[CaptureRecordSummary]
    next_cursor: str | None = None


class CreateAnswerAndMapApply(BaseModel):
    action: Literal["create_answer_and_map"]
    expected_capture_revision: int = Field(ge=1)
    expected_question_revision: int = Field(ge=1)
    expected_mapping_revision: int | None = Field(default=None, ge=1)
    answer_key: str = Field(min_length=1, max_length=256)
    label: str = Field(min_length=1, max_length=1000)
    description: str | None = Field(default=None, max_length=4000)
    value_kind: AnswerValueKind
    value: AnswerValue
    choices: list[AnswerChoiceInput] = Field(default_factory=list, max_length=MAX_CHOICE_ITEMS)
    fill_policy: FillPolicy = "auto"
    bindings: list[NewOptionBindingInput] = Field(default_factory=list, max_length=MAX_CHOICE_ITEMS)
    reason: str | None = Field(default=None, max_length=1000)


class UpdateAnswerApply(BaseModel):
    action: Literal["update_answer"]
    expected_capture_revision: int = Field(ge=1)
    expected_question_revision: int = Field(ge=1)
    answer_id: str = Field(min_length=1, max_length=128)
    expected_answer_revision: int = Field(ge=1)
    expected_mapping_revision: int | None = Field(default=None, ge=1)
    value: AnswerValue
    label: str | None = Field(default=None, min_length=1, max_length=1000)
    description: str | None = Field(default=None, max_length=4000)
    choices: list[AnswerChoiceInput] | None = Field(default=None, max_length=MAX_CHOICE_ITEMS)
    fill_policy: FillPolicy | None = None
    reason: str | None = Field(default=None, max_length=1000)


class RetargetMappingApply(BaseModel):
    action: Literal["retarget_mapping"]
    expected_capture_revision: int = Field(ge=1)
    expected_question_revision: int = Field(ge=1)
    answer_id: str = Field(min_length=1, max_length=128)
    expected_answer_revision: int = Field(ge=1)
    expected_mapping_revision: int = Field(ge=1)
    bindings: list[OptionBindingInput] = Field(default_factory=list, max_length=MAX_CHOICE_ITEMS)
    reason: str | None = Field(default=None, max_length=1000)


class ReplaceOptionBindingsApply(BaseModel):
    action: Literal["replace_option_bindings"]
    expected_capture_revision: int = Field(ge=1)
    expected_question_revision: int = Field(ge=1)
    answer_id: str = Field(min_length=1, max_length=128)
    expected_answer_revision: int = Field(ge=1)
    mapping_id: str = Field(min_length=1, max_length=128)
    expected_mapping_revision: int = Field(ge=1)
    bindings: list[OptionBindingInput] = Field(default_factory=list, max_length=MAX_CHOICE_ITEMS)
    reason: str | None = Field(default=None, max_length=1000)


CaptureApply = Annotated[
    CreateAnswerAndMapApply | UpdateAnswerApply | RetargetMappingApply | ReplaceOptionBindingsApply,
    Field(discriminator="action"),
]


class CaptureApplyResponse(BaseModel):
    capture: CaptureRecordSummary
    question: QuestionSummary
    answer: AnswerSummary
    mapping: MappingSummary


class CaptureRevision(BaseModel):
    capture_id: str = Field(min_length=1, max_length=128)
    expected_revision: int = Field(ge=1)


class CaptureConflictResolve(BaseModel):
    expected_question_revision: int = Field(ge=1)
    winner_capture_id: str = Field(min_length=1, max_length=128)
    captures: list[CaptureRevision] = Field(min_length=2, max_length=200)
    reason: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_capture_set(self) -> CaptureConflictResolve:
        ids = [item.capture_id for item in self.captures]
        if len(ids) != len(set(ids)):
            raise ValueError("capture revisions must name each capture exactly once")
        if self.winner_capture_id not in ids:
            raise ValueError("winner_capture_id must be included in captures")
        return self


class CaptureConflictResponse(BaseModel):
    question: QuestionSummary
    winner: CaptureRecordSummary
    superseded: list[CaptureSummary]
