from __future__ import annotations

import os
import threading
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict

from core.errors import JobNotFoundError


STAGES = {
    0: "Uploading",
    1: "Extracting Frames",
    2: "Detecting Players",
    3: "Analyzing Technique",
    4: "Generating Feedback",
    5: "Rendering Video",
}

MAX_JOB_AGE_SECONDS = 30 * 60
TMP_DIR = (Path(__file__).resolve().parent.parent / "tmp").resolve()


@dataclass
class JobStatus:
    job_id: str
    stage: int
    stage_name: str
    progress: int
    complete: bool
    error: str | None
    summary: dict | None
    video_path: str | None
    created_at: float


_jobs: Dict[str, JobStatus] = {}
_job_input_paths: Dict[str, str] = {}
_jobs_lock = threading.Lock()
_cleanup_timer: threading.Timer | None = None


def create_job(job_id: str) -> JobStatus:
    job = JobStatus(
        job_id=job_id,
        stage=0,
        stage_name=STAGES[0],
        progress=0,
        complete=False,
        error=None,
        summary=None,
        video_path=None,
        created_at=time.time(),
    )
    with _jobs_lock:
        _jobs[job_id] = job
    return job


def register_job_input(job_id: str, video_path: str) -> None:
    with _jobs_lock:
        if job_id in _jobs:
            _job_input_paths[job_id] = str(Path(video_path).resolve())


def update_job(job_id: str, **kwargs: Any) -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            raise JobNotFoundError()
        for key, value in kwargs.items():
            if hasattr(job, key):
                setattr(job, key, value)


def get_job(job_id: str) -> JobStatus:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            raise JobNotFoundError()
        return JobStatus(**asdict(job))


def _collect_protected_paths() -> set[str]:
    protected = set()
    for job_id, job in _jobs.items():
        if not job.complete:
            if job.video_path:
                protected.add(str(Path(job.video_path).resolve()))
            input_path = _job_input_paths.get(job_id)
            if input_path:
                protected.add(str(Path(input_path).resolve()))
    return protected


def cleanup_old_jobs() -> None:
    now = time.time()
    threshold = now - MAX_JOB_AGE_SECONDS

    with _jobs_lock:
        removable = [
            job_id
            for job_id, job in _jobs.items()
            if job.complete and job.created_at < threshold
        ]

        for job_id in removable:
            job = _jobs.pop(job_id)
            _job_input_paths.pop(job_id, None)
            for path in [job.video_path]:
                if not path:
                    continue
                try:
                    resolved = Path(path).resolve()
                    if resolved.exists() and resolved.is_file() and TMP_DIR in resolved.parents:
                        resolved.unlink(missing_ok=True)
                except Exception:
                    continue

        protected_paths = _collect_protected_paths()

    TMP_DIR.mkdir(parents=True, exist_ok=True)
    for entry in TMP_DIR.glob("*"):
        if not entry.is_file():
            continue
        try:
            resolved = str(entry.resolve())
            if resolved in protected_paths:
                continue
            if entry.stat().st_mtime < threshold:
                entry.unlink(missing_ok=True)
        except Exception:
            continue


def _schedule_next_cleanup(interval_seconds: int) -> None:
    global _cleanup_timer

    def _run() -> None:
        try:
            cleanup_old_jobs()
        finally:
            _schedule_next_cleanup(interval_seconds)

    timer = threading.Timer(interval_seconds, _run)
    timer.daemon = True
    timer.start()
    _cleanup_timer = timer


def start_cleanup_scheduler(interval_seconds: int = 30 * 60) -> None:
    global _cleanup_timer
    cleanup_old_jobs()
    with _jobs_lock:
        if _cleanup_timer is not None:
            return
    _schedule_next_cleanup(interval_seconds)
