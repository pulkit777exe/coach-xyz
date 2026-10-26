import time

import pytest

from core import config, jobs, llm, pipeline

from . import fakes


@pytest.fixture(autouse=True)
def env(tmp_path, monkeypatch):
    s = config.settings
    monkeypatch.setattr(s, "data_dir", tmp_path / "data")
    monkeypatch.setattr(s, "service_token", "")
    monkeypatch.setattr(s, "storage_backend", "local")
    monkeypatch.setattr(s, "workers", 1)
    monkeypatch.setattr(s, "gemini_key", "test-key")
    monkeypatch.setattr(s, "gemini_min_interval_s", 0)
    monkeypatch.setattr(pipeline, "make_detector", fakes.FakePose)
    monkeypatch.setattr(pipeline, "make_model", lambda: fakes.FakeModel())
    llm.reset()
    yield
    jobs.shutdown()


@pytest.fixture
def video(tmp_path):
    return fakes.make_video(str(tmp_path / "match.mp4"))


@pytest.fixture
def wait():
    def _wait(job_id: str, timeout: float = 90):
        end = time.time() + timeout
        while time.time() < end:
            job = jobs.get(job_id)
            if job and job["state"] in ("completed", "failed", "cancelled"):
                return job
            time.sleep(0.1)
        raise AssertionError(f"job {job_id} did not finish: {jobs.get(job_id)}")

    return _wait
