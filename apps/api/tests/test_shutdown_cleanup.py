import asyncio
from unittest.mock import Mock

import pytest
from fastapi import FastAPI

from app import main
from app.core.config import Settings


@pytest.mark.parametrize("busy", [False, True])
def test_shutdown_never_closes_an_owned_connection(
    monkeypatch: pytest.MonkeyPatch, busy: bool
) -> None:
    conn = Mock(spec=["close"])
    lock = Mock()
    monkeypatch.setattr(main, "get_settings", lambda: Settings())
    monkeypatch.setattr(main, "ServerLock", Mock(return_value=lock))
    monkeypatch.setattr(main, "connect", Mock(return_value=conn))
    monkeypatch.setattr(main, "init_schema", Mock())
    monkeypatch.setattr(main, "protect_new_database", Mock())

    async def exercise() -> None:
        app = FastAPI()
        async with main.lifespan(app):
            if busy:
                app.state.db.lock.acquire()
        if busy:
            conn.close.assert_not_called()
            lock.release.assert_not_called()
            app.state.db.lock.release()
        else:
            conn.close.assert_called_once()
            lock.release.assert_called_once()

    asyncio.run(exercise())
