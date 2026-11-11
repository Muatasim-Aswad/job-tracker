"""Require every funnel event to share its value with the status it sets."""

from app.shared.enums import Event, Status, flag_for_event, status_for_event

_FLAG_EVENTS = {Event.HIDDEN, Event.UNHIDDEN, Event.STARRED, Event.UNSTARRED}
# `created` is server-only; `note` is a stage-agnostic manual log entry. Neither
# sets a status, so neither is a funnel event.
_NON_FUNNEL = _FLAG_EVENTS | {Event.CREATED, Event.NOTE}


def test_every_funnel_event_resolves_to_a_status() -> None:
    for event in Event:
        if event in _NON_FUNNEL:
            continue
        assert status_for_event(event.value) is not None, event


def test_every_status_except_new_has_a_matching_event() -> None:
    # `new` is the birth state (recorded via `created`), never an event; every
    # other status is reachable by an identically-named funnel event.
    event_values = {e.value for e in Event}
    for status in Status:
        if status is Status.NEW:
            assert status.value not in event_values
            continue
        assert status.value in event_values, status


def test_created_is_neither_funnel_nor_flag() -> None:
    assert status_for_event(Event.CREATED.value) is None
    assert flag_for_event(Event.CREATED.value) is None


def test_flag_events_resolve_to_a_flag_not_a_status() -> None:
    for event in _FLAG_EVENTS:
        assert status_for_event(event.value) is None, event
        assert flag_for_event(event.value) is not None, event
