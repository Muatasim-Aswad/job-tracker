import sqlite3
import time

import pytest
from fastapi.testclient import TestClient

from app.core.db import init_schema
from app.preferences.schemas import DEFAULT_PREFERENCES_REVISION, Preferences


def test_startup_stores_defaults_before_the_first_settings_request(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    revision, stored = conn.execute(
        "SELECT revision, settings_json FROM user_preferences"
    ).fetchone()
    assert revision == DEFAULT_PREFERENCES_REVISION
    assert Preferences.model_validate_json(stored) == Preferences()
    response = client.get("/api/settings")
    assert response.headers["cache-control"] == "no-store"
    state = response.json()
    assert state["revision"] == revision
    assert state["settings"] == Preferences().model_dump()
    assert all(item["enabled"] for item in state["settings"]["description_highlights"])
    assert state["settings"]["title_rules"] == []
    assert client.get("/api/settings").json() == state


def test_browser_import_endpoint_is_absent(client: TestClient) -> None:
    assert "/api/settings/import" not in client.get("/openapi.json").json()["paths"]
    assert client.post("/api/settings/import", json={"hide_mode": "dim"}).status_code in (404, 405)
    assert client.get("/api/settings").json()["settings"]["hide_mode"] == "remove"


def test_patch_rejects_stale_writes_without_losing_other_settings(client: TestClient) -> None:
    first = client.patch(
        "/api/settings",
        json={"expected_revision": DEFAULT_PREFERENCES_REVISION, "changes": {"hide_mode": "dim"}},
    ).json()
    stale = client.patch(
        "/api/settings",
        json={
            "expected_revision": DEFAULT_PREFERENCES_REVISION,
            "changes": {"easy_apply_enabled": False},
        },
    )
    assert stale.status_code == 409
    assert stale.json()["current"] == first
    second = client.patch(
        "/api/settings",
        json={"expected_revision": first["revision"], "changes": {"easy_apply_enabled": False}},
    ).json()
    assert second["settings"]["hide_mode"] == "dim"
    assert second["settings"]["easy_apply_enabled"] is False
    assert second["revision"] != first["revision"]
    assert client.get("/api/settings").json() == second


def test_title_rules_round_trip_with_alternatives_and_negative_condition(
    client: TestClient,
) -> None:
    rules = [
        {
            "id": "rule-1",
            "match": "not_contains",
            "terms": [" Java ", "java", "Python"],
            "action": "skip",
        }
    ]
    response = client.patch(
        "/api/settings",
        json={"expected_revision": DEFAULT_PREFERENCES_REVISION, "changes": {"title_rules": rules}},
    )
    assert response.status_code == 200
    rule = response.json()["settings"]["title_rules"][0]
    assert rule["terms"] == ["Java", "Python"]
    assert rule["enabled"] is True


@pytest.mark.parametrize(
    "changes",
    [
        {"hide_mode": "invalid"},
        {"easy_apply_enabled": None},
        {"search_diagnostics": {"scope": "temporary"}},
        {"title_rules": [{"id": "r", "match": "contains", "terms": [], "action": "hide"}]},
        {"title_rules": [{"id": "r", "match": "contains", "terms": [" "], "action": "hide"}]},
        {"title_rules": [{"id": "r", "match": "contains", "terms": ["a"], "action": "apply"}]},
    ],
)
def test_invalid_settings_never_write(client: TestClient, changes: dict[str, object]) -> None:
    response = client.patch(
        "/api/settings",
        json={"expected_revision": DEFAULT_PREFERENCES_REVISION, "changes": changes},
    )
    assert response.status_code == 422
    assert response.headers["cache-control"] == "no-store"
    assert client.get("/api/settings").json()["settings"] == Preferences().model_dump()


def test_duplicate_rule_ids_are_rejected_atomically(client: TestClient) -> None:
    rule = {"id": "r", "match": "contains", "terms": ["engineer"], "action": "star"}
    response = client.patch(
        "/api/settings",
        json={
            "expected_revision": DEFAULT_PREFERENCES_REVISION,
            "changes": {"title_rules": [rule, rule]},
        },
    )
    assert response.status_code == 400
    assert client.get("/api/settings").json()["settings"] == Preferences().model_dump()


def test_diagnostics_revocation_and_expiry_are_enforced_on_the_server(client: TestClient) -> None:
    client.post("/api/search-log", json={"query": "disabled"})
    assert client.get("/api/search-log").json() == []
    state = client.patch(
        "/api/settings",
        json={
            "expected_revision": DEFAULT_PREFERENCES_REVISION,
            "changes": {
                "search_diagnostics": {
                    "scope": "temporary",
                    "expires_at": int(time.time() * 1000) + 60_000,
                }
            },
        },
    ).json()
    client.post("/api/search-log", json={"query": "enabled"})
    assert len(client.get("/api/search-log").json()) == 1
    state = client.patch(
        "/api/settings",
        json={
            "expected_revision": state["revision"],
            "changes": {"search_diagnostics": {"scope": "temporary", "expires_at": 1}},
        },
    ).json()
    client.post("/api/search-log", json={"query": "expired"})
    state = client.patch(
        "/api/settings",
        json={
            "expected_revision": state["revision"],
            "changes": {"search_diagnostics": {"scope": "never"}},
        },
    ).json()
    client.post("/api/search-log", json={"query": "stale client"})
    assert [row["query"] for row in client.get("/api/search-log").json()] == ["enabled"]


def test_preferences_migration_upgrades_old_database_and_is_idempotent(
    conn: sqlite3.Connection,
) -> None:
    conn.execute("DROP TABLE user_preferences")
    conn.execute(
        "DELETE FROM schema_migrations WHERE key IN ('create_user_preferences_v1', 'seed_user_preferences_defaults_v1')"
    )
    conn.commit()
    init_schema(conn)
    assert (
        conn.execute("SELECT settings_json FROM user_preferences").fetchone()[0]
        == Preferences().model_dump_json()
    )
    conn.execute(
        "UPDATE user_preferences SET revision = 'revision-1', settings_json = '{}' WHERE id = 1"
    )
    conn.commit()
    init_schema(conn)
    assert conn.execute("SELECT revision FROM user_preferences").fetchall() == [("revision-1",)]
    assert (
        conn.execute(
            "SELECT COUNT(*) FROM schema_migrations WHERE key = 'create_user_preferences_v1'"
        ).fetchone()[0]
        == 1
    )


def test_preferences_migration_rolls_back_schema_if_ledger_write_fails(
    conn: sqlite3.Connection,
) -> None:
    conn.execute("DROP TABLE user_preferences")
    conn.execute(
        "DELETE FROM schema_migrations WHERE key IN ('create_user_preferences_v1', 'seed_user_preferences_defaults_v1')"
    )
    conn.execute(
        "CREATE TRIGGER reject_preferences_ledger BEFORE INSERT ON schema_migrations "
        "WHEN NEW.key = 'create_user_preferences_v1' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END"
    )
    conn.commit()
    with pytest.raises(sqlite3.IntegrityError, match="synthetic failure"):
        init_schema(conn)
    assert (
        conn.execute("SELECT name FROM sqlite_master WHERE name = 'user_preferences'").fetchone()
        is None
    )
    conn.execute("DROP TRIGGER reject_preferences_ledger")
    conn.commit()
    init_schema(conn)
    assert conn.execute("SELECT COUNT(*) FROM user_preferences").fetchone()[0] == 1


def test_default_seeding_preserves_existing_settings_and_revision(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    saved = client.patch(
        "/api/settings",
        json={
            "expected_revision": DEFAULT_PREFERENCES_REVISION,
            "changes": {
                "hide_mode": "dim",
                "description_highlights": [],
                "title_rules": [
                    {
                        "id": "custom",
                        "enabled": True,
                        "match": "contains",
                        "terms": ["Python"],
                        "action": "star",
                    }
                ],
            },
        },
    ).json()
    conn.execute("DELETE FROM schema_migrations WHERE key = 'seed_user_preferences_defaults_v1'")
    conn.commit()
    init_schema(conn)
    assert client.get("/api/settings").json() == saved
    init_schema(conn)
    assert client.get("/api/settings").json() == saved


def test_default_seeding_upgrades_an_existing_empty_preferences_table(
    conn: sqlite3.Connection,
) -> None:
    conn.execute("DELETE FROM user_preferences")
    conn.execute("DELETE FROM schema_migrations WHERE key = 'seed_user_preferences_defaults_v1'")
    conn.commit()
    init_schema(conn)
    revision, stored = conn.execute(
        "SELECT revision, settings_json FROM user_preferences"
    ).fetchone()
    assert revision == DEFAULT_PREFERENCES_REVISION
    assert Preferences.model_validate_json(stored) == Preferences()
    init_schema(conn)
    assert conn.execute("SELECT COUNT(*) FROM user_preferences").fetchone()[0] == 1


def test_default_seeding_rolls_back_if_ledger_write_fails(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM user_preferences")
    conn.execute("DELETE FROM schema_migrations WHERE key = 'seed_user_preferences_defaults_v1'")
    conn.execute(
        "CREATE TRIGGER reject_default_ledger BEFORE INSERT ON schema_migrations WHEN NEW.key = 'seed_user_preferences_defaults_v1' BEGIN SELECT RAISE(ABORT, 'synthetic seed failure'); END"
    )
    conn.commit()
    with pytest.raises(sqlite3.IntegrityError, match="synthetic seed failure"):
        init_schema(conn)
    assert conn.execute("SELECT COUNT(*) FROM user_preferences").fetchone()[0] == 0
    assert (
        conn.execute(
            "SELECT COUNT(*) FROM schema_migrations WHERE key = 'seed_user_preferences_defaults_v1'"
        ).fetchone()[0]
        == 0
    )
    conn.execute("DROP TRIGGER reject_default_ledger")
    conn.commit()
    init_schema(conn)
    assert conn.execute("SELECT COUNT(*) FROM user_preferences").fetchone()[0] == 1


@pytest.mark.parametrize(
    "highlights",
    [
        [],
        [{"id": "language", "enabled": False, "terms": ["dutch"]}],
        [{"id": "language", "enabled": True, "terms": []}],
        [dict(item.model_dump(), enabled=False) for item in Preferences().description_highlights],
    ],
)
def test_user_opt_out_is_not_replaced_by_default_highlights(
    client: TestClient, conn: sqlite3.Connection, highlights: list[dict[str, object]]
) -> None:
    saved = client.patch(
        "/api/settings",
        json={
            "expected_revision": DEFAULT_PREFERENCES_REVISION,
            "changes": {"description_highlights": highlights},
        },
    ).json()
    assert saved["settings"]["description_highlights"] == highlights
    conn.execute("DELETE FROM schema_migrations WHERE key = 'seed_user_preferences_defaults_v1'")
    conn.commit()
    init_schema(conn)
    assert client.get("/api/settings").json() == saved
    init_schema(conn)
    assert client.get("/api/settings").json() == saved
