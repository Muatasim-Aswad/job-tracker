"""Rate-limited, value-free thread stacks for stalled database access."""

import faulthandler
import logging
import sys
import threading
import time

logger = logging.getLogger("uvicorn.error")
_lock = threading.Lock()
_last_report = float("-inf")


def report_database_stall(stage: str) -> None:
    global _last_report
    with _lock:
        now = time.monotonic()
        if now - _last_report < 60:
            return
        _last_report = now
        logger.warning("database wait timed out at %s; dumping Python thread stacks", stage)
        # No request bodies, SQL, tokens, or frame locals are included.
        try:
            faulthandler.dump_traceback(file=sys.stderr, all_threads=True)
        except OSError, ValueError, RuntimeError:
            logger.warning("thread dump unavailable", exc_info=True)
