"""Authoritative funnel enums and forward-only guards. packages/shared/src/funnel/index.ts mirrors these rules; server-generated funnel.contract.json pins the TypeScript contract."""

from enum import StrEnum


class Status(StrEnum):
    # Sequential active stages.
    NEW = "new"
    SEEN = "seen"
    TO_APPLY = "to_apply"
    APPLIED = "applied"
    IN_PROCESS = "in_process"
    OFFERED = "offered"
    # Terminal outcomes differ by who ended the opportunity.
    SKIPPED = "skipped"
    CLOSED = "closed"
    WITHDRAWN = "withdrawn"
    REJECTED = "rejected"
    # An application that got no employer response at all, distinct from a rejection
    # (they answered) or a closed posting. Terminal, reached from applied.
    GHOSTED = "ghosted"


# Compared by string value so both raw strings and Status members work the same.
_TERMINAL_VALUES: frozenset[str] = frozenset(
    s.value
    for s in (Status.SKIPPED, Status.CLOSED, Status.WITHDRAWN, Status.REJECTED, Status.GHOSTED)
)


def is_terminal(status: str) -> bool:
    return str(status) in _TERMINAL_VALUES


# Position in the active (sequential) funnel. Terminal outcomes are absent: they're
# not stages, so they have no rank.
_ACTIVE_ORDER: dict[str, int] = {
    Status.NEW.value: 0,
    Status.SEEN.value: 1,
    Status.TO_APPLY.value: 2,
    Status.APPLIED.value: 3,
    Status.IN_PROCESS.value: 4,
    Status.OFFERED.value: 5,
}


def active_rank(status: str) -> int | None:
    """Rank within the active funnel, or None for terminal/unknown statuses."""
    return _ACTIVE_ORDER.get(str(status))


# Advisory application-count evidence: post-apply stages and outcomes, excluding
# skipped/closed. This set never drives state transitions.
APPLIED_EVIDENCE: frozenset[str] = frozenset(
    s.value
    for s in (
        Status.APPLIED,
        Status.IN_PROCESS,
        Status.OFFERED,
        Status.WITHDRAWN,
        Status.REJECTED,
        Status.GHOSTED,
    )
)


# Live and offline merges share survivor ranks. Post-application stages and outcomes
# outrank pre-application signals to preserve submitted history; earlier ranks break ties.
MERGE_IMPORTANCE: dict[str, int] = {
    Status.NEW.value: 0,
    Status.SEEN.value: 1,
    Status.SKIPPED.value: 2,
    Status.CLOSED.value: 3,
    Status.TO_APPLY.value: 4,
    Status.APPLIED.value: 5,
    Status.REJECTED.value: 5,
    Status.WITHDRAWN.value: 5,
    Status.IN_PROCESS.value: 6,
    Status.OFFERED.value: 7,
}


class Event(StrEnum):
    # Server-generated at job birth (never client-submitted); meta records `via`.
    CREATED = "created"
    # Funnel-status events — each sets the matching status. `seen` is the (once,
    # monotonic) funnel entry; `new` has no event.
    SEEN = "seen"
    TO_APPLY = "to_apply"
    APPLIED = "applied"
    IN_PROCESS = "in_process"
    OFFERED = "offered"
    SKIPPED = "skipped"
    WITHDRAWN = "withdrawn"
    REJECTED = "rejected"
    CLOSED = "closed"
    GHOSTED = "ghosted"
    # Flag events — toggle a boolean; logged only when they carry novel meta.
    HIDDEN = "hidden"
    UNHIDDEN = "unhidden"
    STARRED = "starred"
    UNSTARRED = "unstarred"
    # A manual log entry: dated activity (a call, a follow-up) that moves no funnel
    # state. Setting no status and no flag puts it outside the lifecycle, so undo and
    # correct never touch it. Always logged, freely editable and deletable.
    NOTE = "note"


# A flag event sets (column, value) — NOT an identity map, so it's spelled out.
_EVENT_FLAG: dict[Event, tuple[str, bool]] = {
    Event.HIDDEN: ("hidden", True),
    Event.UNHIDDEN: ("hidden", False),
    Event.STARRED: ("starred", True),
    Event.UNSTARRED: ("starred", False),
}


def status_for_event(event: str) -> Status | None:
    """Resolve an event to its namesake status, or None for non-status verbs. Jobs are born new through created; new is not a client event."""
    try:
        return Status(event)
    except ValueError:
        return None


def flag_for_event(event: str) -> tuple[str, bool] | None:
    try:
        return _EVENT_FLAG.get(Event(event))
    except ValueError:
        return None


# The indexed prefix distinguishes deliberate corrections from organic events.
# Encode only the target status; the previous state is recoverable from history.
CORRECTION_PREFIX = "corrected:"


def correction_event(status: Status) -> str:
    """The event value logged for a correction that sets `status`."""
    return f"{CORRECTION_PREFIX}{status.value}"


def parse_correction(event: str) -> Status | None:
    """Resolve a corrected:<status> verb, or None for an unknown status or other verb. Corrections are the explicit override path."""
    if not event.startswith(CORRECTION_PREFIX):
        return None
    return status_for_event(event[len(CORRECTION_PREFIX) :])


def status_set_by(event: str) -> str | None:
    """Status set by an organic event or correction, or None for other verbs. Projection replays both kinds in timestamp/ID order."""
    organic = status_for_event(event)
    if organic is not None:
        return organic.value
    corrected = parse_correction(event)
    return corrected.value if corrected is not None else None


def target_status(event: str, current: str) -> str | None:
    """Return the organic event target or None when guards refuse it. Writes and merges share these forward-only rules; correction/revert provide overrides. Projection separately chooses the latest timestamp/ID without this guard."""
    target = status_for_event(event)
    assert target is not None
    if target == Status.GHOSTED and current not in {Status.APPLIED.value, Status.IN_PROCESS.value}:
        # Ghosting describes a stalled application/process, not a generic close
        # outcome. Historical exceptions remain available through corrections.
        return None
    if target == Status.SEEN:
        return Status.SEEN.value if current == Status.NEW.value else None  # monotonic
    if is_terminal(current):
        # Terminal revival or reclassification requires correction/revert.
        # The caller handles repeating the same outcome as a no-op.
        return None if target.value != current else target.value
    # ...nor walk the active funnel backward: a re-detected `applied` on a job already
    # `in_process`, or a dashboard misclick, must not downgrade it.
    cur_rank, tgt_rank = active_rank(current), active_rank(target.value)
    if cur_rank is not None and tgt_rank is not None and tgt_rank < cur_rank:
        return None
    return target.value


class ListingAvailability(StrEnum):
    UNKNOWN = "unknown"
    OPEN = "open"
    UNAVAILABLE = "unavailable"
    CLOSED = "closed"


class ApplyType(StrEnum):
    EASY_APPLY = "easy_apply"
    EXTERNAL = "external"
    UNKNOWN = "unknown"


class DocumentType(StrEnum):
    # Deliverables tied to an application, each carrying `requested`/`provided`.
    # Free-form notes are not here: a dated note is a `note` event on the timeline,
    # a standing fact is a job annotation.
    COVER_LETTER = "cover_letter"
    MOTIVATION_LETTER = "motivation_letter"
    CV = "cv"
    OTHER = "other"
