from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional


@dataclass
class PendingRequest:
    future: asyncio.Future
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

    def _cleanup(self) -> None:
        now = time.time()
        expired = [k for k, v in self.pending.items() if now - v.started_at > self.ttl]
        for k in expired:
            fut = self.pending[k].future
            if not fut.done():
                fut.cancel()
            del self.pending[k]

    async def get_or_create(self, video_hash: str, create_func: Callable[[], Any]) -> Any:
        """
        Return cached/in-progress result or create a new analysis.

        If an analysis for the same video_hash is already running,
        the caller awaits the existing future instead of starting a new job.
        """
        self._cleanup()

        if video_hash in self.pending:
            pending = self.pending[video_hash]
            pending.count += 1
            try:
                return await asyncio.wait_for(pending.future, timeout=300)
            except asyncio.TimeoutError:
                del self.pending[video_hash]
            except asyncio.CancelledError:
                del self.pending[video_hash]

        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self.pending[video_hash] = PendingRequest(future=future, started_at=time.time())

        try:
            result = await create_func()
            if not future.cancelled():
                future.set_result(result)
            return result
        except Exception as e:
            if not future.cancelled():
                future.set_exception(e)
            raise
        finally:
            loop.call_later(60, lambda: self.pending.pop(video_hash, None))


# Global singleton
deduplicator = RequestDeduplicator()
