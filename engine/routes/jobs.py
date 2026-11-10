"""Job API: create, inspect, stream events, cancel/retry, delete.

Legacy `/analyze`, `/status` and `/download` compatibility lives in
`routes/legacy.py`; artefact serving lives in `routes/files.py`.
"""

import uuid

from fastapi import APIRouter, Header, Request

from core import db, events, jobs, storage
from core.errors import EngineError
from core.job_params import RAW_KEY, JobRequest, build_params

from .files import serve

router = APIRouter()

__all__ = ["RAW_KEY", "JobRequest", "build_params", "router"]


@router.post("/jobs", status_code=202)
def create_job(req: JobRequest):
    job_id = req.job_id or uuid.uuid4().hex
    if (existing := jobs.get(job_id)) is not None:
        return jobs.view(existing)
    return jobs.view(jobs.create(job_id, build_params(req), req.callback_url or ""))


@router.get("/jobs/{job_id}")
def get_job(job_id: str):
    return jobs.view(jobs.require(job_id))


@router.get("/jobs/{job_id}/events")
async def job_events(
    job_id: str,
    request: Request,
    after: int = 0,
    last_event_id: str | None = Header(default=None),
):
    jobs.require(job_id)
    start = int(last_event_id) if last_event_id and last_event_id.isdigit() else after

    def over() -> bool:
        job = jobs.get(job_id)
        return job is None or job["state"] not in jobs.ACTIVE

    return events.sse_stream(
        events.follow(
            job_id, start, disconnected=request.is_disconnected, finished=over
        )
    )


@router.get("/jobs/{job_id}/result")
def job_result(job_id: str):
    jobs.require(job_id)
    return jobs.load_result(job_id)


@router.get("/jobs/{job_id}/files/{name:path}")
def job_file(job_id: str, name: str):
    jobs.require(job_id)
    return serve(job_id, name)


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    return jobs.view(jobs.cancel(job_id))


@router.post("/jobs/{job_id}/retry", status_code=202)
def retry_job(job_id: str):
    return jobs.view(jobs.retry(job_id))


@router.delete("/jobs/{job_id}")
def delete_job(job_id: str):
    job = jobs.require(job_id)
    if job["state"] in jobs.ACTIVE:
        raise EngineError(
            "JOB_ACTIVE", "Cancel the job before deleting it.", status=409
        )
    storage.backend().delete_prefix(f"results/{job_id}")
    db.run("DELETE FROM events WHERE stream=?", (job_id,))
    db.run("DELETE FROM jobs WHERE id=?", (job_id,))
    return {"ok": True}
