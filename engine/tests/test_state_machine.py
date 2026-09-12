"""Tests for the job state machine in core/jobs.py."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from core.errors import InvalidStateTransition
from core import jobs
from core.jobs import (
    JOB_TTL,
    KEY,
    VALID_TRANSITIONS,
    JobStatus,
    transition_job,
    get_job,
)
from core.analyzer import _safe_transition_to_completed


# ── Fake Redis ────────────────────────────────────────────────────────────────

class FakeRedis:
    """Minimal in-memory Redis stand-in for unit tests."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    def get(self, key: str) -> str | None:
        return self.store.get(key)

    def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.store[key] = value


@pytest.fixture(autouse=True)
def _patch_redis(monkeypatch):
    """Replace the module-level redis client with a FakeRedis for every test."""
    fake = FakeRedis()
    monkeypatch.setattr(jobs, "redis", fake)
    return fake


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_job(job_id: str = "test-job", state: str = "uploading") -> JobStatus:
    """Create a job directly in the fake Redis store (bypasses transition validation)."""
    job = JobStatus(job_id=job_id, state=state)
    state_info = jobs.PIPELINE_STATES[state]
    job.stage = state_info["stage"]
    job.stage_name = state_info["stage_name"]
    job.progress = state_info["progress"]
    if state in ("completed", "failed"):
        job.complete = True
    jobs.redis.set(f"{KEY}{job_id}", job.to_redis(), ex=JOB_TTL)
    return job


# ── Valid transitions ─────────────────────────────────────────────────────────

VALID_CASES = [
    ("uploading", "scanning"),
    ("uploading", "failed"),
    ("scanning", "player_selection"),
    ("scanning", "analyzing"),
    ("scanning", "failed"),
    ("player_selection", "analyzing"),
    ("player_selection", "failed"),
    ("analyzing", "rendering"),
    ("analyzing", "completed"),
    ("analyzing", "failed"),
    ("rendering", "completed"),
    ("rendering", "failed"),
    ("failed", "scanning"),  # ADR-003: retry path
]


@pytest.mark.parametrize("from_state,to_state", VALID_CASES, ids=[f"{f}->{t}" for f, t in VALID_CASES])
def test_valid_transition_succeeds(from_state: str, to_state: str):
    _make_job("job-1", from_state)
    transition_job("job-1", to_state)
    job = get_job("job-1")
    assert job.state == to_state
    if to_state == "completed":
        assert job.complete is True
    if to_state == "failed":
        assert job.complete is True


def test_retry_transition_clears_failed_terminal_fields():
    job = _make_job("job-retry", "failed")
    job.error = "Previous failure"
    job.error_code = "INTERNAL_ERROR"
    job.retryable = False
    jobs.redis.set(f"{KEY}job-retry", job.to_redis(), ex=JOB_TTL)

    transition_job("job-retry", "scanning")

    retried = get_job("job-retry")
    assert retried.state == "scanning"
    assert retried.complete is False
    assert retried.error is None
    assert retried.error_code is None
    assert retried.retryable is True


# ── Invalid transitions ───────────────────────────────────────────────────────

INVALID_CASES = [
    ("completed", "scanning"),
    ("completed", "analyzing"),
    ("completed", "rendering"),
    ("completed", "uploading"),
    ("completed", "failed"),
    ("uploading", "rendering"),
    ("uploading", "completed"),
    ("uploading", "player_selection"),
    ("scanning", "uploading"),
    ("scanning", "completed"),
    ("scanning", "rendering"),
    ("player_selection", "uploading"),
    ("player_selection", "scanning"),
    ("player_selection", "rendering"),
    ("player_selection", "completed"),
    ("rendering", "uploading"),
    ("rendering", "scanning"),
    ("rendering", "analyzing"),
    ("rendering", "player_selection"),
    ("failed", "uploading"),
    ("failed", "completed"),
    ("failed", "rendering"),
    ("failed", "analyzing"),
    ("failed", "player_selection"),
]


@pytest.mark.parametrize(
    "from_state,to_state",
    INVALID_CASES,
    ids=[f"{f}->{t}_invalid" for f, t in INVALID_CASES],
)
def test_invalid_transition_raises(from_state: str, to_state: str):
    _make_job("job-inv", from_state)
    with pytest.raises(InvalidStateTransition) as exc_info:
        transition_job("job-inv", to_state)
    assert exc_info.value.code == "INVALID_STATE_TRANSITION"
    # Job should remain in original state
    job = get_job("job-inv")
    assert job.state == from_state


# ── Completed is terminal ─────────────────────────────────────────────────────

def test_completed_is_terminal():
    """No transitions allowed from completed — every VALID_TRANSITIONS entry is empty set."""
    assert VALID_TRANSITIONS["completed"] == set()


# ── Idempotency guard (run_analysis) ─────────────────────────────────────────

class TestIdempotencyGuard:
    """The idempotency check at the top of run_analysis()."""

    @patch("core.analyzer.get_job")
    def test_completed_job_returns_early(self, mock_get_job):
        """If job is already completed, run_analysis returns without re-running."""
        from core.analyzer import run_analysis

        mock_get_job.return_value = JobStatus(job_id="j1", state="completed", complete=True)
        # Should return without doing any work — no exception, no download, etc.
        run_analysis("j1", "fake-key", None)

    @patch("core.analyzer.get_job")
    def test_failed_job_does_not_return_early(self, mock_get_job):
        """If job is failed, run_analysis proceeds (retry path)."""
        from core.analyzer import run_analysis

        mock_get_job.return_value = JobStatus(job_id="j2", state="failed", complete=True)
        # It will proceed past the guard and eventually hit storage download.
        # We just need to confirm it doesn't return early — it should raise
        # because storage.download_video_to_tmp will fail.
        with pytest.raises(Exception):
            run_analysis("j2", "fake-key", None)


# ── _safe_transition_to_completed ─────────────────────────────────────────────

class TestSafeTransitionToCompleted:
    """_safe_transition_to_completed walks through intermediate states."""

    def test_from_uploading(self):
        _make_job("safe-1", "uploading")
        _safe_transition_to_completed("safe-1", {"result": "ok"})
        job = get_job("safe-1")
        assert job.state == "completed"
        assert job.complete is True
        assert job.summary == {"result": "ok"}

    def test_from_scanning(self):
        _make_job("safe-2", "scanning")
        _safe_transition_to_completed("safe-2", {"result": "ok"})
        job = get_job("safe-2")
        assert job.state == "completed"

    def test_from_analyzing(self):
        _make_job("safe-3", "analyzing")
        _safe_transition_to_completed("safe-3", {"result": "ok"})
        job = get_job("safe-3")
        assert job.state == "completed"

    def test_from_already_completed(self):
        _make_job("safe-4", "completed")
        _safe_transition_to_completed("safe-4", {"result": "updated"})
        job = get_job("safe-4")
        assert job.state == "completed"
        assert job.summary == {"result": "updated"}

    def test_from_already_failed(self):
        """Failed jobs route through scanning first, then complete."""
        _make_job("safe-5", "failed")
        _safe_transition_to_completed("safe-5", {"result": "ok"})
        job = get_job("safe-5")
        assert job.state == "completed"
        assert job.complete is True
        assert job.summary == {"result": "ok"}
