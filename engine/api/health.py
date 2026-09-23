"""api/health.py — Shallow and deep health probes (+ backend availability)."""

from __future__ import annotations

import time

from fastapi import APIRouter

from api.analyze import analysis_executor

router = APIRouter()

START_TIME = time.time()

# Module-level MediaPipe availability check (used by /health/deep and the
# startup log in main's lifespan)
try:
    from core.pose_backend import pose_backend_name, pose_backend_available
except Exception:
    def pose_backend_available() -> bool:
        return False

    def pose_backend_name() -> str:
        return "unavailable"


@router.get("/health")
def health():
    """Shallow — always fast, always 200 if process is alive."""
    return {"status": "ok", "uptime": round(time.time() - START_TIME, 1)}


@router.get("/health/deep")
def health_deep():
    """Deep — check Redis + MediaPipe for real system status."""
    from core.jobs import redis as jobs_redis

    # Check Redis
    redis_ok = False
    redis_latency = 0
    if jobs_redis is not None:
        try:
            t = time.time()
            jobs_redis.ping()
            redis_ok = True
            redis_latency = round((time.time() - t) * 1000)
        except Exception:
            pass

    # Check MediaPipe
    mp_ok = pose_backend_available()

    # Check executor queue depth
    executor_depth = analysis_executor._work_queue.qsize() if hasattr(analysis_executor, '_work_queue') else -1

    status = "healthy" if (redis_ok and mp_ok) else "degraded"

    return {
        "status": status,
        "checks": {
            "redis": {"ok": redis_ok, "latency_ms": redis_latency},
            "mediapipe": {"ok": mp_ok},
            "executor": {"queue_depth": executor_depth, "max_workers": getattr(analysis_executor, '_max_workers', -1)},
        },
        "uptime": round(time.time() - START_TIME, 1),
    }
