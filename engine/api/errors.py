"""api/errors.py — The one shape for HTTP error bodies.

Every route (and the service-token middleware in main) renders failures
through error_response() so {code, message, layer, retryable} never drifts.
"""

from __future__ import annotations

from fastapi.responses import JSONResponse


def error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "code": code,
            "message": message,
            "layer": "engine",
            "retryable": status_code >= 500,
        },
    )
