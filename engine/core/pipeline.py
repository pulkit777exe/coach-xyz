# UNUSED — see ARCHITECTURE.md §10 (Known Gaps, Tech Debt, and Contradictions)
# This module is dead code. It provides per-stage Redis caching but is never imported.
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any, Callable, Optional
from enum import Enum

from upstash_redis import Redis as UpstashRedis


class StageStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CACHED = "cached"


@dataclass
class PipelineStage:
    name: str
    status: StageStatus
    result: Any = None
    error: Optional[str] = None
    duration_ms: Optional[float] = None
    cached: bool = False


class AnalysisPipeline:
    """
    Staged pipeline with Redis caching.

    Pipeline: scan → detect → analyze → render
    Each stage checks cache before computing.
    """

    CACHE_TTL = 3600 * 24  # 24 hours
    CACHE_PREFIX = "coachai:stage:"

    def __init__(self, video_hash: str, session_token: str, redis: UpstashRedis):
        self.video_hash = video_hash
        self.session_token = session_token
        self.redis = redis
        self.stages: list[PipelineStage] = []

    def _cache_key(self, stage: str, params: str = "") -> str:
        """Generate cache key from video hash + stage + params."""
        raw = f"{self.video_hash}:{stage}:{params}"
        return f"{self.CACHE_PREFIX}{hashlib.sha256(raw.encode()).hexdigest()[:16]}"

    def get_cached(self, stage: str, params: str = "") -> Optional[Any]:
        """Check Redis cache for stage result."""
        key = self._cache_key(stage, params)
        cached = self.redis.get(key)
        if cached:
            try:
                return json.loads(cached)
            except Exception:
                return None
        return None

    def set_cached(self, stage: str, result: Any, params: str = "") -> None:
        """Store stage result in Redis cache."""
        key = self._cache_key(stage, params)
        self.redis.set(key, json.dumps(result, default=str), ex=self.CACHE_TTL)

    def run_stage(
        self,
        name: str,
        func: Callable[..., Any],
        *args: Any,
        cache_params: str = "",
        **kwargs: Any,
    ) -> Any:
        """Run a stage with caching."""
        stage = PipelineStage(name=name, status=StageStatus.RUNNING)
        self.stages.append(stage)

        # Check cache first
        cached = self.get_cached(name, cache_params)
        if cached is not None:
            stage.status = StageStatus.CACHED
            stage.result = cached
            stage.cached = True
            return cached

        # Run stage
        start = time.monotonic()
        try:
            result = func(*args, **kwargs)
            stage.result = result
            stage.status = StageStatus.COMPLETED

            # Cache result
            self.set_cached(name, result, cache_params)

            return result
        except Exception as e:
            stage.status = StageStatus.FAILED
            stage.error = str(e)
            raise
        finally:
            stage.duration_ms = (time.monotonic() - start) * 1000

    def get_stats(self) -> list[dict]:
        """Get pipeline statistics."""
        return [
            {
                "name": s.name,
                "status": s.status.value,
                "duration_ms": s.duration_ms,
                "cached": s.cached,
                "error": s.error,
            }
            for s in self.stages
        ]
