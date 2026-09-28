"""Tests for DELETE /download/{job_id} (result-video deletion)."""

from fastapi.testclient import TestClient

import main
from core import jobs
from core import storage
from core.jobs import JobStatus

client = TestClient(main.app)


class FakeRedis:
    """Minimal in-memory Redis stand-in for unit tests."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.published: list[tuple[str, str]] = []

    def get(self, key: str) -> str | None:
        return self.store.get(key)

    def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.store[key] = value

    def publish(self, channel: str, message: str) -> int:
        self.published.append((channel, message))
        return 1


def _seed_job(monkeypatch, job_id: str, video_key: str | None):
    fake = FakeRedis()
    monkeypatch.setattr(jobs, "redis", fake)
    job = JobStatus(job_id=job_id, state="completed", video_key=video_key)
    fake.set(f"{jobs.KEY}{job_id}", job.to_redis(), ex=jobs.JOB_TTL)
    return fake


def _result_file(job_id: str):
    dest = storage._key_to_local_path(storage.result_key(job_id))
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(b"fake-mp4")
    return dest


class TestDeleteResult:
    def test_missing_job_is_404(self, monkeypatch):
        fake = FakeRedis()
        monkeypatch.setattr(jobs, "redis", fake)
        res = client.delete("/download/no-such-job")
        assert res.status_code == 404
        assert res.json()["code"] == "JOB_NOT_FOUND"

    def test_job_without_video_is_ok_not_deleted(self, monkeypatch):
        _seed_job(monkeypatch, "job-no-video", None)
        res = client.delete("/download/job-no-video")
        assert res.status_code == 200
        assert res.json() == {"ok": True, "deleted": False}

    def test_deletes_the_rendered_file(self, monkeypatch):
        _seed_job(monkeypatch, "job-with-video", storage.result_key("job-with-video"))
        dest = _result_file("job-with-video")
        assert dest.exists()
        res = client.delete("/download/job-with-video")
        assert res.status_code == 200
        assert res.json() == {"ok": True, "deleted": True}
        assert not dest.exists()

    def test_missing_file_is_still_ok(self, monkeypatch):
        # The file may already be swept; deletion stays idempotent.
        _seed_job(monkeypatch, "job-gone-file", storage.result_key("job-gone-file"))
        dest = storage._key_to_local_path(storage.result_key("job-gone-file"))
        if dest.exists():
            dest.unlink()
        res = client.delete("/download/job-gone-file")
        assert res.status_code == 200
        assert res.json()["deleted"] is True
