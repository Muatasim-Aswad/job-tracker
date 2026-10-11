from __future__ import annotations

import re
from collections import Counter

from app.core.db import Row
from app.form_fill.identity import normalize_evidence
from app.form_fill.models import Question, QuestionOption
from app.form_fill.schemas import AnswerMultiChoiceValue, AnswerSingleChoiceValue, AnswerValue

_COMMON_WORDS = frozenset(
    [
        "a",
        "an",
        "the",
        "and",
        "or",
        "for",
        "of",
        "to",
        "in",
        "on",
        "at",
        "with",
        "your",
        "you",
        "my",
        "me",
        "we",
        "us",
        "be",
        "am",
        "as",
        "by",
        "if",
        "it",
        "yes",
        "no",
        "have",
        "has",
        "how",
        "many",
        "what",
        "when",
        "where",
        "which",
        "is",
        "are",
        "do",
        "does",
        "can",
        "will",
        "this",
        "that",
        "work",
        "working",
        "experience",
        "years",
        "year",
        "please",
        "required",
        "question",
        "answer",
        "value",
    ]
)


def meaningful_words(text: str) -> set[str]:
    return {
        word
        for word in re.findall(r"\.[^\W_]+|[^\W_]+(?:[+#]+)?", normalize_evidence(text))
        if not word.isdecimal() and word not in _COMMON_WORDS
    }


def relevance(question: Question, answer: Row, mappings: list[Row]) -> int:
    terms = meaningful_words(question.raw_question)
    label_score = len(terms & meaningful_words(answer["label"]))
    description_score = len(terms & meaningful_words(answer["description"] or ""))
    score = label_score * 10 + description_score
    if terms and normalize_evidence(answer["label"]) == question.normalized_question:
        score += 500
    for mapping in mappings:
        if mapping["question_id"] == question.id:
            score = max(score, 10_000)
        elif mapping["control_kind"] == question.control_kind:
            overlap = len(terms & meaningful_words(mapping["raw_question"]))
            if overlap:
                score = max(score, 1000 + overlap)
    return score


def compatible_options(
    question: Question, options: list[QuestionOption], choices: list[Row], mappings: list[Row]
) -> bool:
    labels = [option.normalized_label for option in options]
    choice_labels = [normalize_evidence(choice["display_label"]) for choice in choices]
    if len(set(labels)) == len(labels) and Counter(labels) == Counter(choice_labels):
        return True
    choice_ids = {choice["id"] for choice in choices}
    grouped: dict[str, list[Row]] = {}
    for binding in mappings:
        grouped.setdefault(binding["question_id"], []).append(binding)
    for source_id, bindings in grouped.items():
        if len(bindings) != len(options):
            continue
        if {binding["answer_choice_id"] for binding in bindings} != choice_ids:
            continue
        if source_id == question.id:
            if {binding["question_option_id"] for binding in bindings} == {
                option.id for option in options
            }:
                return True
        elif len(set(labels)) == len(labels) and Counter(
            binding["normalized_label"] for binding in bindings
        ) == Counter(labels):
            return True
    return False


def value_preview(value: AnswerValue, choices: list[Row]) -> str:
    if value.kind == "boolean":
        text = "Yes" if value.value else "No"
    elif isinstance(value, AnswerSingleChoiceValue | AnswerMultiChoiceValue):
        labels = {choice["choice_key"]: choice["display_label"] for choice in choices}
        keys = [value.choice_key] if value.kind == "single_choice" else value.choice_keys
        text = ", ".join(labels.get(key, "Option no longer available") for key in keys)
        text = text or "None selected"
    else:
        text = str(value.value)
    text = " ".join(text.split())
    return text if len(text) <= 160 else text[:159] + "…"
