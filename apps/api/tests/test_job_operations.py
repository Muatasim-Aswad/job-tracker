"""Job-addressed duplicate suggestions and complete-job merges."""

import sqlite3
from typing import Any

import pytest
from fastapi.testclient import TestClient


def _listing(client: TestClient, platform_id: str, **fields: Any) -> dict[str, Any]:
    response = client.post(
        "/api/listings",
        json={
            "platform": "linkedin",
            "platform_id": platform_id,
            "title": "Backend Engineer",
            "company": "Example Company",
            **fields,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def _matches(client: TestClient, job_id: str) -> list[dict[str, Any]]:
    response = client.get(f"/api/jobs/{job_id}/matches")
    assert response.status_code == 200, response.text
    return response.json()


def _link(client: TestClient, job_id: str, other_job_id: str) -> dict[str, Any]:
    response = client.post(f"/api/jobs/{job_id}/link-job", json={"other_job_id": other_job_id})
    assert response.status_code == 200, response.text
    result = response.json()
    assert response.headers["content-location"] == f"/api/jobs/{result['job_id']}"
    return result


def _event(client: TestClient, job_id: str, event: str) -> None:
    response = client.post("/api/events", json={"job_id": job_id, "events": [{"event": event}]})
    assert response.status_code == 200, response.text


def test_single_listing_matches_equal_existing_endpoint_without_writes(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    source = _listing(client, "source", meta={"description": "Python backend systems"})
    _listing(client, "candidate", meta={"description": "Python backend distributed systems"})
    before = conn.total_changes

    response = client.get(f"/api/jobs/{source['job_id']}/matches")
    existing = client.get(
        "/api/jobs/matches",
        params={
            "platform": "linkedin",
            "platform_id": "source",
            "title": "Backend Engineer",
            "company": "Example Company",
        },
    )

    assert response.status_code == existing.status_code == 200
    assert response.json() == existing.json()
    assert response.headers["content-location"] == f"/api/jobs/{source['job_id']}/matches"
    assert conn.total_changes == before


def test_job_matches_combine_all_listing_pairs_once_per_candidate(client: TestClient) -> None:
    source = _listing(
        client, "source", meta={"description": "Python pipelines", "location": "Amsterdam"}
    )
    _listing(
        client,
        "source-2",
        job_id=source["job_id"],
        meta={"description": "Distributed backend systems", "location": "Utrecht"},
    )
    candidate = _listing(
        client, "candidate", meta={"description": "Marketing campaigns", "location": "Rotterdam"}
    )
    _listing(
        client,
        "candidate-2",
        job_id=candidate["job_id"],
        meta={"description": "Distributed backend systems", "location": "Utrecht"},
    )

    found = _matches(client, source["job_id"])

    assert len(found) == 1
    assert found[0]["job_id"] == candidate["job_id"]
    assert found[0]["listing_count"] == 2
    assert found[0]["similarity"] == 1.0
    assert found[0]["insights"]["location"] == {"is_same": True}
    assert _matches(client, candidate["job_id"])[0]["similarity"] == 1.0


def test_job_matches_use_any_application_destination_but_require_company(
    client: TestClient,
) -> None:
    source = _listing(client, "source")
    apply_url = "https://jobs.example.com/apply?jobId=7"
    _listing(client, "source-2", job_id=source["job_id"], meta={"apply_url": apply_url})
    candidate = _listing(client, "candidate", title="Platform Engineer")
    _listing(
        client,
        "candidate-2",
        job_id=candidate["job_id"],
        meta={"apply_url": f"{apply_url}&utm_source=linkedin"},
    )
    _listing(client, "other-company", company="Other Company", meta={"apply_url": apply_url})
    _listing(client, "other-title", title="Marketing", meta={"apply_url": "https://example.com/8"})

    found = _matches(client, source["job_id"])

    assert [row["job_id"] for row in found] == [candidate["job_id"]]
    assert found[0]["insights"]["apply_url"] == {"is_same": True}


def test_job_matches_use_canonical_identity_after_edits(client: TestClient) -> None:
    source = _listing(client, "source", title="Old role", company="Old Company")
    candidate = _listing(client, "candidate")
    _listing(client, "old-identity", title="Old role", company="Old Company")
    response = client.patch(
        f"/api/jobs/{source['job_id']}",
        json={"title": "Backend Engineer", "company": "Example Company"},
    )
    assert response.status_code == 200

    assert [row["job_id"] for row in _matches(client, source["job_id"])] == [candidate["job_id"]]


@pytest.mark.parametrize("missing", ["title", "company"])
def test_job_matches_need_complete_saved_identity(client: TestClient, missing: str) -> None:
    source = _listing(client, "source", **{missing: None})
    _listing(client, "candidate")

    assert _matches(client, source["job_id"]) == []


def test_job_matches_rank_zero_above_missing_similarity(client: TestClient) -> None:
    source = _listing(client, "source", meta={"description": "python backend"})
    zero = _listing(client, "zero", meta={"description": "marketing campaigns"})
    unknown = _listing(client, "unknown")
    near = _listing(client, "near", meta={"description": "python backend systems"})

    found = _matches(client, source["job_id"])

    assert [row["job_id"] for row in found] == [near["job_id"], zero["job_id"], unknown["job_id"]]
    assert 0 < found[0]["similarity"] < 1
    assert found[1]["similarity"] == 0.0
    assert found[2]["similarity"] is None


def test_job_matches_resolve_source_and_false_match_aliases(client: TestClient) -> None:
    source = _listing(client, "source")
    source_alias = _listing(client, "source-alias")
    _event(client, source["job_id"], "seen")
    assert _link(client, source_alias["job_id"], source["job_id"])["job_id"] == source["job_id"]
    excluded = _listing(client, "excluded")
    excluded_alias = _listing(client, "excluded-alias")
    _event(client, excluded["job_id"], "seen")
    assert (
        _link(client, excluded_alias["job_id"], excluded["job_id"])["job_id"] == excluded["job_id"]
    )
    response = client.patch(
        f"/api/jobs/{source['job_id']}",
        json={"meta": {"false_matches": [excluded_alias["job_id"]]}},
    )
    assert response.status_code == 200
    visible = _listing(client, "visible")

    response = client.get(f"/api/jobs/{source_alias['job_id']}/matches")

    assert response.status_code == 200
    assert [row["job_id"] for row in response.json()] == [visible["job_id"]]
    assert response.headers["content-location"] == f"/api/jobs/{source['job_id']}/matches"


@pytest.mark.parametrize("advanced_source", [False, True])
def test_job_link_merges_whole_jobs_and_preserves_history(
    client: TestClient, advanced_source: bool
) -> None:
    source = _listing(client, "source")
    source_extra = _listing(client, "source-2", job_id=source["job_id"])
    target = _listing(client, "target")
    target_extra = _listing(client, "target-2", job_id=target["job_id"])
    advanced, other = (source, target) if advanced_source else (target, source)
    _event(client, advanced["job_id"], "applied")
    _event(client, other["job_id"], "seen")
    document = client.post(f"/api/jobs/{other['job_id']}/documents", json={"type": "cover_letter"})
    assert document.status_code == 201

    result = _link(client, source["job_id"], target["job_id"])

    assert result == {"job_id": advanced["job_id"], "merged_from": [other["job_id"]]}
    detail = client.get(f"/api/jobs/{result['job_id']}").json()
    assert detail["status"] == "applied"
    assert {row["id"] for row in detail["listings"]} == {
        row["listing_id"] for row in (source, source_extra, target, target_extra)
    }
    assert {"applied", "seen"} <= {row["event"] for row in detail["events"]}
    assert [row["id"] for row in detail["documents"]] == [document.json()["id"]]
    assert len(client.get("/api/jobs").json()) == 1


def test_job_link_resolves_both_aliases_and_retries_without_writes(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    source = _listing(client, "source")
    source_alias = _listing(client, "source-alias")
    _event(client, source["job_id"], "seen")
    _link(client, source["job_id"], source_alias["job_id"])
    target = _listing(client, "target")
    target_alias = _listing(client, "target-alias")
    _event(client, target["job_id"], "applied")
    _link(client, target["job_id"], target_alias["job_id"])

    result = _link(client, source_alias["job_id"], target_alias["job_id"])

    assert result == {"job_id": target["job_id"], "merged_from": [source["job_id"]]}
    before = conn.total_changes
    assert _link(client, source_alias["job_id"], target_alias["job_id"]) == {
        "job_id": target["job_id"],
        "merged_from": [],
    }
    assert _link(client, target["job_id"], target["job_id"])["merged_from"] == []
    assert conn.total_changes == before


def test_unknown_job_operations_do_not_create_data(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    source = _listing(client, "source")
    before = conn.total_changes

    assert client.get("/api/jobs/missing/matches").status_code == 404
    for job_id, other_job_id in (("missing", source["job_id"]), (source["job_id"], "missing")):
        response = client.post(f"/api/jobs/{job_id}/link-job", json={"other_job_id": other_job_id})
        assert response.status_code == 404
    response = client.post(f"/api/jobs/{source['job_id']}/link-job", json={})
    assert response.status_code == 422
    assert conn.total_changes == before


def test_job_false_match_is_mutual_idempotent_and_preserves_metadata(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    first = _listing(client, "first")
    second = _listing(client, "second")
    for job in (first, second):
        client.patch(f"/api/jobs/{job['job_id']}", json={"meta": {"annotation": "keep"}})
    url = f"/api/jobs/{first['job_id']}/false-match"
    body = {"other_job_id": second["job_id"]}
    response = client.post(url, json=body)
    assert response.status_code == 204
    assert response.headers["content-location"] == f"/api/jobs/{first['job_id']}"
    before = conn.total_changes
    assert client.post(url, json=body).status_code == 204
    assert conn.total_changes == before
    for job, other in ((first, second), (second, first)):
        assert _matches(client, job["job_id"]) == []
        detail = client.get(f"/api/jobs/{job['job_id']}").json()
        assert detail["meta"] == {"annotation": "keep", "false_matches": [other["job_id"]]}


def test_job_false_match_resolves_both_aliases_and_self_is_noop(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    first = _listing(client, "first")
    first_alias = _listing(client, "first-alias")
    second = _listing(client, "second")
    second_alias = _listing(client, "second-alias")
    _event(client, first["job_id"], "seen")
    _event(client, second["job_id"], "seen")
    _link(client, first["job_id"], first_alias["job_id"])
    _link(client, second["job_id"], second_alias["job_id"])
    response = client.post(
        f"/api/jobs/{first_alias['job_id']}/false-match",
        json={"other_job_id": second_alias["job_id"]},
    )
    assert response.status_code == 204
    assert response.headers["content-location"] == f"/api/jobs/{first['job_id']}"
    detail = client.get(f"/api/jobs/{first['job_id']}").json()
    assert detail["meta"]["false_matches"] == [second["job_id"]]
    before = conn.total_changes
    assert (
        client.post(
            f"/api/jobs/{first['job_id']}/false-match", json={"other_job_id": first_alias["job_id"]}
        ).status_code
        == 204
    )
    assert conn.total_changes == before


def test_job_false_match_missing_job_changes_nothing(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    first = _listing(client, "first")
    before = conn.total_changes
    for source, target in ((first["job_id"], "missing"), ("missing", first["job_id"])):
        assert (
            client.post(
                f"/api/jobs/{source}/false-match", json={"other_job_id": target}
            ).status_code
            == 404
        )
    assert conn.total_changes == before


@pytest.mark.parametrize("route", ["job", "listing", "patch", "capture"])
@pytest.mark.parametrize("exclusion_side", ["source", "target"])
def test_excluded_jobs_cannot_be_merged_or_relinked(
    client: TestClient, conn: sqlite3.Connection, route: str, exclusion_side: str
) -> None:
    source = _listing(client, "source")
    target = _listing(client, "target")
    # Simulate a client that already fetched duplicate suggestions before a
    # different client excludes the pair. A one-sided legacy exclusion suffices.
    assert _matches(client, source["job_id"])
    job, other = (source, target) if exclusion_side == "source" else (target, source)
    client.patch(f"/api/jobs/{job['job_id']}", json={"meta": {"false_matches": [other["job_id"]]}})
    client.post(f"/api/jobs/{source['job_id']}/documents", json={"type": "cv"})
    before = [client.get(f"/api/jobs/{j['job_id']}").json() for j in (source, target)]
    changes = conn.total_changes
    if route == "job":
        response = client.post(
            f"/api/jobs/{source['job_id']}/link-job", json={"other_job_id": target["job_id"]}
        )
    elif route == "listing":
        response = client.post(
            "/api/listings/link-job",
            json={
                "platform": "linkedin",
                "platform_id": "source",
                "other_job_id": target["job_id"],
            },
        )
    elif route == "patch":
        response = client.patch(
            f"/api/listings/{source['listing_id']}", json={"job_id": target["job_id"]}
        )
    else:
        response = client.post(
            "/api/listings",
            json={
                "platform": "linkedin",
                "platform_id": "source",
                "job_id": target["job_id"],
                "title": "Changed",
            },
        )
    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "false_match_conflict"
    assert [client.get(f"/api/jobs/{j['job_id']}").json() for j in (source, target)] == before
    # Capture may update observations before the relink guard; the request rollback
    # above must restore those too. SQLite total_changes includes rolled-back writes.
    if route != "capture":
        assert conn.total_changes == changes


def test_merge_guard_resolves_aliases_inside_exclusions(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    source = _listing(client, "source")
    target = _listing(client, "target")
    alias = _listing(client, "alias")
    _event(client, target["job_id"], "seen")
    _link(client, target["job_id"], alias["job_id"])
    client.patch(
        f"/api/jobs/{source['job_id']}", json={"meta": {"false_matches": [alias["job_id"]]}}
    )
    before = conn.total_changes
    response = client.post(
        f"/api/jobs/{source['job_id']}/link-job", json={"other_job_id": alias["job_id"]}
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "false_match_conflict"
    assert conn.total_changes == before
    assert _link(client, target["job_id"], alias["job_id"])["merged_from"] == []
