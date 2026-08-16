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
                question.last_unresolved_reason,
                seen_increment,
                scan_id,
                now,
                question.id,
            ),
        )

    def update_resolution_reason(self, question_id: str, reason: str | None) -> None:
        execute(
            self.conn,
            "UPDATE form_questions SET last_unresolved_reason = ? WHERE id = ?",
            (reason, question_id),
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
        needs_review: bool | None,
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
        if needs_review is not None:
            actionable = (
                "(q.review_state = 'open' AND "
                "(q.capture_conflict = 1 OR m.id IS NULL OR m.status <> 'active'))"
            )
            conditions.append(actionable if needs_review else f"NOT {actionable}")
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

    def get_answer(self, answer_id: str) -> Row | None:
        return query_one(
            self.conn,
            "SELECT id, answer_key, label, description, value_kind, value_json, status, "
            "fill_policy, revision, verified_at, created_at, updated_at "
            "FROM form_answers WHERE id = ?",
            (answer_id,),
        )

    def get_answer_by_key(self, answer_key: str) -> Row | None:
        return query_one(
            self.conn,
            "SELECT id, answer_key, label, description, value_kind, value_json, status, "
            "fill_policy, revision, verified_at, created_at, updated_at "
            "FROM form_answers WHERE answer_key = ?",
            (answer_key,),
        )

    def list_answers(
        self,
        *,
        status: str | None,
        value_kind: str | None,
        query: str | None,
        limit: int,
        cursor_values: tuple[str, str] | None,
    ) -> tuple[list[Row], bool]:
        conditions: list[str] = []
        params: list[object] = []
        if status is not None:
            conditions.append("a.status = ?")
            params.append(status)
        if value_kind is not None:
            conditions.append("a.value_kind = ?")
            params.append(value_kind)
        if query is not None:
            conditions.append(
                "(instr(lower(a.answer_key), ?) > 0 OR instr(lower(a.label), ?) > 0 "
                "OR instr(lower(coalesce(a.description, '')), ?) > 0)"
            )
            params.extend([query, query, query])
        if cursor_values is not None:
            updated_at, answer_id = cursor_values
            conditions.append("(a.updated_at < ? OR (a.updated_at = ? AND a.id < ?))")
            params.extend([updated_at, updated_at, answer_id])
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        rows = query_all(
            self.conn,
            "SELECT a.id, a.answer_key, a.label, a.description, a.value_kind, a.status, "
            "a.fill_policy, a.revision, a.updated_at, COUNT(m.id) AS mapping_count "
            "FROM form_answers a LEFT JOIN form_question_mappings m ON m.answer_id = a.id "
            f"{where} GROUP BY a.id ORDER BY a.updated_at DESC, a.id DESC LIMIT ?",
            (*params, limit + 1),
        )
        return rows[:limit], len(rows) > limit

    def list_answer_choices(self, answer_id: str) -> list[Row]:
        return query_all(
            self.conn,
            "SELECT id, choice_key, display_label, status FROM form_answer_choices "
            "WHERE answer_id = ? ORDER BY choice_key, id",
            (answer_id,),
        )

    def get_answer_choice(self, choice_id: str) -> Row | None:
        return query_one(
            self.conn,
            "SELECT id, answer_id, choice_key, display_label, status "
            "FROM form_answer_choices WHERE id = ?",
            (choice_id,),
        )

    def list_answer_mappings(self, answer_id: str) -> list[Row]:
        return query_all(
            self.conn,
            f"SELECT {_QUALIFIED_QUESTION_COLUMNS}, m.id AS mapping_id, "
            "m.answer_id AS mapping_answer_id, m.status AS mapping_status, "
            "m.revision AS mapping_revision FROM form_questions q "
            "JOIN form_question_mappings m ON m.question_id = q.id "
            "WHERE m.answer_id = ? ORDER BY q.last_seen_at DESC, q.id DESC",
            (answer_id,),
        )

    def list_answer_events(self, answer_id: str, limit: int = 50) -> list[Row]:
        return query_all(
            self.conn,
            "SELECT id, event, before_revision, after_revision, reason, created_at "
            "FROM form_knowledge_events WHERE answer_id = ? OR before_answer_id = ? "
            "OR after_answer_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
            (answer_id, answer_id, answer_id, limit),
        )

    def insert_answer(
        self,
        *,
        answer_id: str,
        answer_key: str,
        label: str,
        description: str | None,
        value_kind: str,
        value_json: str,
        fill_policy: str,
        now: str,
    ) -> None:
        execute(
            self.conn,
            "INSERT INTO form_answers (id, answer_key, label, description, value_kind, "
            "value_json, status, fill_policy, revision, verified_at, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 1, ?, ?, ?)",
            (
                answer_id,
                answer_key,
                label,
                description,
                value_kind,
                value_json,
                fill_policy,
                now,
                now,
                now,
            ),
        )

    def replace_answer_choices(
        self, answer_id: str, choices: list[tuple[str, str, str, str]], now: str
    ) -> None:
        execute(self.conn, "DELETE FROM form_answer_choices WHERE answer_id = ?", (answer_id,))
        for choice_id, choice_key, display_label, status in choices:
            execute(
                self.conn,
                "INSERT INTO form_answer_choices (id, answer_id, choice_key, display_label, "
                "status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (choice_id, answer_id, choice_key, display_label, status, now, now),
            )

    def choice_is_bound(self, choice_id: str) -> bool:
        return (
            query_one(
                self.conn,
                "SELECT 1 AS present FROM form_mapping_option_bindings "
                "WHERE answer_choice_id = ? LIMIT 1",
                (choice_id,),
            )
            is not None
        )

    def update_answer_choice(
        self, choice_id: str, display_label: str, status: str, now: str
    ) -> None:
        execute(
            self.conn,
            "UPDATE form_answer_choices SET display_label = ?, status = ?, updated_at = ? "
            "WHERE id = ?",
            (display_label, status, now, choice_id),
        )

    def insert_answer_choice(
        self,
        choice_id: str,
        answer_id: str,
        choice_key: str,
        display_label: str,
        status: str,
        now: str,
    ) -> None:
        execute(
            self.conn,
            "INSERT INTO form_answer_choices (id, answer_id, choice_key, display_label, "
            "status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (choice_id, answer_id, choice_key, display_label, status, now, now),
        )

    def delete_answer_choice(self, choice_id: str) -> None:
        execute(self.conn, "DELETE FROM form_answer_choices WHERE id = ?", (choice_id,))

    def update_answer(
        self,
        answer_id: str,
        *,
        expected_revision: int,
        answer_key: str,
        label: str,
        description: str | None,
        value_json: str,
        status: str,
        fill_policy: str,
        now: str,
    ) -> None:
        execute(
            self.conn,
            "UPDATE form_answers SET answer_key = ?, label = ?, description = ?, value_json = ?, "
            "status = ?, fill_policy = ?, revision = revision + 1, verified_at = ?, updated_at = ? "
            "WHERE id = ? AND revision = ?",
            (
                answer_key,
                label,
                description,
                value_json,
                status,
                fill_policy,
                now,
                now,
                answer_id,
                expected_revision,
            ),
        )

    def answer_has_mappings(self, answer_id: str) -> bool:
        return (
            query_one(
                self.conn,
                "SELECT 1 AS present FROM form_question_mappings WHERE answer_id = ? LIMIT 1",
                (answer_id,),
            )
            is not None
        )

    def delete_answer(self, answer_id: str) -> None:
        # Shared history can mention a formerly mapped Answer in addition to its
        # surviving Question, Match, or Capture. Clear only the deleted identity;
        # rows that described the Answer alone become unaddressable and are removed.
        execute(
            self.conn,
            "UPDATE form_knowledge_events SET "
            "answer_id = CASE WHEN answer_id = ? THEN NULL ELSE answer_id END, "
            "before_answer_id = CASE WHEN before_answer_id = ? THEN NULL ELSE before_answer_id END, "
            "after_answer_id = CASE WHEN after_answer_id = ? THEN NULL ELSE after_answer_id END "
            "WHERE answer_id = ? OR before_answer_id = ? OR after_answer_id = ?",
            (answer_id, answer_id, answer_id, answer_id, answer_id, answer_id),
        )
        execute(
            self.conn,
            "DELETE FROM form_knowledge_events WHERE answer_id IS NULL "
            "AND before_answer_id IS NULL AND after_answer_id IS NULL "
            "AND mapping_id IS NULL AND question_id IS NULL AND capture_id IS NULL",
        )
        execute(self.conn, "DELETE FROM form_answer_choices WHERE answer_id = ?", (answer_id,))
        execute(self.conn, "DELETE FROM form_answers WHERE id = ?", (answer_id,))

    def insert_mapping(self, mapping_id: str, question_id: str, answer_id: str, now: str) -> None:
        execute(
            self.conn,
            "INSERT INTO form_question_mappings (id, question_id, answer_id, status, "
            "revision, approved_at, created_at, updated_at) "
            "VALUES (?, ?, ?, 'active', 1, ?, ?, ?)",
            (mapping_id, question_id, answer_id, now, now, now),
        )

    def update_mapping(
        self, mapping_id: str, *, answer_id: str, status: str, expected_revision: int, now: str
    ) -> None:
        execute(
            self.conn,
            "UPDATE form_question_mappings SET answer_id = ?, status = ?, "
            "revision = revision + 1, approved_at = ?, updated_at = ? "
            "WHERE id = ? AND revision = ?",
            (answer_id, status, now, now, mapping_id, expected_revision),
        )

    def replace_bindings(self, mapping_id: str, bindings: list[tuple[str, str]], now: str) -> None:
        execute(
            self.conn,
            "DELETE FROM form_mapping_option_bindings WHERE mapping_id = ?",
            (mapping_id,),
        )
        for question_option_id, answer_choice_id in bindings:
            execute(
                self.conn,
                "INSERT INTO form_mapping_option_bindings "
                "(mapping_id, question_option_id, answer_choice_id, created_at) "
                "VALUES (?, ?, ?, ?)",
                (mapping_id, question_option_id, answer_choice_id, now),
            )

    def get_capture(self, capture_id: str) -> Row | None:
        return query_one(
            self.conn,
            "SELECT id, capture_key, question_id, mapping_id, answer_revision_used, "
            "mapping_revision_used, application_context_id, job_id, listing_id, source, "
            "value_kind, value_json, status, superseded_by_id, revision, created_at, "
            "updated_at, resolved_at FROM form_captures WHERE id = ?",
            (capture_id,),
        )

    def get_capture_by_key(self, capture_key: str) -> Row | None:
        row = query_one(
            self.conn, "SELECT id FROM form_captures WHERE capture_key = ?", (capture_key,)
        )
        return self.get_capture(row["id"]) if row else None

    def list_capture_rows(
        self,
        *,
        status: str | None,
        source: str | None,
        question_id: str | None,
        query: str | None,
        limit: int,
        cursor_values: tuple[str, str] | None,
    ) -> tuple[list[Row], bool]:
        conditions: list[str] = []
        params: list[object] = []
        if status is not None:
            conditions.append("c.status = ?")
            params.append(status)
        if source is not None:
            conditions.append("c.source = ?")
            params.append(source)
        if question_id is not None:
            conditions.append("c.question_id = ?")
            params.append(question_id)
        if query is not None:
            conditions.append("instr(q.normalized_question, ?) > 0")
            params.append(query)
        if cursor_values is not None:
            updated_at, capture_id = cursor_values
            conditions.append("(c.updated_at < ? OR (c.updated_at = ? AND c.id < ?))")
            params.extend([updated_at, updated_at, capture_id])
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        rows = query_all(
            self.conn,
            "SELECT c.id, c.capture_key, c.question_id, c.mapping_id, "
            "c.answer_revision_used, c.mapping_revision_used, c.application_context_id, "
            "c.job_id, c.listing_id, c.source, c.value_kind, c.value_json, c.status, "
            "c.superseded_by_id, c.revision, c.created_at, c.updated_at, c.resolved_at "
            "FROM form_captures c JOIN form_questions q ON q.id = c.question_id "
            f"{where} ORDER BY c.updated_at DESC, c.id DESC LIMIT ?",
            (*params, limit + 1),
        )
        return rows[:limit], len(rows) > limit

    def insert_capture(
        self,
        *,
        capture_id: str,
        capture_key: str,
        question_id: str,
        mapping_id: str | None,
        answer_revision_used: int | None,
        mapping_revision_used: int | None,
        application_context_id: str,
        job_id: str | None,
        listing_id: str | None,
        source: str,
        value_kind: str,
        value_json: str,
        now: str,
    ) -> None:
        execute(
            self.conn,
            "INSERT INTO form_captures (id, capture_key, question_id, mapping_id, "
            "answer_revision_used, mapping_revision_used, application_context_id, job_id, "
            "listing_id, source, value_kind, value_json, status, revision, created_at, "
            "updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'current', 1, ?, ?)",
            (
                capture_id,
                capture_key,
                question_id,
                mapping_id,
                answer_revision_used,
                mapping_revision_used,
                application_context_id,
                job_id,
                listing_id,
                source,
                value_kind,
                value_json,
                now,
                now,
            ),
        )

    def transition_capture(
        self,
        capture_id: str,
        *,
        expected_revision: int,
        status: str,
        now: str,
        superseded_by_id: str | None = None,
        clear_value: bool = False,
    ) -> None:
        execute(
            self.conn,
            "UPDATE form_captures SET status = ?, superseded_by_id = ?, "
            "value_json = CASE WHEN ? THEN NULL ELSE value_json END, revision = revision + 1, "
            "updated_at = ?, resolved_at = CASE WHEN ? = 'current' THEN NULL ELSE ? END "
            "WHERE id = ? AND revision = ?",
            (
                status,
                superseded_by_id,
                1 if clear_value else 0,
                now,
                status,
                now,
                capture_id,
                expected_revision,
            ),
        )

    def set_question_conflict(
        self, question_id: str, conflict: bool, expected_revision: int, now: str
    ) -> None:
        execute(
            self.conn,
            "UPDATE form_questions SET capture_conflict = ?, revision = revision + 1, "
            "last_unresolved_reason = ?, last_seen_at = last_seen_at "
            "WHERE id = ? AND revision = ?",
            (
                1 if conflict else 0,
                "capture_conflict" if conflict else "no_knowledge",
                question_id,
                expected_revision,
            ),
        )

    def list_capture_events(self, capture_id: str, limit: int = 50) -> list[Row]:
        return query_all(
            self.conn,
            "SELECT id, event, before_revision, after_revision, reason, created_at "
            "FROM form_knowledge_events WHERE capture_id = ? "
            "ORDER BY created_at DESC, id DESC LIMIT ?",
            (capture_id, limit),
        )

    def insert_event(
        self,
        *,
        event_id: str,
        event: str,
        answer_id: str | None = None,
        mapping_id: str | None = None,
        question_id: str | None = None,
        capture_id: str | None = None,
        before_answer_id: str | None = None,
        after_answer_id: str | None = None,
        before_revision: int | None = None,
        after_revision: int | None = None,
        reason: str | None = None,
        now: str,
    ) -> None:
        execute(
            self.conn,
            "INSERT INTO form_knowledge_events (id, event, answer_id, mapping_id, "
            "question_id, capture_id, before_answer_id, after_answer_id, before_revision, "
            "after_revision, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                event_id,
                event,
                answer_id,
                mapping_id,
                question_id,
                capture_id,
                before_answer_id,
                after_answer_id,
                before_revision,
                after_revision,
                reason,
                now,
            ),
        )

    def list_current_captures(self, question_id: str) -> list[Row]:
        return query_all(
            self.conn,
            "SELECT id, source, value_kind, status, revision, created_at FROM form_captures "
            "WHERE question_id = ? AND status = 'current' ORDER BY created_at DESC, id DESC",
            (question_id,),
        )

    def list_current_capture_records(self, question_id: str) -> list[Row]:
        return query_all(
            self.conn,
            "SELECT id, capture_key, question_id, mapping_id, answer_revision_used, "
            "mapping_revision_used, application_context_id, job_id, listing_id, source, "
            "value_kind, value_json, status, superseded_by_id, revision, created_at, "
            "updated_at, resolved_at FROM form_captures "
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
            "capture_conflict = CASE WHEN ? = 'ignored' THEN 0 ELSE capture_conflict END, "
            "last_unresolved_reason = ?, last_seen_at = last_seen_at "
            "WHERE id = ? AND revision = ?",
            (
                review_state,
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
