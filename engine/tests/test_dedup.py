"""Tests for core/dedup.py — the in-flight analysis deduplicator.

The event-driven wait is the load-bearing part: a waiter that never wakes is
worse than one that polls. So these tests assert the wake happens *before* the
2s sweep tick would fire, on every terminal path, and that no key can strand a
waiter. A test that slept longer than the tick and asserted "it woke" would pass
against the old time.sleep(2) loop — useless.
"""

import threading
import time

from core.dedup import RequestDeduplicator

# The analyzer's sweep tick. Any wake measured against this proves the event,
# not the poll, released the waiter.
TICK_SECONDS = 2.0


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def _wait_in_thread(dedup: RequestDeduplicator, key: str, timeout: float, result: dict) -> threading.Thread:
    """Run one wait_for_clear on its own thread, recording verdict + finish time."""

    def run() -> None:
        result["cleared"] = dedup.wait_for_clear(key, timeout=timeout)
        result["finished_at"] = time.monotonic()

    thread = threading.Thread(target=run, name="dedup-waiter", daemon=True)
    thread.start()
    return thread


def _let_park(thread: threading.Thread, seconds: float = 0.05) -> None:
    """Let the waiter thread reach event.wait() before the holder acts.

    Without this the holder could mark_done before the waiter subscribes, and
    the wake measurement below would be measuring the wrong thing. The lost-wakeup
    ordering itself is pinned by test_lost_wakeup_... which releases concurrently
    with subscription over many rounds.
    """
    thread.join(timeout=seconds)
    assert thread.is_alive(), "waiter returned before it had anything to wait for"


class TestRequestDeduplicator:
    def test_pending_until_marked_done(self, monkeypatch):
        clock = FakeClock()
        monkeypatch.setattr("core.dedup.time.time", clock)
        dedup = RequestDeduplicator(ttl_seconds=300)

        dedup.mark_pending("hash-1")
        assert dedup.is_pending("hash-1")

        dedup.mark_done("hash-1")
        assert not dedup.is_pending("hash-1")

    def test_different_hashes_are_independent(self, monkeypatch):
        clock = FakeClock()
        monkeypatch.setattr("core.dedup.time.time", clock)
        dedup = RequestDeduplicator(ttl_seconds=300)

        dedup.mark_pending("hash-1")
        assert not dedup.is_pending("hash-2")
        assert dedup.is_pending("hash-1")

    def test_expired_entries_are_cleaned_up(self, monkeypatch):
        clock = FakeClock()
        monkeypatch.setattr("core.dedup.time.time", clock)
        dedup = RequestDeduplicator(ttl_seconds=300)

        dedup.mark_pending("hash-1")
        clock.now += 301
        assert not dedup.is_pending("hash-1")

    def test_duplicate_marks_keep_a_single_pending_entry(self, monkeypatch):
        clock = FakeClock()
        monkeypatch.setattr("core.dedup.time.time", clock)
        dedup = RequestDeduplicator(ttl_seconds=300)

        dedup.mark_pending("hash-1")
        dedup.mark_pending("hash-1")
        assert len(dedup.pending) == 1
        assert dedup.is_pending("hash-1")

    # ── the failure paths ─────────────────────────────────────────────────────
    # The holder's mark_done is called from a `finally` in run_analysis, so
    # success, EngineError, FileNotFoundError and bare Exception all reach it.
    # These pin that no *other* terminal path can exist that skips it, and that
    # the TTL sweep — the other way a key leaves `pending` — wakes waiters too.

    def test_mark_done_wakes_a_waiter_immediately(self, monkeypatch):
        clock = FakeClock()
        monkeypatch.setattr("core.dedup.time.time", clock)
        dedup = RequestDeduplicator(ttl_seconds=300)
        dedup.mark_pending("hash-1")

        result: dict = {}
        waiter = _wait_in_thread(dedup, "hash-1", timeout=TICK_SECONDS, result=result)
        _let_park(waiter)

        released_at = time.monotonic()
        dedup.mark_done("hash-1")
        waiter.join(timeout=5)
        wake_latency = result["finished_at"] - released_at

        assert not waiter.is_alive()
        assert result["cleared"] is True
        # The point of the whole change: released by the event, not the 2s tick.
        assert wake_latency < TICK_SECONDS / 2, (
            f"waiter woke {wake_latency:.3f}s after mark_done — that is the poll "
            "tick, not the event"
        )

    def test_failure_path_wakes_a_waiter_immediately(self, monkeypatch):
        """A holder that raises still releases the key — the waiter's actual
        observed case, since the analysis it was waiting on most often fails."""
        clock = FakeClock()
        monkeypatch.setattr("core.dedup.time.time", clock)
        dedup = RequestDeduplicator(ttl_seconds=300)
        dedup.mark_pending("hash-1")

        result: dict = {}
        waiter = _wait_in_thread(dedup, "hash-1", timeout=TICK_SECONDS, result=result)
        _let_park(waiter)

        released_at = time.monotonic()
        # The holder's finally: mark_done runs on the exception path too.
        try:
            raise RuntimeError("gemini blew up")
        except RuntimeError:
            dedup.mark_done("hash-1")
        waiter.join(timeout=5)
        wake_latency = result["finished_at"] - released_at

        assert not waiter.is_alive()
        assert result["cleared"] is True
        assert wake_latency < TICK_SECONDS / 2

    def test_ttl_sweep_wakes_a_waiter_instead_of_stranding_it(self, monkeypatch):
        """The sweep is the other terminal path. It must set the event too —
        otherwise a stale key waits out its whole 300s budget."""
        clock = FakeClock()
        monkeypatch.setattr("core.dedup.time.time", clock)
        dedup = RequestDeduplicator(ttl_seconds=300)
        dedup.mark_pending("hash-1")

        result: dict = {}
        waiter = _wait_in_thread(dedup, "hash-1", timeout=TICK_SECONDS, result=result)
        _let_park(waiter)

        # A concurrent thread's is_pending advances past the TTL and sweeps.
        clock.now += 301
        swept_at = time.monotonic()
        assert not dedup.is_pending("hash-1")
        waiter.join(timeout=5)
        wake_latency = result["finished_at"] - swept_at

        assert not waiter.is_alive()
        assert result["cleared"] is True
        assert wake_latency < TICK_SECONDS / 2

    def test_timeout_returns_false_rather_than_blocking_forever(self, monkeypatch):
        """A live key the holder never releases must still return, so the
        waiter's own 300s deadline stays enforceable."""
        clock = FakeClock()
        monkeypatch.setattr("core.dedup.time.time", clock)
        dedup = RequestDeduplicator(ttl_seconds=300)
        dedup.mark_pending("hash-1")

        started = time.monotonic()
        cleared = dedup.wait_for_clear("hash-1", timeout=0.05)
        elapsed = time.monotonic() - started

        assert cleared is False
        assert 0.04 <= elapsed < 1.0
        assert dedup.is_pending("hash-1"), "a timed-out wait must not release the key"

    def test_two_waiters_on_one_key_both_wake(self, monkeypatch):
        clock = FakeClock()
        monkeypatch.setattr("core.dedup.time.time", clock)
        dedup = RequestDeduplicator(ttl_seconds=300)
        dedup.mark_pending("hash-1")

        first: dict = {}
        second: dict = {}
        w1 = _wait_in_thread(dedup, "hash-1", timeout=TICK_SECONDS, result=first)
        _let_park(w1)
        w2 = _wait_in_thread(dedup, "hash-1", timeout=TICK_SECONDS, result=second)
        _let_park(w2)

        released_at = time.monotonic()
        dedup.mark_done("hash-1")
        w1.join(timeout=5)
        w2.join(timeout=5)

        assert not w1.is_alive() and not w2.is_alive()
        assert first["cleared"] is True
        assert second["cleared"] is True
        # One set, two waiters: the event is shared per key, so neither waiter
        # may be left to notice on a later tick.
        assert first["finished_at"] - released_at < TICK_SECONDS / 2
        assert second["finished_at"] - released_at < TICK_SECONDS / 2

    def test_waiting_on_a_never_registered_key_cannot_hang(self, monkeypatch):
        """The dedup key is derived from the video hash, so a waiter can name a
        key no holder ever registers (cache-hit runs never call mark_pending).
        That must return at once, not block out its whole budget."""
        clock = FakeClock()
        monkeypatch.setattr("core.dedup.time.time", clock)
        dedup = RequestDeduplicator(ttl_seconds=300)

        started = time.monotonic()
        cleared = dedup.wait_for_clear("never-registered", timeout=TICK_SECONDS)
        elapsed = time.monotonic() - started

        assert cleared is True
        assert elapsed < 0.5, f"unknown key blocked for {elapsed:.3f}s"

    def test_mark_done_on_an_unknown_key_is_a_no_op_and_wakes_nobody(self, monkeypatch):
        """run_analysis's finally calls mark_done even when _stage_prepare
        returned early on a cache hit, before any dedup key was registered."""
        clock = FakeClock()
        monkeypatch.setattr("core.dedup.time.time", clock)
        dedup = RequestDeduplicator(ttl_seconds=300)

        dedup.mark_done("")  # the empty key a cache-hit run actually holds
        dedup.mark_done("some-key-nobody-claimed")

        assert dedup.pending == {}
        assert dedup._events == {}

    def test_lost_wakeup_is_impossible_when_mark_done_races_subscription(self, monkeypatch):
        """Subscribe-and-observe must happen under one lock acquisition. If the
        waiter could observe 'pending', then block on a *fresh* event that
        mark_done had already set and released, it would wait out its full
        budget. Hammer the interleaving and require every waiter to wake fast."""
        clock = FakeClock()
        monkeypatch.setattr("core.dedup.time.time", clock)
        dedup = RequestDeduplicator(ttl_seconds=300)

        rounds = 60
        for i in range(rounds):
            key = f"hash-{i}"
            dedup.mark_pending(key)
            result: dict = {}
            waiter = _wait_in_thread(dedup, key, timeout=TICK_SECONDS, result=result)
            # Releaser starts concurrently with the waiter's subscription, so
            # across the rounds both interleavings get exercised: release-first
            # (waiter must re-check and return) and subscribe-first (waiter must
            # be woken by the set). The total for the round is what matters —
            # either path must finish well inside the 2s budget, and neither may
            # need a second tick.
            released_at = time.monotonic()
            releaser = threading.Thread(target=dedup.mark_done, args=(key,), daemon=True)
            releaser.start()
            waiter.join(timeout=5)
            releaser.join(timeout=5)

            assert not waiter.is_alive(), f"waiter stranded on round {i}"
            assert result["cleared"] is True, f"waiter saw a clear key on round {i}"
            assert result["finished_at"] - released_at < TICK_SECONDS / 2, (
                f"round {i} took {result['finished_at'] - released_at:.3f}s — poll "
                "tick, not the event"
            )

    def test_re_registered_key_gets_a_fresh_unset_event(self, monkeypatch):
        """After a release the event is dropped, so a new mark_pending must not
        hand a re-claimed key the already-set event — a waiter would then
        'wake' instantly while the key is genuinely held again."""
        clock = FakeClock()
        monkeypatch.setattr("core.dedup.time.time", clock)
        dedup = RequestDeduplicator(ttl_seconds=300)

        dedup.mark_pending("hash-1")
        dedup.mark_done("hash-1")
        dedup.mark_pending("hash-1")  # a second upload of the same video

        started = time.monotonic()
        cleared = dedup.wait_for_clear("hash-1", timeout=0.05)
        elapsed = time.monotonic() - started

        assert cleared is False, "a re-claimed key reported itself cleared"
        assert 0.04 <= elapsed < 1.0

    def test_events_are_released_so_the_map_cannot_grow_unbounded(self, monkeypatch):
        """_events must track pending exactly: one entry per live key, none
        left behind. A leak here is one Event per analysis, forever."""
        clock = FakeClock()
        monkeypatch.setattr("core.dedup.time.time", clock)
        dedup = RequestDeduplicator(ttl_seconds=300)

        for i in range(200):
            dedup.mark_pending(f"hash-{i}")
        assert len(dedup._events) == 200

        for i in range(200):
            dedup.mark_done(f"hash-{i}")
        assert dedup.pending == {}
        assert dedup._events == {}, "events outlived their keys"

        # And the sweep releases both maps too.
        for i in range(200, 400):
            dedup.mark_pending(f"hash-{i}")
        clock.now += 301
        dedup.is_pending("hash-200")
        assert dedup.pending == {}
        assert dedup._events == {}

    def test_events_never_outlive_pending_across_waits(self, monkeypatch):
        """A wait on a cleared key must not leave an event behind: an unknown
        key returns before subscribing, and a timed-out wait leaves exactly the
        one event its live key owns."""
        clock = FakeClock()
        monkeypatch.setattr("core.dedup.time.time", clock)
        dedup = RequestDeduplicator(ttl_seconds=300)

        dedup.wait_for_clear("unknown", timeout=0.01)
        assert dedup._events == {}

        dedup.mark_pending("hash-1")
        dedup.wait_for_clear("hash-1", timeout=0.01)
        assert set(dedup._events) == set(dedup.pending) == {"hash-1"}

    def test_concurrent_marks_and_releases_stay_consistent(self, monkeypatch):
        """mark_pending/mark_done from many threads must leave the two maps in
        agreement — the invariant wait_for_clear's correctness rests on."""
        clock = FakeClock()
        monkeypatch.setattr("core.dedup.time.time", clock)
        dedup = RequestDeduplicator(ttl_seconds=300)
        keys = [f"hash-{i}" for i in range(50)]
        errors: list[BaseException] = []

        def churn(key: str) -> None:
            try:
                for _ in range(40):
                    dedup.mark_pending(key)
                    dedup.wait_for_clear(key, timeout=0.001)
                    dedup.mark_done(key)
                    dedup.is_pending(key)
            except BaseException as exc:  # pragma: no cover - surfaced below
                errors.append(exc)

        threads = [threading.Thread(target=churn, args=(k,), daemon=True) for k in keys]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)

        assert errors == []
        assert not any(t.is_alive() for t in threads)
        assert set(dedup._events) == set(dedup.pending)
