"""api/errors.py — The one shape for HTTP error bodies.

Every route (and the service-token middleware in main) renders failures
through error_response() so {code, message, layer, retryable} never drifts.
The `retryable` flag comes from the engine's single code → retryable registry
(core.errors.RETRYABLE_BY_CODE) via error_retryable(); only codes with no
registry entry fall back on the HTTP status. Rendering a body no longer
re-derives retry policy from the status code.
"""

from __future__ import annotations

from fastapi.responses import JSONResponse

from core.errors import error_retryable


def error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "code": code,
            "message": message,
            "layer": "engine",
            "retryable": error_retryable(code, status_code),
        },
    )
