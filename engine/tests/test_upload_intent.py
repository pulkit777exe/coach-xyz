"""Tests for /upload-intent + /scan-from-key (direct-to-storage §8)."""

from fastapi.testclient import TestClient

import main

client = TestClient(main.app, raise_server_exceptions=False)


def _intent(payload):
    return client.post("/upload-intent", json=payload)


class TestUploadIntent:
    def test_rejects_non_video_mime(self):
        res = _intent({"filename": "x.png", "mime_type": "image/png", "size_bytes": 100})
        assert res.status_code == 400

    def test_rejects_missing_fields(self):
        assert _intent({}).status_code == 400
        assert _intent({"filename": "x.mp4"}).status_code == 400

    def test_rejects_oversize(self):
        res = _intent({
            "filename": "big.mp4",
            "mime_type": "video/mp4",
            "size_bytes": 10 * 1024 * 1024 * 1024,
        })
        assert res.status_code == 413

    def test_mints_namespaced_key_local_mode(self):
        res = _intent({"filename": "clip.mp4", "mime_type": "video/mp4", "size_bytes": 1024, "angle": "side"})
        assert res.status_code == 200
        body = res.json()
        assert body["key"].startswith("raw/")
        assert body["key"].endswith(".mp4")
        assert body["angle"] == "side"
        assert body["upload"]["mode"] == "multipart"

    def test_angle_label_normalized(self):
        res = _intent({
            "filename": "a.mp4",
            "mime_type": "video/mp4",
            "size_bytes": 10,
            "angle": "  Side View! ",
        }).json()
        assert res["angle"] == "sideview"

    def test_unknown_session_starts_new_one(self):
        res = _intent({
            "filename": "a.mp4",
            "mime_type": "video/mp4",
            "size_bytes": 10,
            "session_token": "no-such-session",
        }).json()
        assert res["session_token"] != "no-such-session"


class TestScanFromKey:
    def test_rejects_non_intent_keys(self):
        assert client.post("/scan-from-key", json={"storage_key": "results/x.mp4"}).status_code == 400
        assert client.post("/scan-from-key", json={"storage_key": "../escape.mp4"}).status_code == 400
        assert client.post("/scan-from-key", json={}).status_code == 400

    def test_missing_upload_is_404(self):
        key = "raw/00000000-0000-0000-0000-000000000000/primary/" + "a" * 32 + ".mp4"
        res = client.post("/scan-from-key", json={"storage_key": key})
        assert res.status_code == 404
