"""Tests for the route kernel in core.http (shared JSON-route preambles)."""

import asyncio

from fastapi import Request

from core.http import (
    error_response,
    extract_timestamp_refs,
    get_job_or_404,
    is_quota_error,
    map_gemini_error,
    require_completed_summary,
    require_gemini,
    require_json_body,
    require_json_content,
)
from core.jobs import create_job


def _request(body: bytes | None, content_type: str | None = "application/json") -> Request:
    async def receive() -> dict:
        return {"type": "http.request", "body": body or b"", "more_body": False}

    headers = [(b"content-type", content_type.encode())] if content_type else []
    scope = {"type": "http", "method": "POST", "headers": headers, "query_string": b""}
    return Request(scope, receive)


class _QuotaError(Exception):
    status_code = 429


class TestErrorResponse:
    def test_shape_marks_server_errors_retryable(self):
        assert error_response(500, "X", "m").status_code == 500
        assert error_response(400, "X", "m").status_code == 400


class TestRequireJsonContent:
    def test_json_passes(self):
        assert require_json_content(_request(b"{}")) is None

    def test_missing_content_type_is_415(self):
        res = require_json_content(_request(b"{}", None))
        assert res is not None and res.status_code == 415


class TestRequireJsonBody:
    def test_object_bodies_parse(self):
        out = asyncio.run(require_json_body(_request(b'{"a": 1}')))
        assert out == {"a": 1}

    def test_malformed_and_non_objects_are_400(self):
        from fastapi.responses import JSONResponse

        for body in (b"{{{", b"null", b"[1,2]"):
            out = asyncio.run(require_json_body(_request(body)))
            assert isinstance(out, JSONResponse) and out.status_code == 400


class TestGetJobOr404:
    def test_missing_jobs_are_404(self):
        job, err = get_job_or_404("no-such-job")
        assert job is None
        assert err is not None and err.status_code == 404

    def test_found_jobs_pass(self):
        create_job("http-kernel-job")
        job, err = get_job_or_404("http-kernel-job")
        assert err is None
        assert job is not None and job.job_id == "http-kernel-job"


class TestRequireCompletedSummary:
    def test_summary_passes(self):
        assert require_completed_summary(type("J", (), {"summary": {"a": 1}})()) is None

    def test_missing_summary_is_400(self):
        res = require_completed_summary(type("J", (), {"summary": None})())
        assert res is not None and res.status_code == 400


class TestRequireGemini:
    def test_configured_client_passes(self):
        assert require_gemini(object()) is None

    def test_missing_client_is_500(self):
        res = require_gemini(None)
        assert res is not None and res.status_code == 500


class TestGeminiErrors:
    def test_quota_maps_to_429(self):
        assert map_gemini_error(_QuotaError("slow down"), "lbl").status_code == 429
        assert map_gemini_error(Exception("RESOURCE_EXHAUSTED"), "lbl").status_code == 429
        assert map_gemini_error(Exception("quota exceeded"), "lbl").status_code == 429

    def test_other_failures_map_to_500(self):
        assert map_gemini_error(Exception("boom"), "lbl").status_code == 500

    def test_predicate(self):
        assert is_quota_error(_QuotaError()) is True
        assert is_quota_error(Exception("boom")) is False


class TestExtractTimestampRefs:
    def test_sorts_unique_refs(self):
        assert extract_timestamp_refs("at 12.5s then 3s then 12.5s") == [3.0, 12.5]

    def test_no_refs_is_empty(self):
        assert extract_timestamp_refs("no timestamps here") == []
