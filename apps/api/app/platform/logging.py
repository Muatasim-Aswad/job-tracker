"""JSON operational logs with request correlation and value-free failure traces."""

import json
import logging
import traceback
from contextvars import ContextVar
from datetime import UTC, datetime
from pathlib import Path

request_id_context: ContextVar[str | None] = ContextVar("request_id", default=None)
FIELDS = ("event", "method", "route", "status", "code", "duration_ms", "build")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        record.message = record.getMessage()
        data: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.message,
            "request_id": getattr(record, "request_id", request_id_context.get()),
        }
        for field in FIELDS:
            if hasattr(record, field):
                data[field] = getattr(record, field)
        if record.exc_info and record.exc_info[0] is not None:
            data["exception_type"] = record.exc_info[0].__name__
            data["trace"] = [
                {"file": Path(frame.filename).name, "line": frame.lineno, "function": frame.name}
                for frame in traceback.extract_tb(record.exc_info[2])
            ]
        return json.dumps(data, ensure_ascii=True)


def configure_logging() -> None:
    formatter = JsonFormatter()
    for name in ("", "uvicorn", "uvicorn.error"):
        for handler in logging.getLogger(name).handlers:
            handler.setFormatter(formatter)
    # The HTTP boundary logs completions once, without query strings or resource IDs.
    logging.getLogger("uvicorn.access").disabled = True
