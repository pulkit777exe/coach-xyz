from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import asdict, dataclass, field
from typing import Optional

from upstash_redis import Redis

from core.errors import EngineError, JobNotFoundError, InvalidStateTransition, RedisUnavailableError

_redis_url = os.environ.get("UPSTASH_REDIS_REST_URL")
_redis_token = os.environ.get("UPSTASH_REDIS_REST_TOKEN")

redis = Redis(url=_redis_url, token=_redis_token) if _redis_url and _redis_token else None

JOB_TTL = 7200  # 2 hours
KEY = "coachai:job:"

# ── Per-job Lock Management ──────────────────────────────────────────────────

_locks: dict[str, threading.Lock] = {}
_locks_lock = threading.Lock()  # Protects _locks dict itself

def _get_job_lock(job_id: str) -> threading.Lock:
    """Get or create a per-job lock. Thread-safe."""
    with _locks_lock:
        # Evict old locks if dict grows too large (cap at 1000)
        if len(_locks) > 1000:
            # Keep only the requested lock and clear the rest
            lock = _locks.get(job_id)
            _locks.clear()
            if lock is not None:
                _locks[job_id] = lock
        if job_id not in _locks:
            _locks[job_id] = threading.Lock()
        return _locks[job_id]

# ── Explicit Pipeline States ──────────────────────────────────────────────────
# Each state maps to a stage number and progress percentage.
# States flow: uploading → scanning → player_selection → analyzing → rendering → completed
# On error: any state can transition to "failed"

# Single source of the forward pipeline order. Callers that need to walk a job
# toward completion import STATE_FLOW instead of re-literalizing the order.
# NOTE: this order is a wire contract shared with the server and web layers
# (see their ENGINE_PIPELINE_STATES constants + the pipeline contract tests).
STATE_FLOW = ("uploading", "scanning", "player_selection", "analyzing", "rendering", "completed")

PIPELINE_STATES = {
    "uploading": {"stage": 0, "progress": 0, "stage_name": "Uploading"},
    "scanning": {"stage": 1, "progress": 15, "stage_name": "Detecting Players"},
    "player_selection": {"stage": 2, "progress": 25, "stage_name": "Waiting for Selection"},
    "analyzing": {"stage": 3, "progress": 45, "stage_name": "Analyzing Technique"},
    "rendering": {"stage": 5, "progress": 80, "stage_name": "Rendering Video"},
    "completed": {"stage": 6, "progress": 100, "stage_name": "Complete"},
    "failed": {"stage": -1, "progress": 0, "stage_name": "Failed"},
}

# Valid state transitions: from_state → set of allowed next states
VALID_TRANSITIONS = {
    "uploading": {"scanning", "failed"},
    "scanning": {"player_selection", "analyzing", "failed"},  # analyzing if single player
    "player_selection": {"analyzing", "failed"},
    "analyzing": {"rendering", "completed", "failed"},  # completed if no render needed
    "rendering": {"completed", "failed"},
    "completed": set(),  # terminal state
    "failed": {"scanning"},  # retry resets to scanning
}

# Keep STAGES alias for backward compat in analyzer.py
STAGES = {v["stage"]: v["stage_name"] for k, v in PIPELINE_STATES.items() if v["stage"] >= 0}


@dataclass
class JobStatus:
    job_id: str
    state: str = "uploading"
    stage: int = 0
    stage_name: str = "Uploading"
    progress: int = 0
    complete: bool = False
    error: Optional[str] = None
    error_code: Optional[str] = None
    retryable: bool = True
    summary: Optional[dict] = None
    video_key: Optional[str] = None
    video_path: Optional[str] = None
    created_at: float = field(default_factory=time.time)

    def to_redis(self) -> str:
        return json.dumps(asdict(self))

    @classmethod
    def from_redis(cls, data: str) -> "JobStatus":
        parsed = json.loads(data) if isinstance(data, str) else data
        # Filter out any unexpected keys
        valid_fields = {f.name for f in cls.__dataclass_fields__.values()}
        filtered = {k: v for k, v in parsed.items() if k in valid_fields}
        return cls(**filtered)


def _require_redis():
    if redis is None:
        raise RedisUnavailableError()


def create_job(job_id: str, initial_state: str = "uploading", video_key: str | None = None) -> JobStatus:
    """Create a new job with an explicit initial state."""
    _require_redis()
    state_info = PIPELINE_STATES.get(initial_state, PIPELINE_STATES["uploading"])
    job = JobStatus(
        job_id=job_id,
        state=initial_state,
        stage=state_info["stage"],
        stage_name=state_info["stage_name"],
        progress=state_info["progress"],
        video_key=video_key,
    )
    redis.set(f"{KEY}{job_id}", job.to_redis(), ex=JOB_TTL)
    return job


def transition_job(job_id: str, new_state: str, **kwargs) -> None:
    """
    Validate and apply a state transition.
    Uses a per-job lock to prevent race conditions.
    Raises InvalidStateTransition if the transition is not allowed.
    """
    _require_redis()

    job_lock = _get_job_lock(job_id)

    with job_lock:
        raw = redis.get(f"{KEY}{job_id}")
        if not raw:
            raise JobNotFoundError()

        job = JobStatus.from_redis(raw)

        # Validate transition
        allowed = VALID_TRANSITIONS.get(job.state, set())
        if new_state not in allowed:
            raise InvalidStateTransition(job.state, new_state)

        # Apply state
        state_info = PIPELINE_STATES[new_state]
        job.state = new_state
        job.stage = state_info["stage"]
        job.stage_name = state_info["stage_name"]
        job.progress = state_info["progress"]

        # Apply any additional kwargs
        for k, v in kwargs.items():
            if hasattr(job, k):
                setattr(job, k, v)

        # Terminal states mark the job complete. Retrying from failed must clear
        # stale terminal/error fields so clients keep polling the live retry.
        if new_state == "completed":
            job.complete = True
        elif new_state == "failed":
            job.complete = True
        else:
            job.complete = False
            job.error = None
            job.error_code = None
            job.retryable = True

        redis.set(f"{KEY}{job_id}", job.to_redis(), ex=JOB_TTL)


def update_job(job_id: str, **kwargs) -> None:
    """
    Update job fields directly without state transition validation.
    Use transition_job() for state changes.
    Uses per-job lock to prevent race with transition_job/fail_job.
    """
    _require_redis()

    job_lock = _get_job_lock(job_id)

    with job_lock:
        raw = redis.get(f"{KEY}{job_id}")
        if not raw:
            raise JobNotFoundError()
        job = JobStatus.from_redis(raw)
        for k, v in kwargs.items():
            if hasattr(job, k):
                setattr(job, k, v)
        # Auto-set stage_name from stage number if stage is being updated
        if "stage" in kwargs:
            job.stage_name = STAGES.get(kwargs["stage"], job.stage_name)
        redis.set(f"{KEY}{job_id}", job.to_redis(), ex=JOB_TTL)


def get_job(job_id: str) -> JobStatus:
    _require_redis()
    job_lock = _get_job_lock(job_id)
    with job_lock:
        raw = redis.get(f"{KEY}{job_id}")
        if not raw:
            raise JobNotFoundError()
        return JobStatus.from_redis(raw)


def fail_job(job_id: str, error: EngineError) -> None:
    """Mark a job as failed with structured error info.

    Raises the original exception if Redis operations fail,
    so the caller can handle it appropriately.
    """
    _require_redis()
    job_lock = _get_job_lock(job_id)

    with job_lock:
        raw = redis.get(f"{KEY}{job_id}")
        if not raw:
            return
        job = JobStatus.from_redis(raw)
        # Don't revert completed jobs
        if job.state == "completed":
            return
        job.state = "failed"
        job.stage = -1
        job.stage_name = "Failed"
        job.complete = True
        job.error = error.message
        job.error_code = error.code
        job.retryable = error.retryable
        # Clear the video reference so a failed job can no longer serve
        # (or leak) the rendered/raw video via the download route.
        job.video_key = None
        job.video_path = None
        redis.set(f"{KEY}{job_id}", job.to_redis(), ex=JOB_TTL)
