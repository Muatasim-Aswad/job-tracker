"""GET /jobs dashboard behavior: the listing rollup on each job and the
board-facing filters (free-text `q`, `hidden`/`starred`, pagination). The
identity/dedup params (`company`/`title`) are covered in test_listings_and_identity."""

from typing import Any

from fastapi.testclient import TestClient


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
    assert job["primary_listing"] == {
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
