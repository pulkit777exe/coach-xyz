"""The dedup wait in _stage_prepare — core/analyzer.py.

Stage-level counterpart to tests/test_dedup.py. The unit tests prove the
deduplicator wakes a waiter promptly; these prove the *caller* actually uses that
path, since the defect was the caller's `time.sleep(2)` and a fix in the
deduplicator alone would leave the slot still pinned.

The measurement is end-to-end: a duplicate upload whose holder finishes must see
the cache and complete well inside the 2s tick it used to sleep through. The old
shape would take ~2s here, so the ceiling sits well under the tick.

`_stage_prepare` is driven directly with the storage/cache seams stubbed: the
behaviour under test is the wait, and reaching real storage or Redis would add
nothing to it.
"""

from __future__ import annotations

import threading
import time

import pytest

from core import analyzer as analyzer_mod
from core.analyzer import AnalysisContext, _stage_prepare
from core.dedup import RequestDeduplicator

# The tick the previous implementation slept for.
TICK_SECONDS = 2.0
# Ceiling for "the holder completed, so the duplicate must return now". Well
# under the tick, so the old sleep(2) shape cannot pass.
WAKE_CEILING = 0.5

VIDEO_HASH = "a" * 64
DEDUP_KEY = f"{VIDEO_HASH}:0"


class _StageRun:
    """One _stage_prepare call on its own thread, with timing recorded."""

    def __init__(self, job_id: str) -> None:
        self.job_id = job_id
        self.outcome: str | None = None
        self.elapsed = 0.0
        self._ctx = AnalysisContext(job_id=job_id, video_key="key", player_index=0)
        self._thread = threading.Thread(target=self._run, name=f"stage-{job_id}", daemon=True)

    def _run(self) -> None:
        started = time.monotonic()
        self.outcome = _stage_prepare(self._ctx)
        self.elapsed = time.monotonic() - started

    def start(self) -> "_StageRun":
        self._thread.start()
        return self

    def is_blocked(self, seconds: float = 0.2) -> bool:
        """True if the stage is still running after `seconds` — i.e. it is
        genuinely parked on the dedup wait rather than returning immediately."""
        self._thread.join(timeout=seconds)
        return self._thread.is_alive()

    def join(self, timeout: float = 5.0) -> bool:
        self._thread.join(timeout=timeout)
        return not self._thread.is_alive()


@pytest.fixture
def stage_env(monkeypatch, tmp_path):
    """Stub every seam _stage_prepare touches, with a controllable cache."""
    video = tmp_path / "video.mp4"
    video.write_bytes(b"not really a video, but the hash is stubbed")

    state: dict = {"cache": None, "completed": []}

    monkeypatch.setattr(analyzer_mod.storage, "download_video_to_tmp", lambda key: str(video))
    monkeypatch.setattr(analyzer_mod.storage, "is_local_backend", lambda: True)
    monkeypatch.setattr(analyzer_mod, "compute_video_hash", lambda path: VIDEO_HASH)
    monkeypatch.setattr(analyzer_mod, "get_cached_analysis", lambda h, p=None: state["cache"])
    monkeypatch.setattr(analyzer_mod, "_finalize_cached", lambda result, job_id, angle: result)
    monkeypatch.setattr(
        analyzer_mod,
        "_safe_transition_to_completed",
        lambda job_id, cached: state["completed"].append((job_id, cached)),
    )

    # The module-level singleton is what _stage_prepare dereferences, so replace
    # the attribute it reads rather than constructing a private deduplicator.
    dedup = RequestDeduplicator(ttl_seconds=300)
    monkeypatch.setattr(analyzer_mod, "deduplicator", dedup)
    return state, dedup


class TestStagePrepareDedupWait:
    def test_duplicate_returns_as_soon_as_the_holder_caches(self, stage_env):
        """The measured defect: one duplicate pinned one of only two analysis
        slots for the holder's whole run, and every completion landed up to 2s
        late. With the event, a duplicate whose holder finishes returns on the
        completion."""
        state, dedup = stage_env
        dedup.mark_pending(DEDUP_KEY)

        run = _StageRun("job-duplicate").start()
        assert run.is_blocked(), "the duplicate should be waiting on the held key"

        # The holder finishes: writes the cache, then releases the key.
        state["cache"] = {"success": True, "form_score": 70}
        dedup.mark_done(DEDUP_KEY)
        assert run.join(timeout=WAKE_CEILING * 4), "duplicate never woke"

        assert run.outcome == "done"
        assert run.elapsed < WAKE_CEILING, (
            f"duplicate took {run.elapsed:.3f}s — at or past the {TICK_SECONDS}s "
            "tick it should no longer be sleeping through"
        )
        assert state["completed"] == [("job-duplicate", state["cache"])]

    def test_holder_finishing_without_a_cache_lets_the_duplicate_run(self, stage_env):
        """Failure path: the holder released the key but cached nothing (it
        failed before scoring). The duplicate must stop waiting, find no cache,
        and take the key itself rather than waiting out the 300s budget."""
        state, dedup = stage_env
        dedup.mark_pending(DEDUP_KEY)

        run = _StageRun("job-failed-holder").start()
        assert run.is_blocked()

        state["cache"] = None
        dedup.mark_done(DEDUP_KEY)
        assert run.join(timeout=WAKE_CEILING * 4)

        assert run.outcome == "continue", "duplicate should proceed to analyze"
        assert run.elapsed < WAKE_CEILING
        assert dedup.is_pending(DEDUP_KEY), "the duplicate must claim the key it inherits"
        assert state["completed"] == []

    def test_two_duplicates_both_complete_when_the_holder_does(self, stage_env):
        """Two duplicates on one key: both must complete when the holder does,
        neither left blocked on an event that will never be set again."""
        state, dedup = stage_env
        dedup.mark_pending(DEDUP_KEY)

        runs = [_StageRun(f"job-dup-{i}").start() for i in range(2)]
        for run in runs:
            assert run.is_blocked()

        state["cache"] = {"success": True}
        dedup.mark_done(DEDUP_KEY)
        for run in runs:
            assert run.join(timeout=WAKE_CEILING * 4)

        assert all(run.outcome == "done" for run in runs)
        assert all(run.elapsed < WAKE_CEILING for run in runs)
        assert sorted(job_id for job_id, _ in state["completed"]) == ["job-dup-0", "job-dup-1"]

    def test_duplicate_arriving_after_the_holder_released_misses_the_wait(self, stage_env):
        """The waiter subscribes under the same lock acquisition that observes
        presence, so a release that lands first cannot strand it. Either
        ordering must end in a completed duplicate, never a hang."""
        state, dedup = stage_env

        for _ in range(40):
            key = f"{VIDEO_HASH}:{_}"
            dedup.mark_pending(key)
            state["cache"] = {"success": True}
            # Released immediately, before the stage has reason to look.
            dedup.mark_done(key)

            run = _StageRun("job-late").start()
            assert run.join(timeout=WAKE_CEILING * 4), f"stuck on round {_}"
            assert run.outcome == "done"
            assert run.elapsed < WAKE_CEILING
            dedup.mark_done(key)

    def test_first_analysis_does_not_wait_at_all(self, stage_env):
        """The uncontended path is untouched — no key held, no wait."""
        state, dedup = stage_env

        started = time.monotonic()
        outcome = _stage_prepare(AnalysisContext(job_id="job-first", video_key="key", player_index=0))
        elapsed = time.monotonic() - started

        assert outcome == "continue"
        assert elapsed < WAKE_CEILING
        assert dedup.is_pending(DEDUP_KEY), "the first run must claim the key"
        assert state["completed"] == []

    def test_cache_hit_short_circuits_without_touching_dedup(self, stage_env):
        """A cache hit returns before any dedup key is registered, which is why
        run_analysis's finally can call mark_done on the empty key."""
        state, dedup = stage_env
        state["cache"] = {"success": True, "form_score": 88}

        ctx = AnalysisContext(job_id="job-cache-hit", video_key="key", player_index=0)
        assert _stage_prepare(ctx) == "done"

        assert state["completed"] == [("job-cache-hit", state["cache"])]
        assert ctx.dedup_key == "", "no dedup key should have been registered"

        # The finally's mark_done on that empty key must be a no-op.
        dedup.mark_done(ctx.dedup_key)
        assert dedup.pending == {}
        assert dedup._events == {}
