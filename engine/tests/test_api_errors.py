"""Wire-contract tests for api/errors.py — the rendered error body.

error_response() is the single renderer for route-level failures; its
`retryable` field must equal core.errors.RETRYABLE_BY_CODE for every
registered code at every status (the status must not re-derive policy), and
fall back on the status only for unregistered codes.

The server pins the same literal table as ENGINE_RETRYABLE_BY_CODE in
server/tests/errors.test.ts (cross-tier contract-test pattern).
"""

from __future__ import annotations

import json

from api.errors import error_response
from core.errors import RETRYABLE_BY_CODE


def wire(status_code: int, code: str) -> dict:
    res = error_response(status_code, code, "boom")
    assert res.status_code == status_code
    return json.loads(res.body)


class TestErrorResponseBody:
    def test_body_shape_is_the_canonical_quadruple(self):
        assert wire(400, "INVALID_REQUEST") == {
            "code": "INVALID_REQUEST",
            "message": "boom",
            "layer": "engine",
            "retryable": False,
        }

    def test_registered_codes_wire_retryable_equals_registry_for_every_status(self):
        # Full-table loop, not spot checks: every registry code, at statuses
        # both concordant and discordant with the old `status >= 500` rule.
        statuses = (400, 404, 413, 415, 422, 429, 500, 503, 504)
        for code, retryable in RETRYABLE_BY_CODE.items():
            for status in statuses:
                body = wire(status, code)
                assert body["retryable"] is retryable, (code, status)

    def test_unregistered_codes_keep_the_status_fallback(self):
        assert wire(500, "GEMINI_NOT_CONFIGURED")["retryable"] is True
        assert wire(503, "GEMINI_ERROR")["retryable"] is True
        assert wire(403, "FORBIDDEN")["retryable"] is False
        assert wire(400, "MISSING_JOB_ID")["retryable"] is False
