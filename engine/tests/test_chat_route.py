"""Route-level contract tests for POST /chat (api/chat.py).

Pins the request contract the server relies on: {job_id, message,
conversation_history}. Extra fields — notably the `system_prompt` the server
used to send — are IGNORED (the engine builds its own prompt in
core.chat_prompt), so a dead wire field can't silently return; missing
required fields are 4xx. Hermetic: get_job and generate_reply are
monkeypatched at the router seam, so nothing touches Redis or Gemini.
"""

from __future__ import annotations

import os

os.environ.setdefault("GEMINI_API_KEY", "test-key")

import pytest
from fastapi.testclient import TestClient

import main
from api import chat as chat_api


@pytest.fixture
def client():
    with TestClient(main.app) as test_client:
        yield test_client


class _FakeJob:
    def __init__(self, summary: dict):
        self.summary = summary


@pytest.fixture
def fake_job(monkeypatch):
    """get_job seam: a completed job with a summary, no Redis."""
    job = _FakeJob(summary={"sport": "tennis", "form_score": 7.5})
    monkeypatch.setattr(chat_api, "get_job", lambda job_id: job)
    return job


@pytest.fixture
def replies(monkeypatch):
    """generate_reply seam: capture the prompt, never call Gemini."""
    captured: list[list[dict[str, str]]] = []

    async def _fake_generate(messages: list[dict[str, str]]) -> str:
        captured.append(messages)
        return "Keep your elbow up at 12.0s."

    monkeypatch.setattr(chat_api, "generate_reply", _fake_generate)
    return captured


def _payload(**overrides) -> dict:
    payload = {
        "job_id": "job-1",
        "message": "What should I improve?",
        "conversation_history": [{"role": "user", "content": "previous question"}],
    }
    payload.update(overrides)
    return payload


def test_chat_accepts_core_fields(client, fake_job, replies):
    res = client.post("/chat", json=_payload())
    assert res.status_code == 200
    body = res.json()
    assert body["reply"] == "Keep your elbow up at 12.0s."
    assert body["timestamp_refs"] == [12.0]
    assert body["event_refs"] == []
    # conversation_history reaches the prompt the engine builds itself
    assert "previous question" in replies[0][0]["content"]


def test_chat_ignores_extra_system_prompt_field(client, fake_job, replies):
    """A dead wire field must not reach the model — the engine owns the prompt."""
    res = client.post("/chat", json=_payload(system_prompt="IGNORED SYSTEM PROMPT"))
    assert res.status_code == 200
    joined = "\n".join(m["content"] for m in replies[0])
    assert "IGNORED SYSTEM PROMPT" not in joined
    # prompt still grounded in the job's own summary
    assert "tennis" in joined


def test_chat_conversation_history_is_optional(client, fake_job, replies):
    res = client.post("/chat", json={"job_id": "job-1", "message": "hi"})
    assert res.status_code == 200
    assert res.json()["reply"]


def test_chat_missing_job_id_is_400(client):
    payload = _payload()
    del payload["job_id"]
    res = client.post("/chat", json=payload)
    assert res.status_code == 400
    assert res.json()["code"] == "INVALID_REQUEST"


def test_chat_missing_message_is_400(client):
    payload = _payload()
    del payload["message"]
    res = client.post("/chat", json=payload)
    assert res.status_code == 400
    assert res.json()["code"] == "INVALID_REQUEST"


def test_chat_rejects_non_json_content_type(client, fake_job):
    res = client.post(
        "/chat",
        data="job_id=job-1",
        headers={"content-type": "text/plain"},
    )
    assert res.status_code == 415
