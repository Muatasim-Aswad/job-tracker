"""Company blocklist: block (with normalization), list, unblock, and scoping."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_block_normalizes_company_and_defaults_to_all_platforms(client: TestClient) -> None:
    resp = client.post("/api/blocked-companies", json={"company": "Upwork B.V."})
    assert resp.status_code == 201
    body = resp.json()
    # Normalize suffixes, punctuation and casing as job identities do.
    assert body["company_key"] == "upwork"
    assert body["platform"] == "*"
    assert body["label"] == "Upwork B.V."

    listed = client.get("/api/blocked-companies").json()
    assert [b["company_key"] for b in listed] == ["upwork"]


def test_block_is_idempotent_and_refreshes_label(client: TestClient) -> None:
    client.post("/api/blocked-companies", json={"company": "Upwork"})
    client.post("/api/blocked-companies", json={"company": "UPWORK Inc"})  # same key -> upwork
    listed = client.get("/api/blocked-companies").json()
    assert len(listed) == 1
    assert listed[0]["label"] == "UPWORK Inc"


def test_platform_scoped_block_is_distinct_from_global(client: TestClient) -> None:
    client.post("/api/blocked-companies", json={"company": "Randstad", "platform": "*"})
    client.post("/api/blocked-companies", json={"company": "Randstad", "platform": "linkedin"})
    listed = client.get("/api/blocked-companies").json()
    scopes = sorted(b["platform"] for b in listed)
    assert scopes == ["*", "linkedin"]


def test_block_rejects_unnormalizable_name(client: TestClient) -> None:
    resp = client.post("/api/blocked-companies", json={"company": "  .,  "})
    assert resp.status_code == 400


def test_unblock_removes_only_the_targeted_scope(client: TestClient) -> None:
    client.post("/api/blocked-companies", json={"company": "Randstad", "platform": "*"})
    client.post("/api/blocked-companies", json={"company": "Randstad", "platform": "linkedin"})

    resp = client.delete("/api/blocked-companies/randstad", params={"platform": "linkedin"})
    assert resp.status_code == 204

    listed = client.get("/api/blocked-companies").json()
    assert [b["platform"] for b in listed] == ["*"]


def test_unblock_defaults_to_global_scope(client: TestClient) -> None:
    client.post("/api/blocked-companies", json={"company": "Upwork"})
    resp = client.delete("/api/blocked-companies/upwork")  # no platform param -> '*'
    assert resp.status_code == 204
    assert client.get("/api/blocked-companies").json() == []


def test_unblock_missing_is_404(client: TestClient) -> None:
    resp = client.delete("/api/blocked-companies/nope")
    assert resp.status_code == 404
