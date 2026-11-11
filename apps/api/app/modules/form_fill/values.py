"""Typed value adapters and control categories shared by form-fill use cases."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import TypeAdapter

from app.modules.form_fill.schemas import AnswerValue, CaptureValue

QuestionSort = Literal["last_seen", "seen_count", "prompt"]
QuestionMappingFilter = Literal["active", "disabled", "retired", "none"]
_ANSWER_VALUE: TypeAdapter[AnswerValue] = TypeAdapter(AnswerValue)
_CAPTURE_VALUE: TypeAdapter[CaptureValue] = TypeAdapter(CaptureValue)
_ANSWER_KEY = re.compile(r"^[a-z0-9][a-z0-9._-]{0,255}$")
_CHOICE_CONTROLS = {"radio", "select", "checkbox_group", "multi_select"}
_SINGLE_CHOICE_CONTROLS = {"radio", "select"}
_MULTI_CHOICE_CONTROLS = {"checkbox_group", "multi_select"}
