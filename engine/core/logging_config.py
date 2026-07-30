"""
logging_config.py — Structured logging with correlation IDs.

Provides a consistent JSON logging format across all engine components.
Each log entry includes: timestamp, level, type, job_id (if available),
and component-specific fields.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from contextvars import ContextVar
from typing import Any

# Context variable for job_id — automatically propagated to all log calls
# within the same async/thread context
_current_job_id: ContextVar[str | None] = ContextVar("current_job_id", default=None)


def set_job_id(job_id: str | None) -> None:
    """Set the current job ID for correlation in logs."""
    _current_job_id.set(job_id)


def get_job_id() -> str | None:
    """Get the current job ID."""
    return _current_job_id.get()


class StructuredFormatter(logging.Formatter):
    """JSON formatter with correlation ID support."""

    def format(self, record: logging.LogRecord) -> str:
        log_entry: dict[str, Any] = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.%fZ", time.gmtime(record.created)),
            "level": record.levelname,
            "component": "engine",
        }

        # Add correlation ID if set
        job_id = get_job_id()
        if job_id:
            log_entry["job_id"] = job_id

        # Parse message as JSON if possible, otherwise use as message
        msg = record.getMessage()
        if msg.startswith("{"):
            try:
                parsed = json.loads(msg)
                log_entry.update(parsed)
            except json.JSONDecodeError:
                log_entry["message"] = msg
        else:
            log_entry["message"] = msg

        # Add exception info if present
        if record.exc_info and record.exc_info[1]:
            log_entry["exception"] = {
                "type": type(record.exc_info[1]).__name__,
                "message": str(record.exc_info[1]),
            }

        return json.dumps(log_entry, default=str)


def setup_logging() -> None:
    """Configure structured logging for the engine."""
    level = os.environ.get("LOG_LEVEL", "INFO").upper()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(StructuredFormatter())

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(getattr(logging, level, logging.INFO))

    # Suppress noisy third-party loggers
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
