"""Factory configuration and resource isolation through real HTTP requests."""

from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.paths import settings_paths
from app.main import create_app
from app.platform.runtime import RuntimeResources


def test_factories_keep_database_settings_and_security_isolated(tmp_path: Path) -> None:
    def application(name: str, key: str | None):
        settings = Settings(
            _env_file=None,
            app_env="local",
            turso_auth_token=None,
            turso_local_first=False,
            db_path=str(tmp_path / name / "jobs.db"),
            web_dist_path=tmp_path / "absent-dashboard",
            api_key=key,
            turso_database_url=None,
        )
        paths = settings_paths(
            settings,
            environ={
                "JOB_TRACKER_PROFILE": "direct",
                "JOB_TRACKER_DATA_DIR": str(tmp_path / name),
                "JOB_TRACKER_CONFIG_DIR": str(tmp_path / name / "config"),
                "JOB_TRACKER_STATE_DIR": str(tmp_path / name / "state"),
                "JOB_TRACKER_BACKUP_DIR": str(tmp_path / name / "backups"),
            },
        )
        return create_app(settings, resources=RuntimeResources(paths))

    with TestClient(application("first", "first-key")) as first:
        assert first.get("/api/jobs").status_code == 401
        created = first.post(
            "/api/listings",
            headers={"X-API-Key": "first-key"},
            json={"platform": "test", "platform_id": "factory", "title": "Role"},
        )
        assert created.status_code == 200
        with TestClient(application("second", None)) as second:
            assert second.get("/api/jobs").json() == []
            assert second.get(f"/api/jobs/{created.json()['job_id']}").status_code == 404
            assert (
                first.get("/api/jobs", headers={"X-API-Key": "first-key"}).json()[0]["title"]
                == "Role"
            )
