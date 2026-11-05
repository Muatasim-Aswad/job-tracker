"""Console logging setup at application startup."""

import logging

logger = logging.getLogger("uvicorn.error")


def timestamp_uvicorn_logs() -> None:
    """Add timestamps to Uvicorn handlers after they are installed, preserving their format so requests, commits, and background sync can be correlated."""
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        for handler in logging.getLogger(name).handlers:
            fmt = handler.formatter
            if fmt is None:
                continue
            base = getattr(fmt, "_fmt", None)
            if not base or "asctime" in base:
                continue
            try:
                handler.setFormatter(type(fmt)(f"%(asctime)s {base}", datefmt="%Y-%m-%d %H:%M:%S"))
            except Exception:  # never let log cosmetics break startup
                logger.debug("could not add timestamp to %s handler", name, exc_info=True)
