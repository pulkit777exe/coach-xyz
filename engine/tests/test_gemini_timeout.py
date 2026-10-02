"""The Gemini call is actually bounded in time.

Two separate defects let a hung model request wedge an analysis worker
indefinitely:

1. The one-shot executor was used as a context manager. `with` runs
   `ThreadPoolExecutor.__exit__` -> `shutdown(wait=True)`, and the timeout
   `raise` sat *inside* the block, so the shutdown joined the stuck worker
   before the EngineError could propagate. The timeout bounded nothing:
   reproduced with a 5s task and `timeout=0.5`, TimeoutError was raised at
   0.50s but the replacement error only surfaced at 5.00s.

2. The shared client was built with no `http_options`, so the SDK passed
   `timeout=None` to httpx, which reads as *wait forever*. So even abandoning
   the thread did not release it, and with `analysis_executor` at
   `max_workers=2` two hung requests permanently wedged the process.

These tests pin the executor's control flow (1) directly, and assert the client
carries a finite timeout (2).

Abandoning a worker is only safe because the work is *bounded*: the client's own
finite timeout is what eventually lets the stray thread finish. A test that
parks a worker on an unbounded wait instead leaks a non-daemon thread that
`concurrent.futures`' atexit hook joins at interpreter shutdown — pytest prints
its summary and then hangs forever. So every pool below is joined before it goes
out of scope, even the ones whose assertion is about *not* waiting.
"""

from __future__ import annotations

import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from pathlib import Path

import pytest

# Small on purpose: the counter-example only needs the ratio, and a 5s sleep per
# test made the engine suite crawl. The gap is still 12x, far outside the
# tolerance, so a regression to the joining shape cannot slip through.
def _stub_context(tmp_path: Path):
    """The minimum AnalysisContext `_stage_reasoning` reads before submitting."""
    from core.analyzer import AnalysisContext

    ctx = AnalysisContext.__new__(AnalysisContext)
    ctx.job_id = "job-timeout-test"
    ctx.active_tracks = []
    ctx.video_duration = 1.0
    ctx.fps = 30.0
    ctx.video_width = 8
    ctx.video_height = 8
    ctx.player_index = 0
    ctx.preprocessed_path = str(tmp_path / "in.mp4")
    ctx.frame_cache = None
    ctx.gemini_result = None
    return ctx


TASK_S = 0.6
TIMEOUT_S = 0.05


class _Abandoned(Exception):
    """Stands in for the EngineError the analyzer raises on timeout."""


def test_raising_a_timeout_from_inside_a_with_block_still_waits_for_the_worker() -> None:
    """Why the pool must not be a context manager on the timeout path.

    This is the *old* shape, kept as the counter-example: it passes, because it
    documents the trap rather than the fix. If it ever starts failing, the
    executor semantics this repo depends on have changed.
    """
    surfaced_after: list[float] = []
    started = threading.Event()

    def slow() -> str:
        started.set()
        time.sleep(TASK_S)
        return "late"

    began = time.monotonic()
    reached_caller: list[float] = []
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(slow)
            try:
                future.result(timeout=TIMEOUT_S)
            except FuturesTimeoutError:
                surfaced_after.append(time.monotonic() - began)
                raise _Abandoned("stand-in for EngineError")
    except _Abandoned:
        reached_caller.append(time.monotonic() - began)

    # The raise happened at ~0.5s ...
    assert surfaced_after[0] == pytest.approx(TIMEOUT_S, abs=0.15)
    # ... but the caller did not observe it until the worker finished at ~5s,
    # because __exit__ joined the stuck thread first.
    assert reached_caller[0] == pytest.approx(TASK_S, abs=0.2)


def test_shutdown_without_wait_surfaces_the_timeout_immediately() -> None:
    """The fix: abandon the worker rather than joining it."""

    def slow() -> str:
        time.sleep(TASK_S)
        return "late"

    began = time.monotonic()
    pool = ThreadPoolExecutor(max_workers=1)
    future = pool.submit(slow)
    try:
        future.result(timeout=TIMEOUT_S)
    except FuturesTimeoutError:
        pool.shutdown(wait=False, cancel_futures=True)
        elapsed = time.monotonic() - began
        # The caller is released at the timeout, not at the task's completion.
        assert elapsed == pytest.approx(TIMEOUT_S, abs=0.15)
    else:  # pragma: no cover - the task is far slower than the timeout
        pytest.fail("expected a timeout")
    finally:
        pool.shutdown(wait=False)


def test_a_completed_call_still_shuts_down_cleanly() -> None:
    pool = ThreadPoolExecutor(max_workers=1)
    future = pool.submit(lambda: "done")
    try:
        assert future.result(timeout=TIMEOUT_S) == "done"
    finally:
        pool.shutdown(wait=True)


def test_the_shared_gemini_client_carries_a_finite_timeout() -> None:
    from core.config import GEMINI_ANALYSIS_TIMEOUT_S
    from core.gemini_client import _client

    class _FakeTypes:
        class HttpOptions:  # noqa: N801 - mirrors the SDK's class name
            def __init__(self, timeout: int | None = None) -> None:
                self.timeout = timeout

    class _FakeClient:
        def __init__(self, api_key: str, http_options: object | None = None) -> None:
            self.api_key = api_key
            self.http_options = http_options

    class _FakeGenai:  # noqa: N801 - stands in for the `genai` module
        Client = _FakeClient

    import core.gemini_client as gc

    original_types, original_genai = gc.genai_types, gc.genai
    gc.genai_types, gc.genai = _FakeTypes, _FakeGenai
    try:
        client = _client("test-key")
    finally:
        gc.genai_types, gc.genai = original_types, original_genai

    assert client.http_options is not None, "client built with no http_options"
    timeout = client.http_options.timeout
    assert isinstance(timeout, int) and timeout > 0, timeout
    # Milliseconds, and the same bound the analysis stage applies around the call.
    assert timeout == GEMINI_ANALYSIS_TIMEOUT_S * 1000


def test_a_future_that_never_completes_is_released_by_the_timeout() -> None:
    """A future that is never resolved must not hold the caller."""
    pool = ThreadPoolExecutor(max_workers=1)
    never: Future = Future()  # nothing will ever call set_result
    pool.submit(lambda: never.result())  # occupies the single worker
    try:
        began = time.monotonic()
        with pytest.raises(FuturesTimeoutError):
            never.result(timeout=0.05)
        assert time.monotonic() - began < 0.4
    finally:
        # Abandoning the worker is what releases the *caller* (asserted above),
        # but it also parks a non-daemon thread on an unbounded wait, and
        # concurrent.futures' atexit hook joins every worker at interpreter
        # shutdown — so the suite would print its summary and then hang until
        # CI killed it. Resolving `never` and joining is what the production
        # path gets for free from the Gemini client's own finite timeout.
        never.set_result(None)
        pool.shutdown(wait=True)


class TestTheRealStageReleasesTheCaller:
    """Drive the actual `_stage_reasoning` timeout path.

    The two tests above pin the executor semantics in isolation, which is not the
    same as pinning the call site: a mutation that moves the `raise` back inside
    a `with` block in `analyzer.py` leaves both of them passing. This exercises
    the real stage and asserts the wall-clock the caller actually experiences.
    """

    def test_a_hung_gemini_call_surfaces_the_timeout_promptly(self, monkeypatch, tmp_path) -> None:
        import core.analyzer as analyzer
        from core.errors import EngineError

        task_s = 0.8
        # The stage imports ThreadPoolExecutor and GEMINI_ANALYSIS_TIMEOUT_S
        # from inside the function body, so the only seam is the modules it
        # pulls from: core.config for the bound, core.analyzer for the call.
        import core.config as config

        monkeypatch.setattr(config, "GEMINI_ANALYSIS_TIMEOUT_S", 0.05)
        monkeypatch.setattr(analyzer, "transition_job", lambda *a, **k: None, raising=False)

        def _hang(*_a, **_k):
            import time

            time.sleep(task_s)
            return {"summary": {}}

        monkeypatch.setattr(analyzer, "call_gemini", _hang, raising=False)
        monkeypatch.setattr(
            analyzer, "normalize_gemini_result", lambda r: r, raising=False
        )

        ctx = _stub_context(tmp_path)
        began = time.monotonic()
        with pytest.raises(EngineError) as excinfo:
            analyzer._stage_reasoning(ctx, resumed=False)
        elapsed = time.monotonic() - began

        assert excinfo.value.code == "GEMINI_TIMEOUT", excinfo.value.code
        assert excinfo.value.retryable is True
        # The `with ThreadPoolExecutor(...)` shape joins the stuck worker in
        # __exit__ before the error can propagate, so the caller waits out the
        # full task instead of the timeout. That was the bug.
        assert elapsed < task_s / 2, (
            f"the timeout surfaced after {elapsed:.2f}s, so the caller still waited "
            f"for the hung call ({task_s}s) — the pool is being joined on exit"
        )
