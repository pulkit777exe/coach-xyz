from __future__ import annotations

import threading
import time
from dataclasses import dataclass


@dataclass
class PendingRequest:
    started_at: float
    count: int = 1


class RequestDeduplicator:
    """
    Prevent duplicate analyses for the same video.

    If the same video hash is submitted twice within a short window,
    the second request waits for the first instead of creating a duplicate job.

    Waiting is event-driven. Every pending key owns a ``threading.Event`` that is
    set the moment the key leaves ``pending``, so a waiter blocked in
    :meth:`wait_for_clear` is released by the completion it is waiting for
    instead of by the next poll tick. Two invariants make that safe:

    * every removal from ``pending`` goes through :meth:`_release_locked`,
      which pops the key *and* sets its event — so no code path can drop a key
      without waking the waiters subscribed to it;
    * ``_events`` is a superset of ``pending``'s keys at all times, so a waiter
      always finds the event for a key it just observed as pending.

    :meth:`wait_for_clear` still bounds every wait with a timeout and re-checks
    under the lock when it expires, so the sweep cadence (and any missed set)
    degrades to polling rather than to a hang.
    """

    def __init__(self, ttl_seconds: float = 300):
        self.pending: dict[str, PendingRequest] = {}
        self.ttl = ttl_seconds
        self._lock = threading.Lock()
        # Keyed in lockstep with `pending`: created by mark_pending/waiters,
        # popped by _release_locked. Never grows past `pending`.
        self._events: dict[str, threading.Event] = {}

    # ── internals (all require _lock held) ────────────────────────────────────

    def _event_locked(self, video_hash: str) -> threading.Event:
        """Get-or-create the wake-up event for a key. Requires _lock."""
        event = self._events.get(video_hash)
        if event is None:
            event = threading.Event()
            self._events[video_hash] = event
        return event

    def _release_locked(self, video_hash: str) -> None:
        """Drop a pending key and wake every waiter on it. Requires _lock.

        The single terminal path for a key: mark_done() and the TTL sweep both
        route through here, which is what guarantees a waiter cannot be left
        blocked on an event nobody is going to set.
        """
        self.pending.pop(video_hash, None)
        event = self._events.pop(video_hash, None)
        if event is not None:
            event.set()

    def _cleanup_locked(self) -> None:
        """Remove expired entries. Must be called with _lock held."""
        now = time.time()
        expired = [k for k, v in self.pending.items() if now - v.started_at > self.ttl]
        for k in expired:
            self._release_locked(k)

    # ── public API ────────────────────────────────────────────────────────────

    def mark_pending(self, video_hash: str) -> None:
        """Mark a video hash as being analyzed."""
        with self._lock:
            self.pending[video_hash] = PendingRequest(started_at=time.time())
            # Re-subscribing any existing waiter: a duplicate mark keeps the one
            # entry (and its unset event), so a waiter still blocks rather than
            # spinning on an event left set by an earlier release.
            self._event_locked(video_hash)

    def mark_done(self, video_hash: str) -> None:
        """Remove a video hash from pending after analysis completes.

        Terminal path for the holder. Safe on an unknown key (a waiter that
        already saw the key clear, or the empty key from a cache-hit run that
        never registered one): there is no event to set and nothing to pop.
        """
        with self._lock:
            self._release_locked(video_hash)

    def is_pending(self, video_hash: str) -> bool:
        """Check if a video hash is currently being analyzed."""
        with self._lock:
            self._cleanup_locked()
            return video_hash in self.pending

    def wait_for_clear(self, video_hash: str, timeout: float) -> bool:
        """Block until `video_hash` is no longer pending, or `timeout` elapses.

        Returns True as soon as the key is observed cleared (including when it
        was never registered at all — an unknown key can never block), and
        False when the timeout expired first. A False return is *not* a claim
        that the key is still held: the caller re-checks with is_pending(),
        because a new analysis may have claimed the key in between.

        `timeout` is a bound, not the wake-up mechanism. The holder sets the
        event on every terminal path; the timeout only bounds how long a waiter
        sleeps if some path ever failed to set it.
        """
        deadline = time.monotonic() + max(0.0, timeout)
        # Subscribe and observe presence under one acquisition. A mark_done
        # landing between the two would otherwise leave this waiter holding a
        # fresh, unset event for a key nobody will ever release again.
        with self._lock:
            self._cleanup_locked()
            if video_hash not in self.pending:
                return True
            event = self._event_locked(video_hash)

        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            if event.wait(remaining):
                return True
            # Timed out. Re-check under the lock: the key may have been swept
            # by another thread's is_pending between the wait expiring and now.
            with self._lock:
                if video_hash not in self.pending:
                    return True


# Global singleton
deduplicator = RequestDeduplicator()
