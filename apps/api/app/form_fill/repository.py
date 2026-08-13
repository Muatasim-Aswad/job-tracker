from __future__ import annotations

from typing import Literal

from app.core.db import Conn, Row, execute, query_all, query_one
from app.form_fill.identity import NORMALIZER_VERSION, QuestionIdentity
from app.form_fill.models import Question, QuestionOption, QuestionPage

_QUESTION_COLUMNS = (
    "id, signature, identity_kind, site_scope, adapter_id, adapter_version, "
    "stable_field_key, normalizer_version, control_kind, normalized_question, "
    "raw_question, normalized_section, raw_section, normalized_help, raw_help, "
    "autocomplete_token, option_set_hash, review_state, revision, capture_conflict, "
    "last_unresolved_reason, seen_count, last_seen_scan_id, first_seen_at, last_seen_at"
)
_QUALIFIED_QUESTION_COLUMNS = ", ".join(
    f"q.{column.strip()}" for column in _QUESTION_COLUMNS.split(",")
)


def _to_question(row: Row) -> Question:
    return Question(**{**row, "capture_conflict": bool(row["capture_conflict"])})


def _to_option(row: Row) -> QuestionOption:
    return QuestionOption(**row)


class FormFillRepository:
    def __init__(self, conn: Conn) -> None:
        self.conn = conn

    def get_question(self, question_id: str) -> Question | None:
        row = query_one(
            self.conn,
            f"SELECT {_QUESTION_COLUMNS} FROM form_questions WHERE id = ?",
            (question_id,),
        )
        return _to_question(row) if row else None

    def get_question_by_signature(self, signature: str) -> Question | None:
        row = query_one(
            self.conn,
            f"SELECT {_QUESTION_COLUMNS} FROM form_questions WHERE signature = ?",
            (signature,),
        )
        return _to_question(row) if row else None

    def insert_question(
        self, question_id: str, identity: QuestionIdentity, scan_id: str, now: str
    ) -> None:
        execute(
            self.conn,
            "INSERT INTO form_questions ("
            "id, signature, identity_kind, site_scope, adapter_id, adapter_version, "
            "stable_field_key, normalizer_version, control_kind, normalized_question, "
            "raw_question, normalized_section, raw_section, normalized_help, raw_help, "
            "autocomplete_token, option_set_hash, review_state, revision, capture_conflict, "
            "last_unresolved_reason, seen_count, last_seen_scan_id, first_seen_at, last_seen_at"
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 1, 0, "
            "'no_knowledge', 1, ?, ?, ?)",
            (
                question_id,
                identity.signature,
                identity.identity_kind,
                identity.site_scope,
                identity.adapter_id,
                identity.adapter_version,
                identity.stable_field_key,
                NORMALIZER_VERSION,
                identity.control_kind,
                identity.normalized_question,
                identity.raw_question,
                identity.normalized_section,
                identity.raw_section,
                identity.normalized_help,
                identity.raw_help,
                identity.autocomplete_token,
                identity.option_set_hash,
                scan_id,
                now,
                now,
            ),
        )

    def update_observation(
        self,
        question: Question,
        identity: QuestionIdentity,
        scan_id: str,
        now: str,
        *,
        options_changed: bool,
    ) -> None:
        evidence_changed = (
            question.normalized_question != identity.normalized_question
            or question.raw_question != identity.raw_question
            or question.normalized_section != identity.normalized_section
            or question.raw_section != identity.raw_section
            or question.normalized_help != identity.normalized_help
            or question.raw_help != identity.raw_help
            or question.autocomplete_token != identity.autocomplete_token
        )
        revision_increment = 1 if evidence_changed or options_changed else 0
        seen_increment = 1 if question.last_seen_scan_id != scan_id else 0
        unresolved_reason = (
            "question_ignored" if question.review_state == "ignored" else "no_knowledge"
        )
        execute(
            self.conn,
            "UPDATE form_questions SET normalized_question = ?, raw_question = ?, "
            "normalized_section = ?, raw_section = ?, normalized_help = ?, raw_help = ?, "
            "autocomplete_token = ?, "
            "revision = revision + ?, last_unresolved_reason = ?, seen_count = seen_count + ?, "
            "last_seen_scan_id = ?, last_seen_at = ? WHERE id = ?",
            (
                identity.normalized_question,
                identity.raw_question,
                identity.normalized_section,
                identity.raw_section,
                identity.normalized_help,
                identity.raw_help,
                identity.autocomplete_token,
                revision_increment,
                unresolved_reason,
                seen_increment,
                scan_id,
                now,
                question.id,
            ),
        )

    def list_options(self, question_id: str) -> list[QuestionOption]:
        rows = query_all(
            self.conn,
            "SELECT id, question_id, normalized_label, raw_label, stable_option_key, "
            "status, created_at, updated_at FROM form_question_options "
            "WHERE question_id = ? ORDER BY normalized_label, stable_option_key, id",
            (question_id,),
        )
        return [_to_option(row) for row in rows]

    def upsert_option(
        self,
        *,
        option_id: str,
        question_id: str,
        normalized_label: str,
        raw_label: str,
        stable_option_key: str,
        status: Literal["active", "disabled"],
        now: str,
    ) -> tuple[QuestionOption, bool]:
        row = query_one(
            self.conn,
            "SELECT id, question_id, normalized_label, raw_label, stable_option_key, "
            "status, created_at, updated_at FROM form_question_options "
            "WHERE question_id = ? AND normalized_label = ? AND stable_option_key = ?",
            (question_id, normalized_label, stable_option_key),
        )
        if row is None:
            execute(
                self.conn,
                "INSERT INTO form_question_options (id, question_id, normalized_label, "
                "raw_label, stable_option_key, status, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    option_id,
                    question_id,
                    normalized_label,
                    raw_label,
                    stable_option_key,
                    status,
                    now,
                    now,
                ),
            )
            created = QuestionOption(
                id=option_id,
                question_id=question_id,
                normalized_label=normalized_label,
                raw_label=raw_label,
                stable_option_key=stable_option_key,
                status=status,
                created_at=now,
                updated_at=now,
            )
            return created, True
        option = _to_option(row)
        changed = option.raw_label != raw_label or option.status != status
        if changed:
            execute(
                self.conn,
                "UPDATE form_question_options SET raw_label = ?, status = ?, updated_at = ? "
                "WHERE id = ?",
                (raw_label, status, now, option.id),
            )
            option = QuestionOption(
                **{**option.__dict__, "raw_label": raw_label, "status": status, "updated_at": now}
            )
        return option, changed

    def list_questions(
        self,
        *,
        review_state: str | None,
        mapping_status: str | None,
        has_current_capture: bool | None,
        site_scope: str | None,
        answer_id: str | None,
        query: str | None,
        sort: str,
        limit: int,
        cursor_values: tuple[object, str] | None,
    ) -> QuestionPage:
        conditions: list[str] = []
        params: list[object] = []
        if review_state is not None:
            conditions.append("q.review_state = ?")
            params.append(review_state)
        if mapping_status == "none":
            conditions.append("m.id IS NULL")
        elif mapping_status is not None:
            conditions.append("m.status = ?")
            params.append(mapping_status)
        if has_current_capture is not None:
            predicate = "EXISTS" if has_current_capture else "NOT EXISTS"
            conditions.append(
                f"{predicate} (SELECT 1 FROM form_captures c "
                "WHERE c.question_id = q.id AND c.status = 'current')"
            )
        if site_scope is not None:
            conditions.append("q.site_scope = ?")
            params.append(site_scope)
        if answer_id is not None:
            conditions.append("m.answer_id = ?")
            params.append(answer_id)
        if query is not None:
            conditions.append(
                "(instr(q.normalized_question, ?) > 0 "
                "OR instr(q.normalized_section, ?) > 0 "
                "OR instr(q.normalized_help, ?) > 0)"
            )
            params.extend([query, query, query])
        sort_column = "q.last_seen_at" if sort == "last_seen" else "q.seen_count"
        if cursor_values is not None:
            last_value, last_id = cursor_values
            conditions.append(f"({sort_column} < ? OR ({sort_column} = ? AND q.id < ?))")
            params.extend([last_value, last_value, last_id])
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        rows = query_all(
            self.conn,
            f"SELECT {_QUALIFIED_QUESTION_COLUMNS} "
            "FROM form_questions q LEFT JOIN form_question_mappings m ON m.question_id = q.id "
            f"{where} ORDER BY {sort_column} DESC, q.id DESC LIMIT ?",
            (*params, limit + 1),
        )
        return QuestionPage(
            items=[_to_question(row) for row in rows[:limit]], has_more=len(rows) > limit
        )

    def get_mapping(self, question_id: str) -> Row | None:
        return query_one(
            self.conn,
            "SELECT id, answer_id, status, revision FROM form_question_mappings "
            "WHERE question_id = ?",
            (question_id,),
        )

    def list_bindings(self, mapping_id: str) -> list[Row]:
        return query_all(
            self.conn,
            "SELECT question_option_id, answer_choice_id FROM form_mapping_option_bindings "
            "WHERE mapping_id = ? ORDER BY question_option_id",
            (mapping_id,),
        )

    def get_answer_summary(self, answer_id: str) -> Row | None:
        return query_one(
            self.conn,
            "SELECT id, answer_key, label, value_kind, status, fill_policy, revision "
            "FROM form_answers WHERE id = ?",
            (answer_id,),
        )

    def list_current_captures(self, question_id: str) -> list[Row]:
        return query_all(
            self.conn,
            "SELECT id, source, value_kind, status, revision, created_at FROM form_captures "
            "WHERE question_id = ? AND status = 'current' ORDER BY created_at DESC, id DESC",
            (question_id,),
        )

    def list_question_events(self, question_id: str, limit: int = 50) -> list[Row]:
        return query_all(
            self.conn,
            "SELECT id, event, before_revision, after_revision, reason, created_at "
            "FROM form_knowledge_events WHERE question_id = ? "
            "ORDER BY created_at DESC, id DESC LIMIT ?",
            (question_id, limit),
        )

    def set_review_state(
        self,
        question_id: str,
        review_state: str,
        expected_revision: int,
        reason: str | None,
        event_id: str,
        now: str,
    ) -> None:
        execute(
            self.conn,
            "UPDATE form_questions SET review_state = ?, revision = revision + 1, "
            "last_unresolved_reason = ?, last_seen_at = last_seen_at "
            "WHERE id = ? AND revision = ?",
            (
                review_state,
                "question_ignored" if review_state == "ignored" else "no_knowledge",
                question_id,
                expected_revision,
            ),
        )
        execute(
            self.conn,
            "INSERT INTO form_knowledge_events (id, event, question_id, before_revision, "
            "after_revision, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                event_id,
                "question_ignored" if review_state == "ignored" else "question_reopened",
                question_id,
                expected_revision,
                expected_revision + 1,
                reason,
                now,
            ),
        )
