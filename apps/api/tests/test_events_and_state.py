"""State changes via POST /events: the submission decision table, guards, flag
meta-gated logging, `created` provenance, and state independence."""

from typing import Any

import pytest
from fastapi.testclient import TestClient


def _listing(client: TestClient, platform: str, platform_id: str, **extra: Any) -> dict[str, Any]:
    body = {"platform": platform, "platform_id": platform_id, **extra}
    return client.post("/api/listings", json=body).json()


def _emit(client: TestClient, event: str, *, meta: Any = None, ts: str | None = None, **addr: Any):
    """POST a single-event submission in the batched shape (address + events[]). `ts`
    is the submission-level timestamp shared by its events (defaults to now)."""
    item: dict[str, Any] = {"event": event}
    if meta is not None:
        item["meta"] = meta
    body: dict[str, Any] = {**addr, "events": [item]}
    if ts is not None:
        body["ts"] = ts
    return client.post("/api/events", json=body)


def _events(client: TestClient, job_id: str, kind: str) -> list[dict[str, Any]]:
    detail = client.get(f"/api/jobs/{job_id}").json()
    return [e for e in detail["events"] if e["event"] == kind]


def _state(client: TestClient, platform: str, platform_id: str) -> dict[str, Any]:
    """One listing's state via the batch endpoint (the only state read). Batch is
    total, so an untracked id comes back as `status: "untracked"`, never a 404."""
    result = client.get(
        "/api/jobs/states", params={"platform": platform, "platform_ids": [platform_id]}
    ).json()
    return result[0]


# --- seen (the view signal) --------------------------------------------------


def test_seen_advances_new_to_seen_and_logs_once(client: TestClient) -> None:
    job = _listing(client, "linkedin", "555", title="A")
    r = _emit(client, "seen", platform="linkedin", platform_id="555")
    assert r.status_code == 200
    assert r.json()["status"] == "seen"
    assert len(_events(client, job["job_id"], "seen")) == 1
    # Re-viewing is a monotonic no-op: no second seen row.
    _emit(client, "seen", platform="linkedin", platform_id="555")
    assert len(_events(client, job["job_id"], "seen")) == 1


def test_seen_does_not_downgrade_a_later_status(client: TestClient) -> None:
    job = _listing(client, "linkedin", "1", title="A")
    _emit(client, "applied", platform="linkedin", platform_id="1")
    _emit(client, "seen", platform="linkedin", platform_id="1")
    assert _state(client, "linkedin", "1")["status"] == "applied"
    assert _events(client, job["job_id"], "seen") == []  # never fired


def test_seen_before_listing_stubs_job_with_created_provenance(client: TestClient) -> None:
    r = _emit(client, "seen", platform="linkedin", platform_id="777")
    assert r.status_code == 200 and r.json()["status"] == "seen"
    assert _state(client, "linkedin", "777")["status"] == "seen"  # tracked now
    # The stub's `created` event records how it was born.
    detail_job = _listing(client, "linkedin", "777")  # resolve to job_id via upsert (idempotent)
    created = _events(client, detail_job["job_id"], "created")
    assert created and created[0]["meta"] == {"via": "seen"}


# --- funnel transitions & guards ---------------------------------------------


def test_status_change_via_listing_logs_event_with_meta(client: TestClient) -> None:
    job = _listing(client, "linkedin", "1", title="A")
    _emit(
        client,
        "rejected",
        meta={"by": "auto-applier", "reason": "salary"},
        platform="linkedin",
        platform_id="1",
    )
    assert _state(client, "linkedin", "1")["status"] == "rejected"
    rejected = _events(client, job["job_id"], "rejected")
    assert len(rejected) == 1
    assert rejected[0]["meta"] == {"by": "auto-applier", "reason": "salary"}


def test_listing_addressed_status_cannot_clobber_terminal(client: TestClient) -> None:
    _listing(client, "linkedin", "1", title="A")
    _emit(client, "rejected", platform="linkedin", platform_id="1")
    # An automatic (listing-addressed) active status can't revive a terminal one.
    _emit(client, "applied", platform="linkedin", platform_id="1")
    assert _state(client, "linkedin", "1")["status"] == "rejected"


def test_listing_addressed_status_cannot_walk_active_funnel_backward(client: TestClient) -> None:
    job = _listing(client, "linkedin", "1", title="A")
    # Advance past applied via an ordinary dashboard event.
    _emit(client, "in_process", job_id=job["job_id"])
    # A re-detected automatic (listing-addressed) `applied` must not downgrade it.
    _emit(client, "applied", platform="linkedin", platform_id="1")
    assert _state(client, "linkedin", "1")["status"] == "in_process"
    assert _events(client, job["job_id"], "applied") == []  # never logged either


def test_job_addressed_status_cannot_revive_terminal(client: TestClient) -> None:
    # Dashboard events obey the funnel too: a plain event can't reopen a terminal
    # outcome. Only a correction (or revert) moves against the funnel.
    job = _listing(client, "linkedin", "1", title="A")
    jid = job["job_id"]
    _emit(client, "rejected", job_id=jid)
    r = _emit(client, "in_process", job_id=jid)
    assert r.json()["status"] == "rejected"  # blocked, still terminal
    assert _events(client, jid, "in_process") == []  # never logged either


def test_job_addressed_status_cannot_reclassify_terminal(client: TestClient) -> None:
    # A terminal outcome is an end state: a plain event can't even swap it for a
    # *different* terminal (rejected -> skipped). Reclassifying is a deliberate
    # override, so it must go through the correction endpoint, not /events.
    job = _listing(client, "linkedin", "1", title="A")
    jid = job["job_id"]
    _emit(client, "rejected", job_id=jid)
    r = _emit(client, "skipped", job_id=jid)
    assert r.json()["status"] == "rejected"  # unchanged
    assert _events(client, jid, "skipped") == []  # never logged either


def test_applied_can_be_ghosted_and_ghosted_is_terminal(client: TestClient) -> None:
    # A silent application: applied -> ghosted is a legal forward move (ghosted is a
    # terminal outcome), and once ghosted no plain event revives or reclassifies it.
    job = _listing(client, "linkedin", "1", title="A")
    jid = job["job_id"]
    _emit(client, "applied", job_id=jid)
    r = _emit(client, "ghosted", job_id=jid)
    assert r.json()["status"] == "ghosted"
    assert len(_events(client, jid, "ghosted")) == 1
    # Terminal: a later plain event can't move it (revive or reclassify).
    assert _emit(client, "in_process", job_id=jid).json()["status"] == "ghosted"
    assert _emit(client, "rejected", job_id=jid).json()["status"] == "ghosted"


def test_in_process_can_be_ghosted(client: TestClient) -> None:
    job = _listing(client, "linkedin", "in-process-ghost", title="A")
    jid = job["job_id"]
    _emit(client, "in_process", job_id=jid)
    assert _emit(client, "ghosted", job_id=jid).json()["status"] == "ghosted"
    assert len(_events(client, jid, "ghosted")) == 1


@pytest.mark.parametrize(
    "status", ["new", "seen", "to_apply", "offered", "skipped", "closed", "withdrawn", "rejected"]
)
def test_plain_ghosted_is_silent_noop_outside_stalled_stages(
    client: TestClient, status: str
) -> None:
    job = _listing(client, "linkedin", f"ghost-guard-{status}", title="A")
    jid = job["job_id"]
    if status != "new":
        if status in {"skipped", "closed"}:
            _emit(client, status, job_id=jid)
        elif status in {"withdrawn", "rejected"}:
            _emit(client, "applied", job_id=jid)
            _emit(client, status, job_id=jid)
        else:
            _emit(client, status, job_id=jid)

    response = _emit(client, "ghosted", job_id=jid)
    assert response.status_code == 200
    assert response.json()["status"] == status
    assert _events(client, jid, "ghosted") == []


def test_job_addressed_status_cannot_walk_backward(client: TestClient) -> None:
    # A dashboard misclick (dragging a card to an earlier column) is not an event;
    # the client must route a backward move through the correction endpoint.
    job = _listing(client, "linkedin", "1", title="A")
    jid = job["job_id"]
    _emit(client, "in_process", job_id=jid)
    r = _emit(client, "applied", job_id=jid)
    assert r.json()["status"] == "in_process"  # no downgrade
    assert _events(client, jid, "applied") == []


def test_job_addressed_status_advances_forward_freely(client: TestClient) -> None:
    # Forward is always fine, and the dashboard may skip stages ahead.
    job = _listing(client, "linkedin", "1", title="A")
    jid = job["job_id"]
    r = _emit(client, "in_process", job_id=jid)  # new -> in_process, skipping stages
    assert r.json()["status"] == "in_process"


# --- latest-ts-wins projection (a backdated event is logged, not projected) --


def test_backdated_terminal_does_not_override_newer_active(client: TestClient) -> None:
    # A now-stamped active status, then a stale terminal backdated months earlier (a
    # mislabeled bulk import). The terminal is still *logged* for the audit trail, but
    # the newer-ts active status keeps the projection.
    job = _listing(client, "linkedin", "1", title="A")
    jid = job["job_id"]
    _emit(client, "in_process", job_id=jid)  # now-stamped
    r = _emit(client, "rejected", job_id=jid, ts="2026-05-21T00:00:00+00:00")
    assert r.json()["status"] == "in_process"  # reprojected, terminal loses on ts
    assert _state(client, "linkedin", "1")["status"] == "in_process"
    assert len(_events(client, jid, "rejected")) == 1  # but still recorded


def test_backdated_active_does_not_override_newer_active(client: TestClient) -> None:
    # A backdated forward move (older ts) is a legal transition and gets logged, but
    # the newer-ts status still wins the projection.
    job = _listing(client, "linkedin", "1", title="A")
    jid = job["job_id"]
    _emit(client, "in_process", job_id=jid)  # now-stamped
    r = _emit(client, "offered", job_id=jid, ts="2026-05-21T00:00:00+00:00")
    assert r.json()["status"] == "in_process"  # newer in_process keeps projection
    assert len(_events(client, jid, "offered")) == 1  # logged nonetheless


def test_redundant_status_submission_is_a_noop(client: TestClient) -> None:
    job = _listing(client, "linkedin", "1", title="A")
    _emit(client, "applied", platform="linkedin", platform_id="1")
    _emit(client, "applied", platform="linkedin", platform_id="1")
    assert len(_events(client, job["job_id"], "applied")) == 1  # no duplicate row


# --- flags: meta-gated logging + independence ----------------------------


def test_hide_before_open_stubs_without_advancing_status(client: TestClient) -> None:
    r = _emit(client, "hidden", platform="linkedin", platform_id="never")
    assert r.status_code == 200
    s = r.json()
    assert s["hidden"] is True and s["status"] == "new" and s["starred"] is False
    # Born via the hide; `created` records it, and the meta-less hide logs nothing.
    job = _listing(client, "linkedin", "never")
    assert _events(client, job["job_id"], "created")[0]["meta"] == {"via": "hidden"}
    assert _events(client, job["job_id"], "hidden") == []


def test_flag_logs_only_with_novel_meta(client: TestClient) -> None:
    job = _listing(client, "linkedin", "1", title="A")
    jid = job["job_id"]
    # No meta → state changes, nothing logged.
    _emit(client, "hidden", job_id=jid)
    assert _events(client, jid, "hidden") == []
    # With a reason → logged.
    _emit(client, "unhidden", job_id=jid)
    _emit(client, "hidden", meta={"reason": "applied elsewhere"}, job_id=jid)
    assert len(_events(client, jid, "hidden")) == 1
    # Same reason again → duplicate, not logged.
    _emit(client, "unhidden", job_id=jid)
    _emit(client, "hidden", meta={"reason": "applied elsewhere"}, job_id=jid)
    assert len(_events(client, jid, "hidden")) == 1
    # New reason → novel, logged.
    _emit(client, "unhidden", job_id=jid)
    _emit(client, "hidden", meta={"reason": "stale"}, job_id=jid)
    assert len(_events(client, jid, "hidden")) == 2


def test_status_hidden_starred_stay_independent(client: TestClient) -> None:
    job = _listing(client, "linkedin", "1", title="A")
    jid = job["job_id"]
    _emit(client, "applied", job_id=jid)
    _emit(client, "hidden", job_id=jid)
    _emit(client, "starred", job_id=jid)
    s = _state(client, "linkedin", "1")
    assert s["status"] == "applied" and s["hidden"] is True and s["starred"] is True
    _emit(client, "unhidden", job_id=jid)
    s = _state(client, "linkedin", "1")
    assert s["status"] == "applied" and s["hidden"] is False and s["starred"] is True


# --- addressing validation ---------------------------------------------------


def test_created_is_not_client_submittable(client: TestClient) -> None:
    _listing(client, "linkedin", "1", title="A")
    r = _emit(client, "created", platform="linkedin", platform_id="1")
    assert r.status_code == 422


def test_event_requires_exactly_one_addressing_mode(client: TestClient) -> None:
    job = _listing(client, "linkedin", "1", title="A")
    neither = {"events": [{"event": "applied"}]}
    assert client.post("/api/events", json=neither).status_code == 422  # neither
    both = {
        "events": [{"event": "applied"}],
        "platform": "linkedin",
        "platform_id": "1",
        "job_id": job["job_id"],
    }
    assert client.post("/api/events", json=both).status_code == 422  # both


def test_empty_events_list_is_rejected(client: TestClient) -> None:
    _listing(client, "linkedin", "1", title="A")
    r = client.post("/api/events", json={"platform": "linkedin", "platform_id": "1", "events": []})
    assert r.status_code == 422


def test_batched_events_apply_in_order_in_one_request(client: TestClient) -> None:
    """A fan-out UI action (skip = `skipped` + `hidden`) is one submission: both
    events apply in order and the response carries the final state."""
    job = _listing(client, "linkedin", "1", title="A")
    r = client.post(
        "/api/events",
        json={
            "platform": "linkedin",
            "platform_id": "1",
            "events": [{"event": "skipped"}, {"event": "hidden"}],
        },
    )
    assert r.status_code == 200
    s = r.json()
    assert s["status"] == "skipped" and s["hidden"] is True
    # Each event still logged/applied on its own terms: skipped is a real transition.
    assert len(_events(client, job["job_id"], "skipped")) == 1


# --- reads still work ---------------------------------------------------------


def test_batch_state_lookup(client: TestClient) -> None:
    _listing(client, "linkedin", "1", title="A")
    _listing(client, "linkedin", "2", title="B")
    result = client.get(
        "/api/jobs/states", params={"platform": "linkedin", "platform_ids": ["1", "2", "missing"]}
    ).json()
    by_id = {r["platform_id"]: r for r in result}
    assert [r["platform_id"] for r in result] == ["1", "2", "missing"]
    assert "job_id" not in by_id["1"]
    assert by_id["1"]["status"] == "new"
    assert by_id["missing"]["status"] == "untracked"  # total: no 404, reads as untracked


# --- dashboard identity edits ------------------------------------------------


def test_patch_job_edits_identity_not_state(client: TestClient) -> None:
    job = _listing(client, "linkedin", "1", title="A", company="X")
    _emit(client, "applied", job_id=job["job_id"])
    r = client.patch(f"/api/jobs/{job['job_id']}", json={"title": "B", "status": "new"})
    assert r.status_code == 200
    detail = client.get(f"/api/jobs/{job['job_id']}").json()
    assert detail["title"] == "B"  # identity edited
    assert detail["status"] == "applied"  # status untouched (not settable here)


def test_documents_and_stats(client: TestClient) -> None:
    listing = _listing(client, "linkedin", "1", title="A", apply_type="external")
    for doc_type in ("cover_letter", "cv", "other"):
        doc = client.post(
            f"/api/jobs/{listing['job_id']}/documents",
            json={"type": doc_type, "requested": "required", "provided": True, "content": "x"},
        )
        assert doc.status_code == 201, doc.text
    _emit(client, "applied", platform="linkedin", platform_id="1")

    stats = client.get("/api/stats").json()
    assert stats["total_jobs"] == 1
    assert stats["funnel"].get("applied") == 1
    assert stats["apply_type"].get("external") == 1
    detail = client.get(f"/api/jobs/{listing['job_id']}").json()
    assert len(detail["documents"]) == 3
