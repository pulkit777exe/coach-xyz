"""Tests for the /report endpoint and report prompt/schema contract.

Mirrors test_state_machine.py: main is imported with a dummy GEMINI_API_KEY
(set before import so the module-level env check passes) and the module-level
_gemini_client is monkeypatched so no network calls happen.
"""

import json
import os

os.environ.setdefault("GEMINI_API_KEY", "test-key")

import pytest
from fastapi.testclient import TestClient

import main
from core.report_prompt import (
    REPORT_JSON_SCHEMA,
    REPORT_TYPES,
    get_report_prompt,
)

REQUIRED_FIELDS = [
    "narrative",
    "summary",
    "strengths",
    "areas_to_improve",
    "recommendations",
    "form_score_trend",
    "highlight_max",
    "generated_at",
]

SAMPLE_CONTEXT = {
    "generated_at": "2026-09-17",
    "org": {"name": "Stellar Academy"},
    "student": {"id": "s1", "name": "Avery Chen", "sport": "tennis"},
    "period": {"start": "2026-08-01", "end": "2026-08-31"},
    "attendance": {"days_attended": 9, "total_sessions": 10, "rate": 0.9},
    "performance": {"recent_score": 7.4, "best_score": 8.1, "trend": "improving"},
    "analyses": [
        {"analysis_id": "a1", "video_date": "2026-08-14", "score": 6.9,
         "top_tips": ["keep the racquet head up"], "note": "solid serve week"}
    ],
    "summary": "Avery is a promising junior with a reliable serve and quick recovery.",
}

VALID_REPORT = {
    "narrative": "Avery took a clear step forward this month. Attendance held at nine of ten sessions and serve technique looked sharper mid-period, with the best outing on the 14th.",
    "summary": "Strong attendance with clear serve improvement.",
    "strengths": ["Consistent attendance", "Reliable first serve"],
    "areas_to_improve": ["Recovery step on the backhand side"],
    "recommendations": ["Practice backhand recovery with cone drills"],
    "form_score_trend": "improving",
    "highlight_max": ["9/10 sessions attended", "Best form score 8.1"],
    "generated_at": "2026-09-17",
}


class _FakeResponse:
    def __init__(self, text: str):
        self.text = text


class _FakeQuotaError(Exception):
    def __init__(self):
        super().__init__("RESOURCE_EXHAUSTED: quota exceeded")
        self.status_code = 429


class _FakeServerError(Exception):
    def __init__(self):
        super().__init__("upstream exploded")
        self.status_code = 503


class _FakeModels:
    def __init__(self, responder):
        self._responder = responder
        self.calls = []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        result = self._responder()
        if isinstance(result, Exception):
            raise result
        return result


class _FakeGemini:
    def __init__(self, responder):
        self.models = _FakeModels(responder)


@pytest.fixture(autouse=True)
def _reset_client():
    # GEMINI_API_KEY is set for import, so the module-level client gets created.
    # Reset to None per test so only tests that explicitly patch run a fake.
    main._gemini_client = None
    yield


@pytest.fixture
def client():
    with TestClient(main.app) as test_client:
        yield test_client


def _patch_gemini(monkeypatch, responder):
    monkeypatch.setattr(main, "_gemini_client", _FakeGemini(responder))


# ── Prompt / schema contract ─────────────────────────────────────────────────


def test_get_report_prompt_single_user_message():
    messages = get_report_prompt(report_context=SAMPLE_CONTEXT, report_type="progress")
    assert len(messages) == 1
    assert messages[0]["role"] == "user"
    assert "REPORT_CONTEXT" in messages[0]["content"]


def test_get_report_prompt_grounded_in_context():
    messages = get_report_prompt(report_context=SAMPLE_CONTEXT, report_type="progress")
    content = messages[0]["content"]
    assert "Avery Chen" in content
    assert "9" in content  # attendance embedded
    assert "Stellar Academy" in content


def test_get_report_prompt_optional_identity():
    messages = get_report_prompt(
        report_context=SAMPLE_CONTEXT,
        report_type="progress",
        sport="tennis",
        student_name="Avery Chen",
    )
    content = messages[0]["content"]
    assert "Sport: tennis" in content
    assert "Student: Avery Chen" in content


def test_get_report_prompt_unknown_type_still_embeds_type():
    messages = get_report_prompt(report_context=SAMPLE_CONTEXT, report_type="nonsense")
    assert "REPORT_TYPE: nonsense" in messages[0]["content"]
    assert "progress report" in messages[0]["content"]  # falls back to default framing


def test_report_json_schema_contract():
    assert REPORT_JSON_SCHEMA["type"] == "OBJECT"
    props = REPORT_JSON_SCHEMA["properties"]
    assert set(props) == set(REQUIRED_FIELDS)
    assert set(REPORT_JSON_SCHEMA["required"]) == set(REQUIRED_FIELDS)
    assert props["narrative"]["type"] == "STRING"
    assert props["strengths"]["type"] == "ARRAY"
    assert props["strengths"]["items"]["type"] == "STRING"


def test_report_types_match_server_contract():
    assert REPORT_TYPES == ["progress", "attendance", "performance", "monthly"]


# ── Endpoint behavior ────────────────────────────────────────────────────────


def test_report_returns_structured_report(client, monkeypatch):
    _patch_gemini(monkeypatch, lambda: _FakeResponse(json.dumps(VALID_REPORT)))
    resp = client.post(
        "/report",
        json={"report_context": SAMPLE_CONTEXT, "report_type": "progress"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "report" in body and "raw" in body
    report = body["report"]
    for field in REQUIRED_FIELDS:
        assert field in report
    assert report["form_score_trend"] == "improving"
    assert isinstance(report["strengths"], list)
    assert body["raw"] == json.dumps(VALID_REPORT)


def test_report_passes_gemini_config_through(client, monkeypatch):
    fake = _FakeGemini(lambda: _FakeResponse(json.dumps(VALID_REPORT)))
    monkeypatch.setattr(main, "_gemini_client", fake)
    client.post(
        "/report",
        json={"report_context": SAMPLE_CONTEXT, "report_type": "monthly"},
    )
    kwargs = fake.models.calls[0]
    config = kwargs["config"]
    assert kwargs["model"]
    assert kwargs["contents"]
    assert getattr(config, "response_mime_type", None) in (None, "application/json")


def test_report_request_body_passed_to_prompt(client, monkeypatch):
    fake = _FakeGemini(lambda: _FakeResponse(json.dumps(VALID_REPORT)))
    monkeypatch.setattr(main, "_gemini_client", fake)
    client.post(
        "/report",
        json={
            "report_context": SAMPLE_CONTEXT,
            "report_type": "progress",
            "sport": "tennis",
            "student_name": "Avery Chen",
        },
    )
    contents = fake.models.calls[0]["contents"]
    assert "Sport: tennis" in contents
    assert "Student: Avery Chen" in contents


def test_report_highlight_max_truncated_to_three(client, monkeypatch):
    inflated = dict(VALID_REPORT)
    inflated["highlight_max"] = ["one", "two", "three", "four", "five"]
    _patch_gemini(monkeypatch, lambda: _FakeResponse(json.dumps(inflated)))
    resp = client.post(
        "/report",
        json={"report_context": SAMPLE_CONTEXT, "report_type": "progress"},
    )
    assert resp.status_code == 200
    assert resp.json()["report"]["highlight_max"] == ["one", "two", "three"]


def test_report_form_score_trend_normalized(client, monkeypatch):
    bad_trend = dict(VALID_REPORT, form_score_trend="on-fire")
    _patch_gemini(monkeypatch, lambda: _FakeResponse(json.dumps(bad_trend)))
    resp = client.post(
        "/report",
        json={"report_context": SAMPLE_CONTEXT, "report_type": "progress"},
    )
    assert resp.status_code == 200
    assert resp.json()["report"]["form_score_trend"] == "steady"


def test_report_uses_context_generated_at_when_missing(client, monkeypatch):
    no_date = dict(VALID_REPORT)
    del no_date["generated_at"]
    _patch_gemini(monkeypatch, lambda: _FakeResponse(json.dumps(no_date)))
    resp = client.post(
        "/report",
        json={"report_context": SAMPLE_CONTEXT, "report_type": "progress"},
    )
    assert resp.json()["report"]["generated_at"] == "2026-09-17"


def test_report_missing_context_400(client):
    resp = client.post("/report", json={"report_type": "progress"})
    assert resp.status_code == 400
    assert resp.json()["code"] == "INVALID_REQUEST"


def test_report_missing_type_400(client):
    resp = client.post("/report", json={"report_context": SAMPLE_CONTEXT})
    assert resp.status_code == 400
    assert resp.json()["code"] == "INVALID_REQUEST"


def test_report_non_json_body_400(client):
    resp = client.post("/report", content="not-json", headers={"content-type": "application/json"})
    assert resp.status_code == 400
    assert resp.json()["code"] == "INVALID_REQUEST"


def test_report_not_configured_500(client):
    resp = client.post(
        "/report",
        json={"report_context": SAMPLE_CONTEXT, "report_type": "progress"},
    )
    assert resp.status_code == 500
    assert resp.json()["code"] == "GEMINI_NOT_CONFIGURED"


def test_report_quota_exceeded_429(client, monkeypatch):
    _patch_gemini(monkeypatch, lambda: _FakeQuotaError())
    resp = client.post(
        "/report",
        json={"report_context": SAMPLE_CONTEXT, "report_type": "progress"},
    )
    assert resp.status_code == 429
    assert resp.json()["code"] == "GEMINI_QUOTA_EXCEEDED"


def test_report_gemini_error_500(client, monkeypatch):
    _patch_gemini(monkeypatch, lambda: _FakeServerError())
    resp = client.post(
        "/report",
        json={"report_context": SAMPLE_CONTEXT, "report_type": "progress"},
    )
    assert resp.status_code == 500
    assert resp.json()["code"] == "GEMINI_ERROR"


def test_report_empty_response_500(client, monkeypatch):
    _patch_gemini(monkeypatch, lambda: _FakeResponse(""))
    resp = client.post(
        "/report",
        json={"report_context": SAMPLE_CONTEXT, "report_type": "progress"},
    )
    assert resp.status_code == 500
    assert resp.json()["code"] == "GEMINI_EMPTY_RESPONSE"


def test_report_parse_failure_500(client, monkeypatch):
    _patch_gemini(monkeypatch, lambda: _FakeResponse("not json at all"))
    resp = client.post(
        "/report",
        json={"report_context": SAMPLE_CONTEXT, "report_type": "progress"},
    )
    assert resp.status_code == 500
    assert resp.json()["code"] == "GEMINI_PARSE_FAILED"


def test_report_rejects_non_object_parsed(client, monkeypatch):
    _patch_gemini(monkeypatch, lambda: _FakeResponse(json.dumps(["list", "is", "invalid"])))
    resp = client.post(
        "/report",
        json={"report_context": SAMPLE_CONTEXT, "report_type": "progress"},
    )
    assert resp.status_code == 500
    assert resp.json()["code"] == "GEMINI_PARSE_FAILED"