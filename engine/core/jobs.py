"""Jobs: queued -> running -> completed | failed | cancelled.

State lives in SQLite, so a restart picks up where it left off. Every change
is announced as an event (see events.py); the server never has to poll.
"""

import json
import logging
import shutil
import time
from concurrent.futures import ThreadPoolExecutor

from . import config, db, events, storage
from .errors import Cancelled, EngineError, not_found

log = logging.getLogger("engine.jobs")
_pool: ThreadPoolExecutor | None = None
ACTIVE = ("queued", "running")


def pool() -> ThreadPoolExecutor:
    global _pool
    if _pool is None:
        _pool = ThreadPoolExecutor(max_workers=config.settings.workers, thread_name_prefix="job")
    return _pool


def shutdown() -> None:
    global _pool
    if _pool is not None:
        _pool.shutdown(wait=False, cancel_futures=True)
        _pool = None


def get(job_id: str) -> dict | None:
    row = db.one("SELECT * FROM jobs WHERE id=?", (job_id,))
    if not row:
        return None
    row["params"] = json.loads(row["params"])
    row["degraded"] = json.loads(row["degraded"])
    row["error"] = json.loads(row["error"]) if row["error"] else None
    return row


def require(job_id: str) -> dict:
    job = get(job_id)
    if job is None:
        raise not_found("JOB_NOT_FOUND", "Job not found.")
    return job


def view(job: dict) -> dict:
    keys = ("id", "state", "stage", "progress", "error", "degraded", "attempts", "created_at", "started_at", "finished_at")
    out = {k: job[k] for k in keys}
    out["meta"] = job["params"].get("meta", {})
    return out


def create(job_id: str, params: dict, callback_url: str = "") -> dict:
    """Idempotent: creating an existing id returns the existing job."""
    existing = get(job_id)
    if existing:
        return existing
    db.run("INSERT INTO jobs(id, state, params, callback_url, created_at) VALUES (?,?,?,?,?)",
           (job_id, "queued", db.dumps(params), callback_url, time.time()))
    events.emit(job_id, "job.queued", {"meta": params.get("meta", {})})
    submit(job_id)
    return get(job_id)


def submit(job_id: str) -> None:
    pool().submit(_run, job_id)


def set_stage(job_id: str, stage: str, progress: int) -> None:
    db.run("UPDATE jobs SET stage=?, progress=? WHERE id=?", (stage, progress, job_id))


def degrade(job_id: str, component: str, reason: str) -> None:
    job = get(job_id)
    if job and component not in job["degraded"]:
        db.run("UPDATE jobs SET degraded=? WHERE id=?", (db.dumps([*job["degraded"], component]), job_id))
        events.emit(job_id, "job.degraded", {"component": component, "reason": reason})


def is_cancelled(job_id: str) -> bool:
    row = db.one("SELECT cancel FROM jobs WHERE id=?", (job_id,))
    return bool(row and row["cancel"])


def cancel(job_id: str) -> dict:
    job = require(job_id)
    if job["state"] == "queued":
        _finish(job_id, "cancelled", event=("job.cancelled", {}))
    elif job["state"] == "running":
        db.run("UPDATE jobs SET cancel=1 WHERE id=?", (job_id,))
    return require(job_id)


def retry(job_id: str) -> dict:
    job = require(job_id)
    if job["state"] not in ("failed", "cancelled"):
        return job
    db.run("UPDATE jobs SET state='queued', error=NULL, cancel=0, progress=0, stage='', finished_at=NULL, "
           "degraded='[]' WHERE id=?", (job_id,))
    events.emit(job_id, "job.queued", {"retry": True})
    submit(job_id)
    return require(job_id)


def _finish(job_id: str, state: str, error: dict | None = None, event: tuple[str, dict] | None = None) -> None:
    """Set the final state and announce it in one transaction, so a reader never sees one without the other."""
    with db.transaction():
        db.run("UPDATE jobs SET state=?, error=?, finished_at=? WHERE id=?",
               (state, db.dumps(error) if error else None, time.time(), job_id))
        if event:
            events.emit(job_id, *event)


def _run(job_id: str) -> None:
    from . import pipeline

    job = get(job_id)
    if not job or job["state"] != "queued":
        return
    started = time.time()
    db.run("UPDATE jobs SET state='running', started_at=?, attempts=attempts+1 WHERE id=?", (started, job_id))
    events.emit(job_id, "job.started", {"attempt": job["attempts"] + 1})
    try:
        headline = pipeline.run(job_id, job["params"])
        db.run("UPDATE jobs SET progress=100 WHERE id=?", (job_id,))
        done = {"duration_ms": int((time.time() - started) * 1000), "degraded": get(job_id)["degraded"],
                "summary": headline}
        _finish(job_id, "completed", event=("job.completed", done))
    except Cancelled:
        _finish(job_id, "cancelled", event=("job.cancelled", {}))
    except EngineError as exc:
        log.warning("job %s failed: %s %s", job_id, exc.code, exc.message)
        _finish(job_id, "failed", exc.to_dict(), ("job.failed", exc.to_dict()))
    except Exception:
        log.exception("job %s crashed", job_id)
        err = EngineError("INTERNAL_ERROR", "Unexpected analysis error.", retryable=True, status=500).to_dict()
        _finish(job_id, "failed", err, ("job.failed", err))
    finally:
        shutil.rmtree(config.settings.data_dir / "work" / job_id, ignore_errors=True)


def recover() -> int:
    """Re-queue jobs a previous process left unfinished."""
    stale = db.rows("SELECT id FROM jobs WHERE state IN ('queued','running') ORDER BY created_at")
    for row in stale:
        db.run("UPDATE jobs SET state='queued' WHERE id=?", (row["id"],))
        submit(row["id"])
    return len(stale)


def purge() -> int:
    """Delete finished jobs, their events and stored results once past the retention window."""
    cutoff = time.time() - config.settings.result_ttl_s
    store = storage.backend()
    old = db.rows("SELECT id FROM jobs WHERE finished_at IS NOT NULL AND finished_at < ?", (cutoff,))
    for row in old:
        store.delete_prefix(f"results/{row['id']}")
        db.run("DELETE FROM events WHERE stream=?", (row["id"],))
        db.run("DELETE FROM jobs WHERE id=?", (row["id"],))
    db.run("DELETE FROM events WHERE stream LIKE 'scan:%' AND ts < ?", (cutoff,))
    return len(old)


def load_result(job_id: str) -> dict:
    try:
        with storage.backend().local_copy(storage.result_key(job_id, "result.json")) as path:
            return json.loads(open(path, encoding="utf-8").read())
    except FileNotFoundError as exc:
        raise not_found("RESULT_NOT_FOUND", "No result available for this job.") from exc
