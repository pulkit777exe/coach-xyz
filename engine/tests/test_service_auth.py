"""Service-token middleware tests.

The engine is only reachable from the server in production; when SERVICE_TOKEN
is set every route except /health must present the shared x-service-token
header. When unset (local dev) the middleware is inert.
"""

import os

import pytest
from fastapi.testclient import TestClient

import main


@pytest.fixture()
def client():
    with TestClient(main.app) as test_client:
        yield test_client


def test_middleware_inert_when_service_token_unset(monkeypatch, client):
    monkeypatch.delenv("SERVICE_TOKEN", raising=False)
    # An unknown path 404s through routing — the middleware must not 403.
    res = client.get("/status/definitely-not-a-job")
    assert res.status_code != 403


def test_middleware_blocks_without_token(monkeypatch, client):
    monkeypatch.setenv("SERVICE_TOKEN", "s3cret")
    res = client.get("/status/definitely-not-a-job")
    assert res.status_code == 403
    body = res.json()
    assert body["code"] == "FORBIDDEN"


def test_middleware_rejects_wrong_token(monkeypatch, client):
    monkeypatch.setenv("SERVICE_TOKEN", "s3cret")
    res = client.get("/status/definitely-not-a-job", headers={"x-service-token": "wrong"})
    assert res.status_code == 403


def test_middleware_passes_with_matching_token(monkeypatch, client):
    monkeypatch.setenv("SERVICE_TOKEN", "s3cret")
    res = client.get("/status/definitely-not-a-job", headers={"x-service-token": "s3cret"})
    # Past the middleware — whatever the route handler says (404) is fine.
    assert res.status_code != 403


def test_health_exempt_even_when_token_set(monkeypatch, client):
    monkeypatch.setenv("SERVICE_TOKEN", "s3cret")
    res = client.get("/health")
    assert res.status_code == 200
