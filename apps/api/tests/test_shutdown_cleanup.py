import asyncio
from pathlib import Path
from unittest.mock import Mock

import pytest

from app.config import Settings
from app.core.paths import settings_paths
from app.main import app as configured_app
from app.platform import runtime


@pytest.mark.parametrize("busy", [False, True])
def test_shutdown_never_closes_an_owned_connection(
    monkeypatch: pytest.MonkeyPatch, busy: bool, tmp_path: Path
) -> None:
    conn = Mock(spec=["close"])
    lock = Mock()
    monkeypatch.setattr(runtime, "ServerLock", Mock(return_value=lock))
    monkeypatch.setattr(runtime, "connect", Mock(return_value=conn))
    monkeypatch.setattr(runtime, "init_schema", Mock())
    monkeypatch.setattr(runtime, "protect_new_database", Mock())

    async def exercise() -> None:
        settings = Settings(db_path=str(tmp_path / "jobs.db"), turso_database_url=None)
        paths = settings_paths(
            settings,
            environ={
                "JOB_TRACKER_PROFILE": "direct",
                "JOB_TRACKER_DATA_DIR": str(tmp_path / "data"),
                "JOB_TRACKER_CONFIG_DIR": str(tmp_path / "config"),
                "JOB_TRACKER_STATE_DIR": str(tmp_path / "state"),
                "JOB_TRACKER_BACKUP_DIR": str(tmp_path / "backups"),
            },
        )
        resources = runtime.RuntimeResources(paths)
        with runtime.open_runtime(settings, resources, configured_app.state.build_info):
            if busy:
                resources.db.lock.acquire()
        if busy:
            conn.close.assert_not_called()
            lock.release.assert_not_called()
            resources.db.lock.release()
        else:
            conn.close.assert_called_once()
            lock.release.assert_called_once()

    asyncio.run(exercise())
