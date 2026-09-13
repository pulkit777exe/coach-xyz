"""Tests for core/dedup.py — the in-flight analysis deduplicator."""

from core.dedup import RequestDeduplicator


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


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
