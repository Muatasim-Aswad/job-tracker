"""GET /jobs dashboard behavior: the listing rollup on each job and the
board-facing filters (free-text `q`, `hidden`/`starred`, pagination). The
identity/dedup params (`company`/`title`) are covered in test_listings_and_identity."""

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.db import Conn


def _listing(client: TestClient, platform: str, platform_id: str, **extra: Any) -> dict[str, Any]:
    resp = client.post(
        "/api/listings", json={"platform": platform, "platform_id": platform_id, **extra}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _emit(client: TestClient, job_id: str, event: str) -> None:
    resp = client.post("/api/events", json={"job_id": job_id, "events": [{"event": event}]})
    assert resp.status_code == 200, resp.text


def test_summary_rolls_up_listings_across_platforms(client: TestClient) -> None:
    a = _listing(client, "linkedin", "1", title="Backend Engineer", apply_type="easy_apply")
    job_id = a["job_id"]
    # A second platform's listing linked to the same job.
    _listing(
        client,
        "exampleboard",
        "JR_1",
        title="Backend Engineer",
        apply_type="external",
        job_id=job_id,
    )

    (job,) = client.get("/api/jobs").json()
    assert set(job["platforms"]) == {"linkedin", "exampleboard"}
    assert set(job["apply_types"]) == {"easy_apply", "external"}
    assert job["listing_count"] == 2


def test_primary_listing_prefers_captured_url_over_stub(client: TestClient) -> None:
    # A bare event makes a stub listing (no url); a later real capture on another
    # platform links the same job. The card's primary_listing should be the one
    # with a real url, not the stub.
    stub = client.post(
        "/api/events",
        json={"platform": "exampleboard", "platform_id": "JR_1", "events": [{"event": "seen"}]},
    ).json()
    # The stub-only job first: primary is the stub, url is null (card reconstructs).
    (job,) = client.get("/api/jobs").json()
    detail = client.get(f"/api/jobs/{job['id']}").json()
    assert detail["primary_listing_id"] == detail["listings"][0]["id"]
    assert job["primary_listing"] == {
        "listing_id": detail["primary_listing_id"],
        "platform": "exampleboard",
        "platform_id": "JR_1",
        "url": None,
        "apply_url": None,
    }
    assert stub["status"] == "seen"

    # Now attach a captured linkedin listing (has a url) to the same job.
    job_id = client.get("/api/jobs").json()[0]["id"]
    _listing(
        client, "linkedin", "222", title="Backend", url="https://x/jobs/view/222/", job_id=job_id
    )
    (merged,) = client.get("/api/jobs").json()
    assert merged["primary_listing"]["url"] == "https://x/jobs/view/222/"


def test_primary_listing_carries_captured_apply_url(client: TestClient) -> None:
    apply_url = "https://jobs.example.com/backend?source=linkedin"
    _listing(
        client,
        "linkedin",
        "333",
        url="https://x/jobs/view/333/",
        apply_type="external",
        meta={"apply_url": apply_url},
    )

    (job,) = client.get("/api/jobs").json()
    assert job["primary_listing"]["apply_url"] == apply_url


@pytest.mark.parametrize(
    ("first", "second", "winner"),
    [
        ({"availability": "open"}, {"platform": "linkedin"}, 0),
        ({}, {"availability": "unavailable", "platform": "linkedin"}, 0),
        ({"availability": "unavailable"}, {"availability": "closed"}, 0),
        ({}, {"availability": "closed"}, 0),
        ({}, {"platform": "linkedin", "url": None, "capture_kind": "detail"}, 0),
        ({}, {"platform": "linkedin", "url": "   "}, 0),
        ({"platform": "linkedin"}, {"capture_kind": "detail"}, 0),
        ({"capture_kind": "detail"}, {}, 0),
        ({}, {}, 1),
    ],
    ids=[
        "open-before-unknown",
        "unknown-before-unavailable",
        "unavailable-before-closed",
        "unknown-before-closed",
        "url-before-linkedin-and-detail",
        "blank-url-is-not-usable",
        "linkedin-before-detail-and-recency",
        "detail-before-recency",
        "newest-first-capture",
    ],
)
def test_primary_listing_selection_agrees_between_summary_and_detail(
    client: TestClient, conn: Conn, first: dict[str, Any], second: dict[str, Any], winner: int
) -> None:
    listings = []
    for index, fields in enumerate((first, second)):
        data = {
            "platform": "exampleboard",
            "url": f"https://jobs.example.com/{index}",
            "title": "Synthetic role",
            "meta": {
                "description": "Synthetic job description",
                "apply_url": f"https://apply.example.com/{index}",
            },
            **fields,
        }
        listing = _listing(
            client,
            platform_id=str(index),
            **data,
            **({"job_id": listings[0]["job_id"]} if listings else {}),
        )
        conn.execute(
            "UPDATE listings SET captured_at = ? WHERE id = ?",
            (f"2026-10-0{index + 1}T00:00:00+00:00", listing["listing_id"]),
        )
        conn.commit()
        listings.append(listing)

    (summary,) = client.get("/api/jobs").json()
    detail = client.get(f"/api/jobs/{listings[0]['job_id']}").json()
    assert detail["primary_listing_id"] == listings[winner]["listing_id"]
    selected = next(row for row in detail["listings"] if row["id"] == detail["primary_listing_id"])
    assert summary["primary_listing"] == {
        "listing_id": selected["id"],
        "platform": selected["platform"],
        "platform_id": selected["platform_id"],
        "url": selected["url"],
        "apply_url": selected["meta"]["apply_url"],
    }
    assert "primary_listing" not in detail


def test_primary_listing_ties_are_stable_across_recaptures(client: TestClient, conn: Conn) -> None:
    capture = {
        "title": "Synthetic role",
        "capture_kind": "detail",
        "meta": {"description": "Synthetic description"},
    }
    first = _listing(client, "linkedin", "tie-1", url="https://example.com/1", **capture)
    second = _listing(
        client, "linkedin", "tie-2", url="https://example.com/2", job_id=first["job_id"], **capture
    )
    conn.execute("UPDATE listings SET captured_at = ?", ("2026-10-01T00:00:00+00:00",))
    conn.commit()
    expected = min(first["listing_id"], second["listing_id"])
    for platform_id in ("tie-1", "tie-2"):
        _listing(client, "linkedin", platform_id, **capture)
        detail = client.get(f"/api/jobs/{first['job_id']}").json()
        assert detail["primary_listing_id"] == expected
        (summary,) = client.get("/api/jobs").json()
        assert summary["primary_listing"]["listing_id"] == expected


@pytest.mark.parametrize("operation", ["merge", "relink"])
def test_primary_listing_follows_current_membership_and_job_aliases(
    client: TestClient, operation: str
) -> None:
    preferred = _listing(client, "linkedin", "preferred", url="https://example.com/linkedin")
    other = _listing(client, "exampleboard", "other", url="https://example.com/other")
    if operation == "merge":
        response = client.post(
            f"/api/jobs/{preferred['job_id']}/link-job", json={"other_job_id": other["job_id"]}
        )
    else:
        response = client.patch(
            f"/api/listings/{preferred['listing_id']}", json={"job_id": other["job_id"]}
        )
    assert response.status_code == 200, response.text
    (summary,) = client.get("/api/jobs").json()
    assert summary["primary_listing"]["listing_id"] == preferred["listing_id"]
    for job_id in (preferred["job_id"], other["job_id"]):
        detail = client.get(f"/api/jobs/{job_id}").json()
        assert detail["id"] == summary["id"]
        assert detail["primary_listing_id"] == preferred["listing_id"]
        assert {row["id"] for row in detail["listings"]} == {
            preferred["listing_id"],
            other["listing_id"],
        }


def test_primary_listing_uses_legacy_closure_and_reselects_after_deletion(
    client: TestClient, conn: Conn
) -> None:
    first = _listing(
        client, "linkedin", "closed", url="https://example.com/closed", availability="open"
    )
    second = _listing(
        client, "exampleboard", "unknown", url="https://example.com/open", job_id=first["job_id"]
    )
    conn.execute(
        "UPDATE listings SET closed_at = ? WHERE id = ?",
        ("2026-10-01T00:00:00+00:00", first["listing_id"]),
    )
    conn.commit()
    job_id = first["job_id"]
    detail = client.get(f"/api/jobs/{job_id}").json()
    assert detail["primary_listing_id"] == second["listing_id"]
    assert detail["availability"] == "closed"
    response = client.delete(f"/api/listings/{second['listing_id']}")
    assert response.status_code == 204
    detail = client.get(f"/api/jobs/{job_id}").json()
    assert detail["primary_listing_id"] == first["listing_id"]
    (summary,) = client.get("/api/jobs").json()
    assert summary["primary_listing"]["listing_id"] == first["listing_id"]


@pytest.mark.parametrize(
    "apply_url", [123, True, {"url": "https://example.com"}, ["https://example.com"], None]
)
@pytest.mark.parametrize("origin", ["capture", "patch", "stored"])
def test_primary_listing_ignores_non_text_apply_urls(
    client: TestClient, conn: Conn, apply_url: Any, origin: str
) -> None:
    created = _listing(
        client,
        platform="manual",
        platform_id="non-text-url",
        title="Synthetic role",
        meta={"apply_url": apply_url if origin == "capture" else "https://example.com/apply"},
    )
    if origin == "patch":
        patched = client.patch(
            f"/api/listings/{created['listing_id']}", json={"meta": {"apply_url": apply_url}}
        )
        assert patched.status_code == 200
    elif origin == "stored":
        conn.execute(
            "UPDATE listings SET meta = ? WHERE id = ?",
            (json.dumps({"apply_url": apply_url}), created["listing_id"]),
        )
        conn.commit()
    response = client.get("/api/jobs")
    assert response.status_code == 200
    job = next(row for row in response.json() if row["id"] == created["job_id"])
    assert job["primary_listing"]["apply_url"] is None


def test_summary_empty_rollup_for_stub_job(client: TestClient) -> None:
    # A job born from a bare event has a stub listing (no apply_type); the rollup
    # is still present and null-safe.
    r = client.post(
        "/api/events",
        json={"platform": "linkedin", "platform_id": "77", "events": [{"event": "seen"}]},
    ).json()
    (job,) = client.get("/api/jobs").json()
    assert job["status"] == "seen"
    assert job["platforms"] == ["linkedin"]
    assert job["apply_types"] == []  # stub had no apply_type
    assert job["listing_count"] == 1
    assert r["status"] == "seen"


def test_q_matches_raw_title_or_company_substring(client: TestClient) -> None:
    _listing(client, "linkedin", "1", title="Senior Backend Engineer", company="Example Company")
    _listing(client, "linkedin", "2", title="Frontend Developer", company="Demo Company")

    by_title = client.get("/api/jobs", params={"q": "backend"}).json()
    assert {j["title"] for j in by_title} == {"Senior Backend Engineer"}

    by_company = client.get("/api/jobs", params={"q": "demo"}).json()
    assert {j["company"] for j in by_company} == {"Demo Company"}


def test_hidden_and_starred_filters(client: TestClient) -> None:
    shown = _listing(client, "linkedin", "1", title="Shown")
    hidden = _listing(client, "linkedin", "2", title="Hidden")
    _emit(client, hidden["job_id"], "hidden")
    _emit(client, shown["job_id"], "starred")

    visible = client.get("/api/jobs", params={"hidden": "false"}).json()
    assert {j["title"] for j in visible} == {"Shown"}

    only_hidden = client.get("/api/jobs", params={"hidden": "true"}).json()
    assert {j["title"] for j in only_hidden} == {"Hidden"}

    starred = client.get("/api/jobs", params={"starred": "true"}).json()
    assert {j["title"] for j in starred} == {"Shown"}


def test_stubs_filter_hides_title_less_rows(client: TestClient) -> None:
    # A real captured listing has a title; a job born from a bare event is a
    # title-less stub. `stubs` filters the two apart, tri-state like hidden/starred.
    _listing(client, "linkedin", "1", title="Real Job")
    client.post(
        "/api/events",
        json={"platform": "linkedin", "platform_id": "2", "events": [{"event": "seen"}]},
    )

    # Default: both rows returned (scripts/backfill see everything).
    assert len(client.get("/api/jobs").json()) == 2

    # stubs=false → only real jobs (what the board passes).
    real = client.get("/api/jobs", params={"stubs": "false"}).json()
    assert {j["title"] for j in real} == {"Real Job"}

    # stubs=true → only the title-less stubs (the cleanup view).
    stubs = client.get("/api/jobs", params={"stubs": "true"}).json()
    assert len(stubs) == 1
    assert stubs[0]["title"] is None
    assert stubs[0]["status"] == "seen"


def test_pagination_limits_and_offsets_newest_first(client: TestClient) -> None:
    for i in range(3):
        _listing(client, "linkedin", str(i), title=f"Job {i}")

    page1 = client.get("/api/jobs", params={"limit": 2}).json()
    assert len(page1) == 2
    page2 = client.get("/api/jobs", params={"limit": 2, "offset": 2}).json()
    assert len(page2) == 1
    # No overlap between pages of the same ordered result.
    ids = {j["id"] for j in page1} | {j["id"] for j in page2}
    assert len(ids) == 3
