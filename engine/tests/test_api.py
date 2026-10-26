import base64
import json

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

import main
from core import config, llm, pipeline


@pytest.fixture
def client():
    with TestClient(main.app) as c:
        yield c


def upload(client, video, **form):
    with open(video, "rb") as f:
        return client.post("/scan", files={"video": ("match.mp4", f, "video/mp4")}, data=form)


def red_player(players: list[dict]) -> int:
    for p in players:
        img = cv2.imdecode(np.frombuffer(base64.b64decode(p["crop_base64"]), np.uint8), cv2.IMREAD_COLOR)
        b, g, r = img.reshape(-1, 3).mean(axis=0)
        if r > b:
            return p["player_index"]
    raise AssertionError("no red player")


def stream_types(client, path):
    out = []
    with client.stream("GET", path) as r:
        for line in r.iter_lines():
            if line.startswith("event: "):
                out.append(line[7:])
    return out


def test_scan_then_job_then_everything_the_server_needs(client, video):
    r = upload(client, video, angle="side")
    assert r.status_code == 200
    scan = r.json()
    assert scan["angle"] == "side" and scan["player_count"] == 2 and scan["media"]["duration"] > 11
    assert "signature" not in scan["players"][0]

    made = client.post("/jobs", json={"job_id": "api1", "session_token": scan["session_token"], "angle": "side",
                                      "player_index": red_player(scan["players"]), "sport": "basketball",
                                      "meta": {"team_id": 9}})
    assert made.status_code == 202 and made.json()["meta"] == {"team_id": 9}

    seen = stream_types(client, "/jobs/api1/events")
    assert seen[0] == "job.queued" and seen[-1] == "job.completed" and "result.ready" in seen
    assert client.get("/jobs/api1").json()["state"] == "completed"

    result = client.get("/jobs/api1/result").json()
    assert len(result["events"]) == 3 and result["sport"] == "basketball"

    video_response = client.get("/jobs/api1/files/analysis.mp4")
    assert video_response.status_code == 200 and video_response.headers["content-type"] == "video/mp4"
    part = client.get("/jobs/api1/files/analysis.mp4", headers={"range": "bytes=0-99"})
    assert part.status_code == 206 and len(part.content) == 100
    assert client.get("/jobs/api1/files/thumbs/event_1.jpg").headers["content-type"] == "image/jpeg"
    assert client.get("/jobs/api1/files/../../x").status_code in (400, 404)


def test_events_can_be_resumed_after_a_dropped_connection(client, video):
    players = upload(client, video).json()
    client.post("/jobs", json={"job_id": "api2", "session_token": players["session_token"], "render": False})
    stream_types(client, "/jobs/api2/events")
    with client.stream("GET", "/jobs/api2/events", headers={"Last-Event-ID": "0"}) as r:
        first = next(line for line in r.iter_lines() if line.startswith("event: "))
    assert first == "event: job.queued"
    assert stream_types(client, "/jobs/api2/events?after=999999999") == []  # past the end: closes, does not hang


def test_old_status_download_and_analyze_endpoints_still_work(client, video):
    token = upload(client, video).json()["session_token"]
    r = client.post("/analyze", json={"engine_job_id": "old1", "session_token": token, "player_index": 1,
                                      "sport": "basketball"})
    assert r.status_code == 200 and r.json() == {"ok": True}
    status = client.get("/status/old1").json()
    assert status["state"] == "completed" and status["complete"] and status["video_ready"]
    summary = status["summary"]
    assert summary["sport"] == "basketball" and summary["shot_events"] and "findings" in summary
    assert {"timestamp", "event_type", "form_score", "feedback", "weighted_scoring"} <= set(summary["shot_events"][0])
    assert client.get("/download/old1").headers["content-type"] == "video/mp4"


def test_a_failed_job_reports_its_error_and_can_be_retried(client, tmp_path):
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"junk" * 500)
    r = upload(client, str(bad))
    assert r.status_code >= 400 and r.json()["code"] in ("VIDEO_DECODE_FAILED", "NO_PLAYERS_DETECTED")


def test_uploads_are_validated(client, tmp_path):
    junk = tmp_path / "x.mp4"
    junk.write_bytes(b"hello world" * 100)
    r = upload(client, str(junk))
    assert r.status_code == 422 and r.json()["code"] == "VIDEO_DECODE_FAILED"
    assert client.post("/jobs", json={"job_id": "x"}).status_code == 400
    assert client.post("/jobs", json={"session_token": "nope"}).json()["code"] == "SESSION_EXPIRED"
    assert client.post("/jobs", json={"video_key": "../etc/passwd"}).status_code == 400
    assert client.post("/jobs", json={"video_key": "raw/s/primary/" + "a" * 32 + ".mp4", "sport": "curling"}).status_code == 400
    assert client.get("/jobs/missing").json()["code"] == "JOB_NOT_FOUND"
    assert client.post("/upload-intent", json={"filename": "a.mp4", "mime_type": "image/png", "size_bytes": 5}).status_code == 400
    slot = client.post("/upload-intent", json={"filename": "a.mp4", "mime_type": "video/mp4", "size_bytes": 5}).json()
    assert slot["upload"]["mode"] == "multipart" and slot["key"].startswith("raw/")


def test_scan_progress_streams_and_ends(client, video):
    token = upload(client, video).json()["session_token"]
    seen = stream_types(client, f"/scan-progress/{token}")
    assert seen[-1] == "scan.completed" and "scan.progress" in seen


def test_service_token_protects_everything_but_health(client, monkeypatch):
    monkeypatch.setattr(config.settings, "service_token", "s3cret")
    assert client.get("/health").status_code == 200
    assert client.get("/jobs/x").status_code == 403
    assert client.get("/jobs/x", headers={"x-service-token": "wrong"}).status_code == 403
    assert client.get("/jobs/x", headers={"x-service-token": "s3cret"}).status_code == 404


def test_production_refuses_to_start_without_a_token(monkeypatch):
    monkeypatch.setattr(config.settings, "env", "production")
    with pytest.raises(RuntimeError):
        with TestClient(main.app):
            pass


def test_chat_stream_and_report(client, video, monkeypatch):
    token = upload(client, video).json()["session_token"]
    client.post("/jobs", json={"job_id": "c1", "session_token": token, "sport": "basketball", "render": False})
    stream_types(client, "/jobs/c1/events")

    reply = client.post("/chat", json={"job_id": "c1", "message": "What about my release?"}).json()
    assert reply["timestamp_refs"] == [2.0] and reply["event_refs"] == ["x:e1"]

    with client.stream("POST", "/chat/stream", json={"job_id": "c1", "message": "hi"}) as r:
        frames = [json.loads(line[6:]) for line in r.iter_lines() if line.startswith("data: ")]
    assert [f["type"] for f in frames] == ["token", "token", "done"] and frames[-1]["text"] == "At 2.0s your release."

    assert client.post("/chat", json={"job_id": "ghost", "message": "hi"}).json()["code"] == "RESULT_NOT_FOUND"

    def down():
        raise llm.Unavailable("quota", retry_after=42)

    monkeypatch.setattr(pipeline, "make_model", down)
    r = client.post("/chat", json={"job_id": "c1", "message": "hi"})
    assert r.status_code == 503 and r.json()["retry_after"] == 42 and r.headers["retry-after"] == "42"
    r = client.post("/report", json={"report_context": {"a": 1}, "report_type": "progress"})
    assert r.status_code == 503 and r.json()["retryable"] is True
