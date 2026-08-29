"""Agent-facing application-workflow analytics and its lifecycle invariants."""

from typing import Any

from fastapi.testclient import TestClient


def _listing(client: TestClient, platform_id: str, **extra: Any) -> dict[str, Any]:
    response = client.post(
        "/api/listings", json={"platform": "linkedin", "platform_id": platform_id, **extra}
    )
    assert response.status_code == 200, response.text
    return response.json()


def _event(client: TestClient, job_id: str, event: str, *, by_listing: str | None = None) -> int:
    body: dict[str, Any]
    if by_listing is None:
        body = {"job_id": job_id, "events": [{"event": event}]}
    else:
        body = {"platform": "linkedin", "platform_id": by_listing, "events": [{"event": event}]}
    response = client.post("/api/events", json=body)
    assert response.status_code == 200, response.text
    events = client.get(f"/api/jobs/{job_id}").json()["events"]
    return next(row["id"] for row in reversed(events) if row["event"] == event)


def _payload(event_id: int, **changes: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "submitted_event_id": event_id,
        "preparation_lane": "agent_assisted",
        "submission_actor": "human",
        "submission_channel": "easy_apply",
        "narratives": [{"kind": "cover_letter", "provenance": "agent_drafted_human_edited"}],
        "measured_human_time_seconds": 420,
        "references": [
            {"kind": "agent_run", "role": "preparation", "ref": "agent-run:123"},
            {"kind": "submission_evidence", "role": "evidence", "ref": "receipt:linkedin:1"},
        ],
    }
    payload.update(changes)
    return payload


def test_put_is_singular_revision_checked_and_retry_idempotent(client: TestClient) -> None:
    listing = _listing(client, "1", title="Engineer")
    event_id = _event(client, listing["job_id"], "applied")
    url = f"/api/jobs/{listing['job_id']}/application-workflow"
    payload = _payload(event_id)

    created = client.put(url, json=payload)
    assert created.status_code == 201, created.text
    assert created.headers["cache-control"] == "no-store"
    assert created.headers["content-location"] == url
    assert created.json() == {
        "job_id": listing["job_id"],
        **payload,
        "revision": 1,
        "created_at": created.json()["created_at"],
        "updated_at": created.json()["updated_at"],
    }

    read = client.get(url)
    assert read.status_code == 200
    assert read.headers["cache-control"] == "no-store"
    assert read.json() == created.json()

    # Lost-response retry: the absence precondition is stale, but the complete
    # representation is identical, so PUT remains a no-op at revision 1.
    retry = client.put(url, json=payload)
    assert retry.status_code == 200
    assert retry.json() == created.json()

    changed = _payload(event_id, expected_revision=1, measured_human_time_seconds=480)
    updated = client.put(url, json=changed)
    assert updated.status_code == 200
    assert updated.json()["revision"] == 2
    assert updated.json()["measured_human_time_seconds"] == 480

    # Retrying the successful revision-1 update is also an idempotent no-op.
    update_retry = client.put(url, json=changed)
    assert update_retry.status_code == 200
    assert update_retry.json() == updated.json()

    stale = client.put(
        url, json=_payload(event_id, expected_revision=1, measured_human_time_seconds=900)
    )
    assert stale.status_code == 409
    assert stale.headers["cache-control"] == "no-store"
    assert stale.json()["detail"] == "stale_revision"
    assert stale.json()["current"]["revision"] == 2

    missing_precondition = client.put(url, json=_payload(event_id, measured_human_time_seconds=900))
    assert missing_precondition.status_code == 409
    assert missing_precondition.json()["detail"] == "application_workflow_exists"


def test_requires_current_and_specific_submitted_evidence(client: TestClient) -> None:
    first = _listing(client, "first")
    second = _listing(client, "second")
    first_created = client.get(f"/api/jobs/{first['job_id']}").json()["events"][0]["id"]
    url = f"/api/jobs/{first['job_id']}/application-workflow"

    not_submitted = client.put(url, json=_payload(first_created))
    assert not_submitted.status_code == 400
    assert not_submitted.json() == {"detail": "application_not_submitted"}

    first_applied = _event(client, first["job_id"], "applied")
    second_applied = _event(client, second["job_id"], "applied")
    wrong_job = client.put(url, json=_payload(second_applied))
    assert wrong_job.status_code == 400
    assert wrong_job.json() == {"detail": "submitted_event_must_confirm_application"}

    wrong_kind = client.put(url, json=_payload(first_created))
    assert wrong_kind.status_code == 400
    assert wrong_kind.json() == {"detail": "submitted_event_must_confirm_application"}

    valid = client.put(url, json=_payload(first_applied))
    assert valid.status_code == 201


def test_unknowns_are_explicit_and_payload_is_closed(client: TestClient) -> None:
    listing = _listing(client, "unknowns")
    event_id = _event(client, listing["job_id"], "applied")
    url = f"/api/jobs/{listing['job_id']}/application-workflow"
    explicit_unknowns = _payload(
        event_id,
        preparation_lane="unknown",
        submission_actor="unknown",
        submission_channel="unknown",
        narratives=[{"kind": "unknown", "provenance": "unknown"}],
        measured_human_time_seconds=None,
        references=[],
    )
    assert client.put(url, json=explicit_unknowns).status_code == 201

    extra = {**explicit_unknowns, "expected_revision": 1, "agent_cost_usd": 1.25}
    assert client.put(url, json=extra).status_code == 422
    duplicated = {
        **explicit_unknowns,
        "expected_revision": 1,
        "narratives": [
            {"kind": "email", "provenance": "human_authored"},
            {"kind": "email", "provenance": "agent_generated"},
        ],
    }
    assert client.put(url, json=duplicated).status_code == 422


def test_revert_and_pre_application_correction_remove_the_record(client: TestClient) -> None:
    listing = _listing(client, "revert")
    event_id = _event(client, listing["job_id"], "applied")
    url = f"/api/jobs/{listing['job_id']}/application-workflow"
    assert client.put(url, json=_payload(event_id)).status_code == 201

    reverted = client.post(f"/api/jobs/{listing['job_id']}/status/revert")
    assert reverted.status_code == 200
    assert reverted.json()["status"] == "new"
    missing = client.get(url)
    assert missing.status_code == 404
    assert missing.headers["cache-control"] == "no-store"

    event_id = _event(client, listing["job_id"], "applied")
    assert client.put(url, json=_payload(event_id)).status_code == 201
    corrected = client.post(
        f"/api/jobs/{listing['job_id']}/corrections", json={"status": "to_apply"}
    )
    assert corrected.json()["status"] == "to_apply"
    assert client.get(url).status_code == 404

    # A deliberate correction to applied is itself explicit submitted evidence.
    corrected = client.post(
        f"/api/jobs/{listing['job_id']}/corrections", json={"status": "applied"}
    )
    assert corrected.json()["status"] == "applied"
    corrected_event = next(
        row["id"]
        for row in reversed(client.get(f"/api/jobs/{listing['job_id']}").json()["events"])
        if row["event"] == "corrected:applied"
    )
    assert client.put(url, json=_payload(corrected_event)).status_code == 201
    assert client.post(f"/api/jobs/{listing['job_id']}/status/revert").status_code == 200
    assert client.get(url).status_code == 404


def test_post_application_correction_preserves_the_record(client: TestClient) -> None:
    listing = _listing(client, "post-correction")
    event_id = _event(client, listing["job_id"], "applied")
    url = f"/api/jobs/{listing['job_id']}/application-workflow"
    created = client.put(url, json=_payload(event_id)).json()

    corrected = client.post(
        f"/api/jobs/{listing['job_id']}/corrections", json={"status": "rejected"}
    )
    assert corrected.json()["status"] == "rejected"
    assert client.get(url).json() == created


def test_relink_moves_the_record_with_its_submitted_event(client: TestClient) -> None:
    source = _listing(client, "source")
    _listing(client, "source-other", job_id=source["job_id"])
    target = _listing(client, "target")
    event_id = _event(client, source["job_id"], "applied", by_listing="source")
    source_url = f"/api/jobs/{source['job_id']}/application-workflow"
    assert client.put(source_url, json=_payload(event_id)).status_code == 201

    moved = client.patch(f"/api/listings/{source['listing_id']}", json={"job_id": target["job_id"]})
    assert moved.status_code == 200, moved.text
    assert client.get(source_url).status_code == 404
    target_workflow = client.get(f"/api/jobs/{target['job_id']}/application-workflow").json()
    assert target_workflow["job_id"] == target["job_id"]
    assert target_workflow["submitted_event_id"] == event_id


def test_merge_moves_record_flattens_aliases_and_accepts_old_address(client: TestClient) -> None:
    survivor = _listing(client, "survivor")
    _event(client, survivor["job_id"], "applied")
    loser = _listing(client, "loser")
    event_id = _event(client, loser["job_id"], "applied")
    assert (
        client.put(
            f"/api/jobs/{loser['job_id']}/application-workflow", json=_payload(event_id)
        ).status_code
        == 201
    )

    merged = client.post(
        "/api/listings/link-job",
        json={"platform": "linkedin", "platform_id": "loser", "other_job_id": survivor["job_id"]},
    )
    assert merged.status_code == 200, merged.text
    assert merged.json()["job_id"] == survivor["job_id"]
    old_url = f"/api/jobs/{loser['job_id']}/application-workflow"
    aliased = client.get(old_url)
    assert aliased.status_code == 200
    assert aliased.json()["job_id"] == survivor["job_id"]
    assert aliased.headers["content-location"] == (
        f"/api/jobs/{survivor['job_id']}/application-workflow"
    )
    updated_through_alias = client.put(
        old_url, json=_payload(event_id, expected_revision=1, measured_human_time_seconds=600)
    )
    assert updated_through_alias.status_code == 200
    assert updated_through_alias.json()["job_id"] == survivor["job_id"]
    assert updated_through_alias.json()["revision"] == 2

    third = _listing(client, "third")
    _event(client, third["job_id"], "offered")
    merged_again = client.post(
        "/api/listings/link-job",
        json={"platform": "linkedin", "platform_id": "survivor", "other_job_id": third["job_id"]},
    )
    assert merged_again.json()["job_id"] == third["job_id"]
    twice_aliased = client.get(old_url)
    assert twice_aliased.json()["job_id"] == third["job_id"]


def test_merge_status_restoration_does_not_discard_workflow(client: TestClient) -> None:
    survivor = _listing(client, "restore-survivor")
    event_id = _event(client, survivor["job_id"], "applied")
    url = f"/api/jobs/{survivor['job_id']}/application-workflow"
    created = client.put(url, json=_payload(event_id)).json()

    # This later active event would win a plain timestamp projection, but merging
    # it into an applied job is an illegal regression that the merge cascade restores.
    loser = _listing(client, "restore-loser")
    _event(client, loser["job_id"], "seen")
    merged = client.post(
        "/api/listings/link-job",
        json={
            "platform": "linkedin",
            "platform_id": "restore-loser",
            "other_job_id": survivor["job_id"],
        },
    )
    assert merged.status_code == 200, merged.text
    assert client.get(f"/api/jobs/{survivor['job_id']}").json()["status"] == "applied"
    assert client.get(url).json() == created


def test_merge_and_relink_refuse_two_workflow_records(client: TestClient) -> None:
    first = _listing(client, "conflict-first")
    first_event = _event(client, first["job_id"], "applied", by_listing="conflict-first")
    second = _listing(client, "conflict-second")
    second_event = _event(client, second["job_id"], "applied", by_listing="conflict-second")
    for listing, event_id in ((first, first_event), (second, second_event)):
        assert (
            client.put(
                f"/api/jobs/{listing['job_id']}/application-workflow", json=_payload(event_id)
            ).status_code
            == 201
        )

    merge = client.post(
        "/api/listings/link-job",
        json={
            "platform": "linkedin",
            "platform_id": "conflict-second",
            "other_job_id": first["job_id"],
        },
    )
    assert merge.status_code == 409
    assert merge.json()["detail"] == "application_workflow_conflict"
    assert client.get(f"/api/jobs/{first['job_id']}").status_code == 200
    assert client.get(f"/api/jobs/{second['job_id']}").status_code == 200

    relink = client.patch(f"/api/listings/{second['listing_id']}", json={"job_id": first["job_id"]})
    assert relink.status_code == 409
    assert relink.json()["detail"] == "application_workflow_conflict"


def test_hard_deletion_removes_the_record_without_a_public_delete(client: TestClient) -> None:
    listing = _listing(client, "delete")
    event_id = _event(client, listing["job_id"], "applied")
    url = f"/api/jobs/{listing['job_id']}/application-workflow"
    assert client.put(url, json=_payload(event_id)).status_code == 201
    assert client.delete(url).status_code == 405

    assert client.delete(f"/api/jobs/{listing['job_id']}").status_code == 204
    assert client.get(url).status_code == 404
