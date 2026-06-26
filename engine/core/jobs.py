from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass, field
from typing import Optional

from upstash_redis import Redis

from core.errors import EngineError, JobNotFoundError


redis = Redis(
    url=os.environ["UPSTASH_REDIS_REST_URL"],
    token=os.environ["UPSTASH_REDIS_REST_TOKEN"],
)

JOB_TTL = 7200  # 2 hours
KEY = "coachai:job:"

STAGE_NAMES = {
    0: "Uploading",
    1: "Extracting Frames",
    2: "Detecting Players",
    3: "Analyzing Technique",
    4: "Generating Feedback",
    5: "Rendering Video",
}

# Keep STAGES alias for backward compat in analyzer.py
STAGES = STAGE_NAMES


@dataclass
class JobStatus:
    job_id: str
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


def create_job(job_id: str) -> JobStatus:
    job = JobStatus(job_id=job_id)
    redis.set(f"{KEY}{job_id}", job.to_redis(), ex=JOB_TTL)
    return job


def update_job(job_id: str, **kwargs) -> None:
    raw = redis.get(f"{KEY}{job_id}")
    if not raw:
        raise JobNotFoundError()
    job = JobStatus.from_redis(raw)
    for k, v in kwargs.items():
        if hasattr(job, k):
            setattr(job, k, v)
    # Auto-set stage_name from stage number
    if "stage" in kwargs:
        job.stage_name = STAGE_NAMES.get(kwargs["stage"], job.stage_name)
    redis.set(f"{KEY}{job_id}", job.to_redis(), ex=JOB_TTL)


def get_job(job_id: str) -> JobStatus:
    raw = redis.get(f"{KEY}{job_id}")
    if not raw:
        raise JobNotFoundError()
    return JobStatus.from_redis(raw)


def fail_job(job_id: str, error: EngineError) -> None:
    """Mark a job as failed with structured error info."""
    try:
        update_job(
            job_id,
            complete=True,
            error=error.message,
            error_code=error.code,
            retryable=error.retryable,
        )
    except Exception:
        pass  # best-effort — job may have already expired


def register_job_input(job_id: str, video_path: str) -> None:
    """No-op: kept for backward compat with analyzer.py calls."""
    pass
