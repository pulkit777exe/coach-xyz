"""http.py — Route kernel for engine endpoints.

One home for the preambles every JSON route repeats: content-type guard,
JSON body parse, job lookup, completed-summary check, Gemini client +
error mapping, and timestamp-ref extraction. Handlers keep their
validation + domain calls; this owns the uniform error mapping around
them. (Route-kernel leverage: same adapter shape as the server
capability kernel.)
"""

from __future__ import annotations

import logging
import re
from typing import Any

from fastapi.responses import JSONResponse

from core.jobs import JobNotFoundError, get_job

_TIMESTAMP_RE = re.compile(r"(\d+\.?\d*)s")


def error_response(status_code: int, error: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "code": error,
            "message": message,
            "layer": "engine",
            "retryable": status_code >= 500,
        },
    )


def require_json_content(request: Any) -> JSONResponse | None:
    """415 unless the request declares JSON (None when fine)."""
    content_type = (request.headers.get("content-type") or "").lower()
    if not content_type.startswith("application/json"):
        return error_response(415, "INVALID_REQUEST", "JSON required")
    return None


async def require_json_body(request: Any) -> dict | JSONResponse:
    """Parsed JSON object body, or a 400 response (non-objects included)."""
    try:
        payload = await request.json()
    except Exception:
        return error_response(400, "INVALID_REQUEST", "Invalid JSON body")
    if not isinstance(payload, dict):
        return error_response(400, "INVALID_REQUEST", "Invalid JSON body")
    return payload


def get_job_or_404(
    job_id: str,
    not_found_message: str = "Job not found",
) -> tuple[Any | None, JSONResponse | None]:
    """Job row or a 404 response (second element None on success)."""
    try:
        return get_job(job_id), None
    except JobNotFoundError:
        return None, error_response(404, "JOB_NOT_FOUND", not_found_message)


def require_completed_summary(
    job: Any,
    message: str = "Analysis not complete yet — no summary available",
) -> JSONResponse | None:
    """400 unless the job carries an analysis summary (None when fine)."""
    if not job.summary:
        return error_response(400, "INVALID_REQUEST", message)
    return None


def require_gemini(client: Any) -> JSONResponse | None:
    """500 when the Gemini client is not configured (None when fine)."""
    if client is None:
        return error_response(500, "GEMINI_NOT_CONFIGURED", "AI service is not configured.")
    return None


def is_quota_error(exc: BaseException) -> bool:
    """True when a Gemini failure is quota exhaustion (429/RESOURCE_EXHAUSTED)."""
    status_code = getattr(exc, "status_code", None)
    message = str(exc)
    return (
        status_code == 429 or "RESOURCE_EXHAUSTED" in message or "quota" in message.lower()
    )


def map_gemini_error(exc: BaseException, log_label: str) -> JSONResponse:
    """Map a caught Gemini call failure: quota → 429, anything else → 500."""
    if is_quota_error(exc):
        return error_response(
            429, "GEMINI_QUOTA_EXCEEDED", "AI quota exceeded. Please try again later."
        )
    logging.error(f"{log_label}: {exc}")
    return error_response(500, "GEMINI_ERROR", "AI service error. Please try again.")


def extract_timestamp_refs(text: str) -> list[float]:
    """Sorted unique `12.5s`-style timestamp references in model text."""
    return sorted(set(float(m) for m in _TIMESTAMP_RE.findall(text)))
