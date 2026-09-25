"""Integration tests for the engine's synchronous /analyze route."""

import os

os.environ.setdefault("GEMINI_API_KEY", "test-key")

from fastapi.testclient import TestClient

import api.analyze as analyze_api
import main
from core.errors import EngineError


def _client() -> TestClient:
    return TestClient(main.app)


def test_analyze_uses_engine_status_registry(monkeypatch):
    """A known engine code keeps its registered status on this route."""
    monkeypatch.setattr(analyze_api, "get_job", lambda _job_id: object())
    monkeypatch.setattr(analyze_api, "update_job", lambda _job_id, **_kwargs: None)
    monkeypatch.setattr(analyze_api, "fail_job", lambda _job_id, _error: None)

    def fail_analysis(*_args, **_kwargs):
        raise EngineError(
            code="VIDEO_DECODE_FAILED",
            message="The uploaded video could not be decoded.",
            retryable=False,
        )

    monkeypatch.setattr("core.analyzer.run_analysis", fail_analysis)

    client = _client()
    response = client.post(
        "/analyze",
        json={
            "engine_job_id": "job-decode-failure",
            "video_key": "raw/test/primary/video.mp4",
        },
    )
    client.close()

    assert response.status_code == 400
    assert response.json() == {
        "code": "VIDEO_DECODE_FAILED",
        "message": "The uploaded video could not be decoded.",
        "layer": "engine",
        "retryable": False,
    }


def test_analyze_preserves_registered_quota_status(monkeypatch):
    """A retryable registry code also retains its non-500 HTTP status."""
    monkeypatch.setattr(analyze_api, "get_job", lambda _job_id: object())
    monkeypatch.setattr(analyze_api, "update_job", lambda _job_id, **_kwargs: None)
    monkeypatch.setattr(analyze_api, "fail_job", lambda _job_id, _error: None)

    def fail_analysis(*_args, **_kwargs):
        raise EngineError(
            code="GEMINI_QUOTA_EXCEEDED",
            message="The analysis quota is temporarily exhausted.",
            retryable=True,
        )

    monkeypatch.setattr("core.analyzer.run_analysis", fail_analysis)

    client = _client()
    response = client.post(
        "/analyze",
        json={
            "engine_job_id": "job-quota-failure",
            "video_key": "raw/test/primary/video.mp4",
        },
    )
    client.close()

    assert response.status_code == 429
    assert response.json()["retryable"] is True
