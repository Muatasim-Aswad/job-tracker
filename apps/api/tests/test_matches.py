"""Repost matching: GET /jobs/matches (the extension's duplicate suggestion) and
POST /listings/false-match (the mutual "not the same job" dismissal that keeps a
rejected candidate from being suggested again). See JobService.matches and
ListingService.mark_false_match."""

from typing import Any

import pytest
from fastapi.testclient import TestClient


def _listing(client: TestClient, platform: str, platform_id: str, **extra: Any) -> dict[str, Any]:
    resp = client.post(
        "/api/listings", json={"platform": platform, "platform_id": platform_id, **extra}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _matches(
    client: TestClient, platform_id: str, title: str, company: str
) -> list[dict[str, Any]]:
    resp = client.get(
        "/api/jobs/matches",
        params={
            "platform": "linkedin",
            "platform_id": platform_id,
            "title": title,
            "company": company,
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_repost_matches_original_by_normalized_keys(client: TestClient) -> None:
    # An original capture, then a repost under a NEW platform_id, same role.
    original = _listing(
        client, "linkedin", "111", title="Backend Engineer", company="Example Company N.V."
    )
    # The repost's own listing exists but hasn't been linked. Its normalized keys
    # (suffix-stripped company) still match the original.
    _listing(client, "linkedin", "222", title="Backend Engineer", company="Example Company")

    found = _matches(client, "222", "Backend Engineer", "Example Company")
    assert [m["job_id"] for m in found] == [original["job_id"]]
    assert found[0]["status"] == "new"
    assert found[0]["company"] == "Example Company N.V."


def test_matches_excludes_own_job(client: TestClient) -> None:
    # A single job seen on two platform_ids linked together must never suggest
    # itself: the current listing's own job is filtered out.
    a = _listing(client, "linkedin", "111", title="Data Analyst", company="Demo Company")
    _listing(
        client, "linkedin", "222", title="Data Analyst", company="Demo Company", job_id=a["job_id"]
    )

    assert _matches(client, "222", "Data Analyst", "Demo Company") == []


def test_matches_needs_both_title_and_company(client: TestClient) -> None:
    _listing(client, "linkedin", "111", title="Backend Engineer", company="Example Company")
    # Title alone is too broad to suggest.
    assert _matches(client, "999", "Backend Engineer", "") == []
    assert _matches(client, "999", "", "Example Company") == []


def test_matches_reports_closed_posting(client: TestClient) -> None:
    original = _listing(
        client, "linkedin", "111", title="SRE", company="Booking", closed_at="2026-07-01T00:00:00Z"
    )
    found = _matches(client, "222", "SRE", "Booking")
    assert found[0]["job_id"] == original["job_id"]
    assert found[0]["closed_at"] == "2026-07-01T00:00:00Z"
    assert found[0]["listing_count"] == 1


def test_false_match_is_mutual_and_suppresses_suggestion(client: TestClient) -> None:
    original = _listing(
        client, "linkedin", "111", title="Backend Engineer", company="Example Company"
    )
    repost = _listing(
        client, "linkedin", "222", title="Backend Engineer", company="Example Company"
    )

    # Before dismissal, each is suggested to the other.
    assert [
        m["job_id"] for m in _matches(client, "222", "Backend Engineer", "Example Company")
    ] == [original["job_id"]]

    resp = client.post(
        "/api/listings/false-match",
        json={"platform": "linkedin", "platform_id": "222", "other_job_id": original["job_id"]},
    )
    assert resp.status_code == 204, resp.text

    # Suppressed from the dismissing side...
    assert _matches(client, "222", "Backend Engineer", "Example Company") == []
    # ...and mutually from the other side (the repost's own job carries the exclusion).
    assert _matches(client, "111", "Backend Engineer", "Example Company") == []

    # The exclusion is recorded on BOTH jobs' meta.
    orig_detail = client.get(f"/api/jobs/{original['job_id']}").json()
    repost_detail = client.get(f"/api/jobs/{repost['job_id']}").json()
    assert repost["job_id"] in orig_detail["meta"]["false_matches"]
    assert original["job_id"] in repost_detail["meta"]["false_matches"]


def test_false_match_materializes_untracked_listing(client: TestClient) -> None:
    # Dismissing from a listing that has no job yet still records the mutual
    # exclusion — the current side is materialized so it has a row to hang meta on.
    original = _listing(
        client, "linkedin", "111", title="Backend Engineer", company="Example Company"
    )

    resp = client.post(
        "/api/listings/false-match",
        json={"platform": "linkedin", "platform_id": "888", "other_job_id": original["job_id"]},
    )
    assert resp.status_code == 204, resp.text

    # The dismissed candidate now records the freshly-materialized job, and the
    # newly-tracked listing resolves to a job carrying the reverse exclusion.
    orig_detail = client.get(f"/api/jobs/{original['job_id']}").json()
    (new_job_id,) = orig_detail["meta"]["false_matches"]
    new_detail = client.get(f"/api/jobs/{new_job_id}").json()
    assert new_detail["meta"]["false_matches"] == [original["job_id"]]


def test_false_match_is_idempotent(client: TestClient) -> None:
    original = _listing(
        client, "linkedin", "111", title="Backend Engineer", company="Example Company"
    )
    _listing(client, "linkedin", "222", title="Backend Engineer", company="Example Company")
    body = {"platform": "linkedin", "platform_id": "222", "other_job_id": original["job_id"]}
    assert client.post("/api/listings/false-match", json=body).status_code == 204
    assert client.post("/api/listings/false-match", json=body).status_code == 204

    orig_detail = client.get(f"/api/jobs/{original['job_id']}").json()
    # No duplicate ids from the repeat.
    assert orig_detail["meta"]["false_matches"].count(orig_detail["meta"]["false_matches"][0]) == 1


def test_false_match_unknown_job_is_404(client: TestClient) -> None:
    _listing(client, "linkedin", "222", title="Backend Engineer", company="Example Company")
    resp = client.post(
        "/api/listings/false-match",
        json={"platform": "linkedin", "platform_id": "222", "other_job_id": "nope"},
    )
    assert resp.status_code == 404, resp.text


# ── similarity % (Jaccard JD overlap) ────────────────────────────────────────

_JD_A = "<p>Design and build distributed backend microservices in Python and Go.</p>"
_JD_B = "Design and build distributed backend microservices using Python and Go."
_JD_FAR = "Manage social media campaigns, write marketing copy, and grow brand awareness."


def test_matches_reports_similarity_for_captured_jds(client: TestClient) -> None:
    # Two postings of the same role with near-identical JDs → a high similarity %.
    original = _listing(
        client,
        "linkedin",
        "111",
        title="Backend Engineer",
        company="Example Company",
        meta={"description": _JD_A},
    )
    _listing(
        client,
        "linkedin",
        "222",
        title="Backend Engineer",
        company="Example Company",
        meta={"description": _JD_B},
    )
    found = _matches(client, "222", "Backend Engineer", "Example Company")
    assert found[0]["job_id"] == original["job_id"]
    assert found[0]["similarity"] is not None
    assert found[0]["similarity"] > 0.5


def test_matches_similarity_none_when_a_jd_is_missing(client: TestClient) -> None:
    # Current listing has a JD, candidate has none → no comparison, similarity None
    # (distinct from a real 0.0), so the popover shows a plain row.
    _listing(client, "linkedin", "111", title="Backend Engineer", company="Example Company")
    _listing(
        client,
        "linkedin",
        "222",
        title="Backend Engineer",
        company="Example Company",
        meta={"description": _JD_B},
    )
    found = _matches(client, "222", "Backend Engineer", "Example Company")
    assert found[0]["similarity"] is None


def test_matches_sort_strongest_first_then_none_last(client: TestClient) -> None:
    # A far JD, a near JD, and a no-JD candidate → ordered near, far, none.
    near = _listing(
        client,
        "linkedin",
        "111",
        title="Backend Engineer",
        company="Example Company",
        meta={"description": _JD_A},
    )
    far = _listing(
        client,
        "linkedin",
        "222",
        title="Backend Engineer",
        company="Example Company",
        meta={"description": _JD_FAR},
    )
    none = _listing(client, "linkedin", "333", title="Backend Engineer", company="Example Company")
    # View a fourth listing carrying a JD close to `near`.
    _listing(
        client,
        "linkedin",
        "444",
        title="Backend Engineer",
        company="Example Company",
        meta={"description": _JD_B},
    )
    found = _matches(client, "444", "Backend Engineer", "Example Company")
    order = [m["job_id"] for m in found]
    assert order.index(near["job_id"]) < order.index(far["job_id"])
    assert order[-1] == none["job_id"]
    assert found[-1]["similarity"] is None


# ── link-job (mutual "same job" merge) ──────────────────────────────────────


def _emit(client: TestClient, job_id: str, event: str, *, ts: str | None = None) -> None:
    body: dict[str, Any] = {"job_id": job_id, "events": [{"event": event}]}
    if ts is not None:
        body["ts"] = ts
    resp = client.post("/api/events", json=body)
    assert resp.status_code == 200, resp.text


def _link_job(client: TestClient, platform_id: str, other_job_id: str) -> dict[str, Any]:
    resp = client.post(
        "/api/listings/link-job",
        json={"platform": "linkedin", "platform_id": platform_id, "other_job_id": other_job_id},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_link_job_fuses_two_jobs_into_one(client: TestClient) -> None:
    original = _listing(
        client, "linkedin", "111", title="Backend Engineer", company="Example Company"
    )
    repost = _listing(
        client, "linkedin", "222", title="Backend Engineer", company="Example Company"
    )
    assert original["job_id"] != repost["job_id"]

    result = _link_job(client, "222", original["job_id"])

    # Both postings now resolve to a single surviving job, with both listings.
    assert (
        result["job_id"]
        == client.get(
            "/api/listings/lookup", params={"platform": "linkedin", "platform_id": "111"}
        ).json()["job_id"]
    )
    detail = client.get(f"/api/jobs/{result['job_id']}").json()
    assert {li["platform_id"] for li in detail["listings"]} == {"111", "222"}
    # The other job is dissolved and the duplicate no longer suggested.
    assert _matches(client, "222", "Backend Engineer", "Example Company") == []


def test_link_job_keeps_the_more_advanced_status(client: TestClient) -> None:
    # The original was applied to; the repost is a fresh `new`. Merging must keep
    # the applied job as survivor so the application record is never lost — the
    # whole point of the repost feature.
    original = _listing(
        client, "linkedin", "111", title="Backend Engineer", company="Example Company"
    )
    _emit(client, original["job_id"], "applied")
    _listing(client, "linkedin", "222", title="Backend Engineer", company="Example Company")

    # Link from the FRESH repost side — survivor is still the applied job.
    result = _link_job(client, "222", original["job_id"])
    assert result["job_id"] == original["job_id"]
    assert client.get(f"/api/jobs/{original['job_id']}").json()["status"] == "applied"


@pytest.mark.parametrize("terminal", ["closed", "rejected"])
def test_link_job_reprojects_applied_survivor_from_later_terminal_event(
    client: TestClient, terminal: str
) -> None:
    original = _listing(
        client, "linkedin", "111", title="Backend Engineer", company="Example Company"
    )
    _emit(client, original["job_id"], "applied", ts="2026-07-01T00:00:00+00:00")
    repost = _listing(
        client, "linkedin", "222", title="Backend Engineer", company="Example Company"
    )
    _emit(client, repost["job_id"], terminal, ts="2026-07-02T00:00:00+00:00")

    result = _link_job(client, "222", original["job_id"])

    assert result["job_id"] == original["job_id"]
    assert client.get(f"/api/jobs/{result['job_id']}").json()["status"] == terminal


@pytest.mark.parametrize("repost_status", ["seen", "to_apply"])
def test_link_job_never_walks_the_survivor_backward(client: TestClient, repost_status: str) -> None:
    # The repost is fresher, so its `seen`/`to_apply` owns the newest timestamp in
    # the merged log — but no plain event may downgrade an `applied` job, and
    # `_pick_survivor` kept this one precisely to preserve the application. The
    # merge must not undo through the projection what the guard forbids on write.
    original = _listing(
        client, "linkedin", "111", title="Backend Engineer", company="Example Company"
    )
    _emit(client, original["job_id"], "applied", ts="2026-07-01T00:00:00+00:00")
    repost = _listing(
        client, "linkedin", "222", title="Backend Engineer", company="Example Company"
    )
    _emit(client, repost["job_id"], repost_status, ts="2026-07-09T00:00:00+00:00")

    result = _link_job(client, "222", original["job_id"])

    assert result["job_id"] == original["job_id"]
    assert client.get(f"/api/jobs/{result['job_id']}").json()["status"] == "applied"
    # The repost's history is kept, just not projected — nothing is silently dropped.
    events = [e["event"] for e in client.get(f"/api/jobs/{result['job_id']}").json()["events"]]
    assert repost_status in events
    # The rollback is durable: it's logged as a correction (so any future
    # reprojection replays it), not a one-shot column write.
    assert "corrected:applied" in events


@pytest.mark.parametrize("repost_status", ["seen", "to_apply"])
def test_link_job_rollback_survives_a_later_reprojection(
    client: TestClient, repost_status: str
) -> None:
    # Merge (rolled back to applied) → advance → undo the advance. The revert deletes
    # the newest status row and reprojects, so the rollback has to be in the log: a
    # column write alone would let the repost's backdated event win that replay and
    # silently drop the job below the status the merge promised to keep.
    original = _listing(
        client, "linkedin", "111", title="Backend Engineer", company="Example Company"
    )
    _emit(client, original["job_id"], "applied", ts="2026-07-01T00:00:00+00:00")
    repost = _listing(
        client, "linkedin", "222", title="Backend Engineer", company="Example Company"
    )
    _emit(client, repost["job_id"], repost_status, ts="2026-07-09T00:00:00+00:00")
    result = _link_job(client, "222", original["job_id"])

    _emit(client, result["job_id"], "in_process")
    assert client.get(f"/api/jobs/{result['job_id']}").json()["status"] == "in_process"
    resp = client.post(f"/api/jobs/{result['job_id']}/status/revert")
    assert resp.status_code == 200, resp.text

    assert client.get(f"/api/jobs/{result['job_id']}").json()["status"] == "applied"


def test_link_job_keeps_a_correction_that_lands_newest(client: TestClient) -> None:
    # A correction is the sanctioned way past the guard, so a merge must not roll
    # one back the way it rolls back a plain backward transition.
    original = _listing(
        client, "linkedin", "111", title="Backend Engineer", company="Example Company"
    )
    _emit(client, original["job_id"], "applied", ts="2026-07-01T00:00:00+00:00")
    repost = _listing(
        client, "linkedin", "222", title="Backend Engineer", company="Example Company"
    )
    client.post(f"/api/jobs/{repost['job_id']}/corrections", json={"status": "seen"})

    result = _link_job(client, "222", original["job_id"])

    assert client.get(f"/api/jobs/{result['job_id']}").json()["status"] == "seen"


def test_link_job_status_projection_uses_newest_timestamp(client: TestClient) -> None:
    original = _listing(
        client, "linkedin", "111", title="Backend Engineer", company="Example Company"
    )
    _emit(client, original["job_id"], "applied", ts="2026-07-03T00:00:00+00:00")
    repost = _listing(
        client, "linkedin", "222", title="Backend Engineer", company="Example Company"
    )
    # Inserted later (and therefore a higher event ID), but chronologically older.
    _emit(client, repost["job_id"], "closed", ts="2026-07-02T00:00:00+00:00")

    result = _link_job(client, "222", original["job_id"])

    assert client.get(f"/api/jobs/{result['job_id']}").json()["status"] == "applied"


def test_link_job_status_projection_breaks_timestamp_ties_by_event_id(client: TestClient) -> None:
    tied_ts = "2026-07-02T00:00:00+00:00"
    original = _listing(
        client, "linkedin", "111", title="Backend Engineer", company="Example Company"
    )
    _emit(client, original["job_id"], "applied", ts=tied_ts)
    repost = _listing(
        client, "linkedin", "222", title="Backend Engineer", company="Example Company"
    )
    # Same timestamp, inserted second: the closed event's higher ID must win.
    _emit(client, repost["job_id"], "closed", ts=tied_ts)

    result = _link_job(client, "222", original["job_id"])

    assert client.get(f"/api/jobs/{result['job_id']}").json()["status"] == "closed"


def test_link_job_handles_multi_listing_sides(client: TestClient) -> None:
    # Linking combines the complete listing sets from both jobs.
    a = _listing(client, "linkedin", "111", title="Backend Engineer", company="Example Company")
    b = _listing(client, "linkedin", "222", title="Backend Engineer", company="Example Company")
    c = _listing(client, "linkedin", "333", title="Backend Engineer", company="Example Company")

    _link_job(client, "111", b["job_id"])
    survivor = _link_job(client, "111", c["job_id"])

    detail = client.get(f"/api/jobs/{survivor['job_id']}").json()
    assert {li["platform_id"] for li in detail["listings"]} == {"111", "222", "333"}
    assert len(client.get("/api/jobs").json()) == 1
    assert a["job_id"] and c  # (all three seeded distinct jobs to begin with)


def test_link_job_carries_events_to_survivor(client: TestClient) -> None:
    original = _listing(
        client, "linkedin", "111", title="Backend Engineer", company="Example Company"
    )
    _emit(client, original["job_id"], "applied")
    repost = _listing(
        client, "linkedin", "222", title="Backend Engineer", company="Example Company"
    )
    _emit(client, repost["job_id"], "seen")

    survivor = _link_job(client, "222", original["job_id"])
    events = client.get(f"/api/jobs/{survivor['job_id']}").json()["events"]
    kinds = {e["event"] for e in events}
    # Both jobs' histories are preserved on the survivor (created/applied/seen).
    assert {"applied", "seen"} <= kinds


def test_link_job_unions_false_matches_and_drops_self(client: TestClient) -> None:
    # A job that had marked X as "not a match" keeps that exclusion after merging,
    # and no merged id lingers as a self-reference.
    original = _listing(
        client, "linkedin", "111", title="Backend Engineer", company="Example Company"
    )
    other = _listing(client, "linkedin", "999", title="Data Analyst", company="Example Company")
    # original is-not-a-match with `other`.
    client.post(
        "/api/listings/false-match",
        json={"platform": "linkedin", "platform_id": "111", "other_job_id": other["job_id"]},
    )
    repost = _listing(
        client, "linkedin", "222", title="Backend Engineer", company="Example Company"
    )

    survivor = _link_job(client, "222", original["job_id"])
    fm = client.get(f"/api/jobs/{survivor['job_id']}").json()["meta"]["false_matches"]
    assert other["job_id"] in fm
    assert survivor["job_id"] not in fm  # never points at itself
    assert repost["job_id"] not in fm  # the dissolved side isn't referenced


def test_link_job_self_merge_noops(client: TestClient) -> None:
    a = _listing(client, "linkedin", "111", title="Backend Engineer", company="Example Company")
    result = _link_job(client, "111", a["job_id"])
    assert result["job_id"] == a["job_id"]
    assert len(client.get(f"/api/jobs/{a['job_id']}").json()["listings"]) == 1


def test_link_job_unknown_job_is_404(client: TestClient) -> None:
    _listing(client, "linkedin", "222", title="Backend Engineer", company="Example Company")
    resp = client.post(
        "/api/listings/link-job",
        json={"platform": "linkedin", "platform_id": "222", "other_job_id": "nope"},
    )
    assert resp.status_code == 404, resp.text


_APPLY = "https://jobs.example.com/apply?jobId=7"


def test_shared_apply_url_surfaces_a_reworded_title(client: TestClient) -> None:
    original = _listing(
        client,
        "linkedin",
        "111",
        title="Backend Engineer",
        company="Example Company",
        meta={"apply_url": _APPLY},
    )
    _listing(
        client,
        "linkedin",
        "222",
        title="Backend Engineer II",
        company="Example Company",
        meta={"apply_url": f"{_APPLY}&utm_source=linkedin"},
    )

    found = _matches(client, "222", "Backend Engineer II", "Example Company")

    assert [m["job_id"] for m in found] == [original["job_id"]]
    assert found[0]["insights"]["apply_url"] == {"is_same": True}


def test_shared_apply_url_still_requires_the_same_company(client: TestClient) -> None:
    _listing(
        client,
        "linkedin",
        "111",
        title="Backend Engineer",
        company="Other",
        meta={"apply_url": _APPLY},
    )
    _listing(
        client,
        "linkedin",
        "222",
        title="Platform Engineer",
        company="Example Company",
        meta={"apply_url": _APPLY},
    )

    assert _matches(client, "222", "Platform Engineer", "Example Company") == []


def test_different_evidence_never_excludes_a_title_match(client: TestClient) -> None:
    original = _listing(
        client,
        "linkedin",
        "111",
        title="Backend Engineer",
        company="Example Company",
        meta={"apply_url": _APPLY, "location": "Utrecht"},
    )
    _listing(
        client,
        "linkedin",
        "222",
        title="Backend Engineer",
        company="Example Company",
        meta={"apply_url": "https://jobs.example.com/apply?jobId=8", "location": "Amsterdam"},
    )

    found = _matches(client, "222", "Backend Engineer", "Example Company")

    assert [m["job_id"] for m in found] == [original["job_id"]]
    insights = found[0]["insights"]
    assert insights["apply_url"] == {
        "is_same": False,
        "current": "https://jobs.example.com/apply?jobId=8",
        "candidate": _APPLY,
    }
    assert insights["location"] == {
        "is_same": False,
        "current": "Amsterdam",
        "candidate": "Utrecht",
    }
    assert insights["salary"] is None
    assert found[0]["timing"] == {"overlapping": True, "gap_days": None}


def test_unstored_viewed_listing_has_no_evidence(client: TestClient) -> None:
    _listing(
        client,
        "linkedin",
        "111",
        title="Backend Engineer",
        company="Example Company",
        meta={"location": "Utrecht"},
    )

    found = _matches(client, "999", "Backend Engineer", "Example Company")

    assert found[0]["insights"]["location"] is None
    assert found[0]["timing"] is None
