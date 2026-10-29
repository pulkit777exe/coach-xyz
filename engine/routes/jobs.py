"""Job API: create, inspect, stream events, cancel/retry, delete.

Legacy `/analyze`, `/status` and `/download` compatibility lives in
`routes/legacy.py`; artefact serving lives in `routes/files.py`.
"""

import re
import uuid

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel, Field

from core import db, events, jobs, sessions, sports, storage
from core.errors import EngineError, invalid

from .files import serve

router = APIRouter()
RAW_KEY = re.compile(r"^raw/[A-Za-z0-9_@.|-]+/[a-z0-9_-]+/[a-f0-9]{32}\.mp4$")


class JobRequest(BaseModel):
    job_id: str | None = Field(default=None, max_length=80, pattern=r"^[A-Za-z0-9_.:-]+$")
    session_token: str | None = Field(default=None, max_length=80)
    video_key: str | None = None
    sha256: str | None = None
    angle: str | None = None
    player_index: int | None = None
    sport: str | None = None
    render: bool = True
    callback_url: str | None = None
    meta: dict = Field(default_factory=dict)


def build_params(req: JobRequest) -> dict:
    """Resolve a request into the immutable params the pipeline runs on."""
    angle = sessions.angle_label(req.angle)
    sport = (req.sport or "").lower()
    if sport and sport not in sports.KNOWN:
        raise invalid(f"sport must be one of {', '.join(sports.KNOWN)}")
    params = {"angle": angle, "sport": sport, "render": req.render, "meta": req.meta, "player": None}
    if req.session_token:
        found = sessions.angle(req.session_token, angle)
        if not found:
            raise EngineError("SESSION_EXPIRED", "Session expired. Please upload your video again.", status=404)
        params["angle"], entry = found
        params.update(video_key=entry["video_key"], sha256=entry.get("sha256"))
        if req.player_index is not None:
            params["player"] = next((p for p in entry["players"] if p["player_index"] == req.player_index), None)
            if params["player"] is None:
                raise invalid("player_index was not found in this scan")
    elif req.video_key and RAW_KEY.match(req.video_key):
        params.update(video_key=req.video_key, sha256=req.sha256)
    else:
        raise invalid("session_token or an upload key is required")
    return params


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
async def job_events(job_id: str, request: Request, after: int = 0, last_event_id: str | None = Header(default=None)):
    jobs.require(job_id)
    start = int(last_event_id) if last_event_id and last_event_id.isdigit() else after

    def over() -> bool:
        job = jobs.get(job_id)
        return job is None or job["state"] not in jobs.ACTIVE

    return events.sse_stream(
        events.follow(job_id, start, disconnected=request.is_disconnected, finished=over)
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
        raise EngineError("JOB_ACTIVE", "Cancel the job before deleting it.", status=409)
    storage.backend().delete_prefix(f"results/{job_id}")
    db.run("DELETE FROM events WHERE stream=?", (job_id,))
    db.run("DELETE FROM jobs WHERE id=?", (job_id,))
    return {"ok": True}
