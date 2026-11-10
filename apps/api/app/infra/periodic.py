"""Supervised periodic work with bounded shutdown and no request dependency."""

import logging
import threading
from collections.abc import Callable

logger = logging.getLogger("uvicorn.error")


class PeriodicWorker:
    def __init__(self, tick: Callable[[], None], *, interval: float = 60) -> None:
        self._tick = tick
        self._interval = interval
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="notifications", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self, timeout: float = 10) -> bool:
        self._stop.set()
        self._thread.join(timeout)
        return not self._thread.is_alive()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self._tick()
            except Exception:
                logger.exception("notification cycle failed; will retry")
            if self._stop.wait(self._interval):
                break
