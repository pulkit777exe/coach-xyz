"""The deep health probe must see the pose model asset.

pose_backend_available() only proves the mediapipe package imports, so an
image built without pose_landmarker_full.task reported a healthy backend and
then died on the first analysis with "model file is missing". The asset is
fetched by the Dockerfile now, and this probe is what tells you when an image
is wrong instead of serving a broken service.
"""

import pytest
from fastapi.testclient import TestClient

import main
from core import pose_backend

MODEL_NAME = "pose_landmarker_full.task"


@pytest.fixture()
def client():
    with TestClient(main.app) as test_client:
        yield test_client


def test_deep_health_reports_the_model_path(client):
    check = client.get("/health/deep").json()["checks"]["pose_model"]
    assert check["path"].endswith(MODEL_NAME)


def test_deep_health_ok_when_the_asset_exists(client, monkeypatch, tmp_path):
    model = tmp_path / MODEL_NAME
    model.write_bytes(b"not-a-real-model")
    monkeypatch.setattr(pose_backend, "_default_model_path", lambda: model)

    check = client.get("/health/deep").json()["checks"]["pose_model"]
    assert check["ok"] is True
    assert check["path"] == str(model)


def test_deep_health_flags_a_missing_asset_and_degrades(client, monkeypatch, tmp_path):
    monkeypatch.setattr(pose_backend, "_default_model_path", lambda: tmp_path / MODEL_NAME)

    body = client.get("/health/deep").json()
    assert body["checks"]["pose_model"]["ok"] is False
    # Redis is usually unreachable in tests, but a missing model must be enough
    # on its own to stop claiming the service is healthy.
    assert body["status"] == "degraded"
