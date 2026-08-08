from __future__ import annotations

import time

from fastapi import APIRouter

from core.jobs import redis as jobs_redis, PIPELINE_STATES, VALID_TRANSITIONS

from .sessions import _analysis_executor

router = APIRouter()



try:
    from core.pose_backend import pose_backend_name, pose_backend_available
except Exception:
    def pose_backend_available() -> bool:
        return False
    def pose_backend_name() -> str:
        return "unavailable"

START_TIME = time.time()


@router.get("/health")
def health():
    return {"status": "ok", "uptime": round(time.time() - START_TIME, 1)}


@router.get("/pipeline-schema")
def pipeline_schema():
    return {
        "states": {k: v for k, v in PIPELINE_STATES.items()},
        "transitions": {k: sorted(v) for k, v in VALID_TRANSITIONS.items()},
        "terminal_states": sorted(k for k, v in VALID_TRANSITIONS.items() if not v),
    }


@router.get("/health/deep")
def health_deep():
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

    mp_ok = pose_backend_available()

    executor_depth = _analysis_executor._work_queue.qsize() if hasattr(_analysis_executor, '_work_queue') else -1

    status = "healthy" if (redis_ok and mp_ok) else "degraded"

    return {
        "status": status,
        "checks": {
            "redis": {"ok": redis_ok, "latency_ms": redis_latency},
            "mediapipe": {"ok": mp_ok},
            "executor": {"queue_depth": executor_depth, "max_workers": getattr(_analysis_executor, '_max_workers', -1)},
        },
        "uptime": round(time.time() - START_TIME, 1),
    }
