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
    """

    def __init__(self, ttl_seconds: float = 300):
        self.pending: dict[str, PendingRequest] = {}
        self.ttl = ttl_seconds
        self._lock = threading.Lock()

    def mark_pending(self, video_hash: str) -> None:
        """Mark a video hash as being analyzed."""
        with self._lock:
            self.pending[video_hash] = PendingRequest(started_at=time.time())

    def mark_done(self, video_hash: str) -> None:
        """Remove a video hash from pending after analysis completes."""
        with self._lock:
            self.pending.pop(video_hash, None)

    def is_pending(self, video_hash: str) -> bool:
        """Check if a video hash is currently being analyzed."""
        with self._lock:
            self._cleanup_locked()
            return video_hash in self.pending

    def _cleanup_locked(self) -> None:
        """Remove expired entries. Must be called with _lock held."""
        now = time.time()
        expired = [k for k, v in self.pending.items() if now - v.started_at > self.ttl]
        for k in expired:
            del self.pending[k]


# Global singleton
deduplicator = RequestDeduplicator()
