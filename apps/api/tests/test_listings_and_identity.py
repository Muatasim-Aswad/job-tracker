"""Identity resolution and the link_listing_to_job cascade."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient


def _post_listing(client: TestClient, **fields: Any) -> dict[str, Any]:
    resp = client.post("/api/listings", json=fields)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_lookup_resolves_natural_key_to_job(client: TestClient) -> None:
    # The deep-link path: (platform, platform_id) -> (job_id, listing_id).
    created = _post_listing(client, platform="linkedin", platform_id="42", title="A")
    r = client.get("/api/listings/lookup", params={"platform": "linkedin", "platform_id": "42"})
    assert r.status_code == 200
    assert r.json()["job_id"] == created["job_id"]
    assert r.json()["listing_id"] == created["listing_id"]


def test_lookup_is_404_for_uncaptured_listing(client: TestClient) -> None:
    # A never-captured posting has nothing to open — lookup is a pure read, so it
    # 404s rather than materializing a stub.
    r = client.get("/api/listings/lookup", params={"platform": "linkedin", "platform_id": "nope"})
    assert r.status_code == 404


def test_company_backfills_on_a_later_capture(client: TestClient) -> None:
    # First capture seeds the title but the company hadn't rendered yet (a capture
    # race). A later capture carrying the company must fill it, not stay frozen.
    first = _post_listing(client, platform="linkedin", platform_id="7", title="Junior SWE")
    jid = first["job_id"]
    assert client.get(f"/api/jobs/{jid}").json()["company"] is None
    _post_listing(
        client, platform="linkedin", platform_id="7", title="Junior SWE", company="BlockTech"
    )
    job = client.get(f"/api/jobs/{jid}").json()
    assert job["company"] == "BlockTech"
    assert job["company_key"] is not None  # advisory key recomputed alongside


def test_capture_never_overwrites_an_existing_company(client: TestClient) -> None:
    # Sticky: once the job has a company, a later capture with a different one
    # updates only the listing, never the (human-authoritative) job identity.
    jid = _post_listing(client, platform="linkedin", platform_id="8", title="A", company="First")[
        "job_id"
    ]
    _post_listing(client, platform="linkedin", platform_id="8", title="A", company="Second")
    assert client.get(f"/api/jobs/{jid}").json()["company"] == "First"


def test_stub_from_bare_seen_backfills_title_and_company(client: TestClient) -> None:
    # A bare `seen` stubs a job with null identity; the first real capture fills
    # both fields.
    client.post(
        "/api/events",
        json={"platform": "linkedin", "platform_id": "9", "events": [{"event": "seen"}]},
    )
    r = _post_listing(client, platform="linkedin", platform_id="9", title="T", company="C")
    job = client.get(f"/api/jobs/{r['job_id']}").json()
    assert job["title"] == "T" and job["company"] == "C"


def test_closed_at_set_by_natural_key_upsert(client: TestClient) -> None:
    # The extension reports "no longer accepting" by (platform, platform_id),
    # no surrogate listing_id — closed_at rides the natural-keyed upsert.
    r = _post_listing(
        client, platform="linkedin", platform_id="99", closed_at="2026-07-01T00:00:00Z"
    )
    detail = client.get(f"/api/jobs/{r['job_id']}").json()
    assert detail["listings"][0]["closed_at"] == "2026-07-01T00:00:00Z"
    assert detail["status"] == "closed"
    closed = next(event for event in detail["events"] if event["event"] == "closed")
    assert closed["meta"] == {"source": "automatic", "reason": "all_listings_closed"}


def test_listing_upsert_is_idempotent(client: TestClient) -> None:
    r1 = _post_listing(
        client,
        platform="linkedin",
        platform_id="4424562295",
        title="Backend Engineer",
        company="Example Company",
        apply_type="easy_apply",
    )
    r2 = _post_listing(
        client,
        platform="linkedin",
        platform_id="4424562295",
        title="Backend Engineer (updated)",
        company="Example Company",
    )
    # Same (platform, platform_id) → same ids, fields refreshed, no second job.
    assert r1["listing_id"] == r2["listing_id"]
    assert r1["job_id"] == r2["job_id"]
    jobs = client.get("/api/jobs").json()
    assert len(jobs) == 1


def test_card_metadata_patch_preserves_full_detail_capture(client: TestClient) -> None:
    first = _post_listing(
        client,
        platform="exampleboard",
        platform_id="card-1",
        title="Platform Engineer",
        meta_patch={"location": "Amsterdam", "salary": "card salary"},
    )
    listing = client.get(f"/api/jobs/{first['job_id']}").json()["listings"][0]
    assert listing["meta"] == {"location": "Amsterdam", "salary": "card salary"}

    # A full detail capture remains authoritative and may deliberately remove
    # card-only or stale keys.
    _post_listing(
        client,
        platform="exampleboard",
        platform_id="card-1",
        meta={"description": "The complete job description", "salary": "detail salary"},
    )
    listing = client.get(f"/api/jobs/{first['job_id']}").json()["listings"][0]
    assert listing["meta"] == {
        "description": "The complete job description",
        "salary": "detail salary",
    }

    # A later list revisit updates visible facts but cannot erase the description.
    _post_listing(
        client,
        platform="exampleboard",
        platform_id="card-1",
        meta_patch={"salary": "new card salary", "hours_per_week": "36"},
    )
    listing = client.get(f"/api/jobs/{first['job_id']}").json()["listings"][0]
    assert listing["meta"] == {
        "description": "The complete job description",
        "salary": "new card salary",
        "hours_per_week": "36",
    }


def test_adversarial_natural_keys_get_distinct_listing_ids(client: TestClient) -> None:
    # Delimiters make these natural keys collide under simple string concatenation.
    a = _post_listing(client, platform="sample company", platform_id="12-34", title="A")
    b = _post_listing(client, platform="sample-12", platform_id="34", title="B")
    assert a["listing_id"] != b["listing_id"]
    assert a["job_id"] != b["job_id"]


def test_arbitrary_adapter_needs_no_server_registration(client: TestClient) -> None:
    # A brand-new platform the server has never heard of upserts fine and gets a
    # usable listing id — no prefix table entry required.
    r = _post_listing(client, platform="somebrandnewboard", platform_id="xyz", title="A")
    assert r["listing_id"]
    r2 = _post_listing(client, platform="somebrandnewboard", platform_id="xyz", title="A (edit)")
    assert r["listing_id"] == r2["listing_id"]  # same natural key stays idempotent


def test_same_company_title_does_not_auto_merge_but_is_suggested(client: TestClient) -> None:
    r1 = _post_listing(
        client,
        platform="exampleboard",
        platform_id="JR_1",
        company="Example Company N.V.",
        title="Backend Engineer",
    )
    r2 = _post_listing(
        client,
        platform="linkedin",
        platform_id="99",
        company="Example Company",
        title="Backend Engineer",
    )
    assert r1["job_id"] != r2["job_id"]  # never auto-merged

    suggestions = client.get(
        "/api/jobs", params={"company": "Example Company", "title": "Backend Engineer"}
    ).json()
    job_ids = {j["id"] for j in suggestions}
    assert {r1["job_id"], r2["job_id"]} <= job_ids  # both surfaced


def test_patch_listing_relink_dissolves_empty_donor(client: TestClient) -> None:
    r1 = _post_listing(
        client,
        platform="exampleboard",
        platform_id="JR_1",
        company="Example Company",
        title="Backend Engineer",
    )
    r2 = _post_listing(
        client,
        platform="linkedin",
        platform_id="99",
        company="Example Company",
        title="Backend Engineer",
    )
    job_a, job_b = r1["job_id"], r2["job_id"]
    client.post(
        "/api/events",
        json={"platform": "linkedin", "platform_id": "99", "events": [{"event": "seen"}]},
    )

    resp = client.patch(f"/api/listings/{r2['listing_id']}", json={"job_id": job_a})
    assert resp.status_code == 200, resp.text

    detail = client.get(f"/api/jobs/{job_a}").json()
    assert any(e["event"] == "seen" for e in detail["events"])  # history carried over
    assert client.get(f"/api/jobs/{job_b}").status_code == 404  # donor dissolved


def test_patch_listing_relink_reprojects_after_moving_all_donor_events(client: TestClient) -> None:
    receiver = _post_listing(client, platform="linkedin", platform_id="1", title="A")
    client.post(
        "/api/events",
        json={
            "job_id": receiver["job_id"],
            "ts": "2026-07-01T00:00:00+00:00",
            "events": [{"event": "applied"}],
        },
    )
    donor = _post_listing(client, platform="exampleboard", platform_id="2", title="A")
    client.post(
        "/api/events",
        json={
            "job_id": donor["job_id"],
            "ts": "2026-07-02T00:00:00+00:00",
            "events": [{"event": "closed"}],
        },
    )

    resp = client.patch(f"/api/listings/{donor['listing_id']}", json={"job_id": receiver["job_id"]})

    assert resp.status_code == 200, resp.text
    detail = client.get(f"/api/jobs/{receiver['job_id']}").json()
    assert detail["status"] == "closed"
    assert any(e["event"] == "closed" for e in detail["events"])
    assert client.get(f"/api/jobs/{donor['job_id']}").status_code == 404


def test_relink_keeps_donor_with_other_listings(client: TestClient) -> None:
    # job_a owns two listings; relinking one of them must NOT dissolve job_a.
    r1 = _post_listing(client, platform="linkedin", platform_id="1", title="A", company="X")
    job_a = r1["job_id"]
    r2 = _post_listing(
        client, platform="exampleboard", platform_id="2", title="A", company="X", job_id=job_a
    )
    assert r2["job_id"] == job_a
    r3 = _post_listing(client, platform="demoboard", platform_id="3", title="A", company="X")
    job_c = r3["job_id"]

    client.patch(f"/api/listings/{r2['listing_id']}", json={"job_id": job_c})
    assert client.get(f"/api/jobs/{job_a}").status_code == 200  # still has listing "1"


def test_relink_reprojects_receiver_and_surviving_donor(client: TestClient) -> None:
    first = _post_listing(client, platform="linkedin", platform_id="1", title="A")
    donor_id = first["job_id"]
    second = _post_listing(
        client, platform="exampleboard", platform_id="2", title="A", job_id=donor_id
    )
    receiver = _post_listing(client, platform="demoboard", platform_id="3", title="A")
    client.post(
        "/api/events",
        json={
            "platform": "linkedin",
            "platform_id": "1",
            "ts": "2026-07-01T00:00:00+00:00",
            "events": [{"event": "applied"}],
        },
    )
    client.post(
        "/api/events",
        json={
            "platform": "exampleboard",
            "platform_id": "2",
            "ts": "2026-07-02T00:00:00+00:00",
            "events": [{"event": "rejected"}],
        },
    )

    resp = client.patch(
        f"/api/listings/{second['listing_id']}", json={"job_id": receiver["job_id"]}
    )

    assert resp.status_code == 200, resp.text
    assert client.get(f"/api/jobs/{donor_id}").json()["status"] == "applied"
    assert client.get(f"/api/jobs/{receiver['job_id']}").json()["status"] == "rejected"


def test_relink_moves_events_without_dedup(client: TestClient) -> None:
    # No more UNIQUE(job_id, event, day): relinking just reassigns events. If donor
    # and target each hold the same event kind, both are retained (not collapsed).
    r1 = _post_listing(client, platform="exampleboard", platform_id="JR_1", title="A", company="X")
    r2 = _post_listing(client, platform="linkedin", platform_id="99", title="A", company="X")
    job_a = r1["job_id"]
    client.post(
        "/api/events",
        json={"platform": "exampleboard", "platform_id": "JR_1", "events": [{"event": "seen"}]},
    )
    client.post(
        "/api/events",
        json={"platform": "linkedin", "platform_id": "99", "events": [{"event": "seen"}]},
    )

    resp = client.patch(f"/api/listings/{r2['listing_id']}", json={"job_id": job_a})
    assert resp.status_code == 200  # the move didn't error

    seen = [e for e in client.get(f"/api/jobs/{job_a}").json()["events"] if e["event"] == "seen"]
    assert len(seen) == 2  # both retained; nothing dedupes them away


def test_manual_add_records_via_on_created_event(client: TestClient) -> None:
    # A hand-added job routes through POST /listings with platform="manual" + a
    # client-minted platform_id and via="manual", so its birth is distinguishable
    # from a scraped capture in the timeline (the default via is "capture").
    r = _post_listing(
        client, platform="manual", platform_id="abc-123", title="Referral role", via="manual"
    )
    created = [
        e
        for e in client.get(f"/api/jobs/{r['job_id']}").json()["events"]
        if e["event"] == "created"
    ]
    assert len(created) == 1
    assert created[0]["meta"]["via"] == "manual"


def test_capture_via_defaults_to_capture(client: TestClient) -> None:
    r = _post_listing(client, platform="linkedin", platform_id="777", title="A")
    created = [
        e
        for e in client.get(f"/api/jobs/{r['job_id']}").json()["events"]
        if e["event"] == "created"
    ]
    assert created[0]["meta"]["via"] == "capture"
