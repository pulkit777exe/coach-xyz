import asyncio
import mimetypes
import re
import uuid

from fastapi import APIRouter, Header, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, StreamingResponse
from pydantic import BaseModel, Field

from core import db, events, jobs, sessions, sports, storage
from core.errors import EngineError, invalid, not_found

router = APIRouter()
RAW_KEY = re.compile(r"^raw/[A-Za-z0-9_@.|-]+/[a-z0-9_-]+/[a-f0-9]{32}\.mp4$")
FILE_NAME = re.compile(r"^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)?$")


class JobRequest(BaseModel):
    job_id: str | None = Field(default=None, max_length=80, pattern=r"^[A-Za-z0-9_.:-]+$")
    session_token: str | None = None
    video_key: str | None = None
    sha256: str | None = None
    angle: str | None = None
    player_index: int | None = None
    sport: str | None = None
    render: bool = True
    callback_url: str | None = None
    meta: dict = Field(default_factory=dict)


def _params(req: JobRequest) -> dict:
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
    job = jobs.create(job_id, _params(req), req.callback_url or "")
    return jobs.view(job)


@router.get("/jobs/{job_id}")
def get_job(job_id: str):
    return jobs.view(jobs.require(job_id))


@router.get("/jobs/{job_id}/events")
async def job_events(job_id: str, request: Request, after: int = 0, last_event_id: str | None = Header(default=None)):
    jobs.require(job_id)
    start = int(last_event_id) if last_event_id and last_event_id.isdigit() else after
    over = lambda: jobs.get(job_id) is None or jobs.get(job_id)["state"] not in jobs.ACTIVE  # noqa: E731
    return StreamingResponse(events.follow(job_id, start, disconnected=request.is_disconnected, finished=over),
                             media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/jobs/{job_id}/result")
def job_result(job_id: str):
    jobs.require(job_id)
    return jobs.load_result(job_id)


def _serve(job_id: str, name: str):
    if not FILE_NAME.match(name) or ".." in name:
        raise invalid("bad file name")
    store = storage.backend()
    try:
        kind, target = store.serve(storage.result_key(job_id, name))
    except FileNotFoundError:
        raise not_found("FILE_NOT_FOUND", "File not available.") from None
    if kind == "url":
        return RedirectResponse(target, status_code=302)
    media = mimetypes.guess_type(name)[0] or "application/octet-stream"
    return FileResponse(target, media_type=media, headers={"Content-Disposition": f'inline; filename="{name.split("/")[-1]}"'})


@router.get("/jobs/{job_id}/files/{name:path}")
def job_file(job_id: str, name: str):
    jobs.require(job_id)
    return _serve(job_id, name)


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


# -- compatibility with the pre-event API ------------------------------------------------------

LEGACY_STATE = {"prepare": ("scanning", 1, "Detecting Players", 15), "track": ("scanning", 1, "Detecting Players", 15),
                "candidates": ("analyzing", 3, "Analyzing Technique", 45), "judge": ("analyzing", 3, "Analyzing Technique", 45),
                "result": ("analyzing", 3, "Analyzing Technique", 45), "render": ("rendering", 5, "Rendering Video", 80)}


def legacy_summary(r: dict) -> dict:
    s = r["summary"]
    shots = []
    for e in r["events"]:
        rows = [m for m in e["measurements"] if m["score"] is not None]
        shots.append({
            "timestamp": e["t"], "event_type": e["type"], "form_score": e["score"] or 0, "feedback": e["feedback"],
            "result": e["result"], "key_observation": e["feedback"],
            "form_breakdown": {m["key"]: "good" if m["score"] >= 0.85 else "needs_work" if m["score"] >= 0.5 else "poor"
                               for m in rows},
            "biomechanics": {"joint_angles": {m["metric"]: m["value"] for m in e["measurements"] if m["value"] is not None},
                             "confidence": e["confidence"], "measured_at_timestamp": e["t"]},
            "weighted_scoring": {"composite_score": e["score"], "coverage": e["coverage"], "weighted_rationale": e["feedback"],
                                 "criteria": [{"criterion": m["key"], "label": m["label"], "measured_value": m["value"],
                                               "unit": m["unit"], "ideal_range": m["ideal"], "acceptable_range": m["acceptable"],
                                               "score": m["score"], "weight": m["weight"], "source": m["source"],
                                               "rationale": m["note"]} for m in e["measurements"]]},
            "injury_risk": None,
        })
    return {
        "sport": r["sport"], "player_name": "Player", "session_date": None, "form_score": s["average_score"] or 0,
        "overall_rating": s["rating"] or "N/A", "top_tips": s["focus_areas"], "summary": s["text"],
        "strengths": s["strengths"], "priority_drill": s["priority_drill"], "shot_events": shots,
        "success_rate_percent": s["success_rate"] or 0, "average_form_score": s["average_score"] or 0,
        "total_events": s["events"], "findings": r["findings"], "quality": r["quality"],
        "needs_review": r["needs_review"], "provenance": r["provenance"], "angle": r["angle"],
        "recommended_angles": r["recommended_angles"],
    }


def _legacy_state(job: dict) -> tuple[str, int, str, int]:
    s = job["state"]
    if s == "queued":
        return "uploading", 0, "Uploading", 0
    if s == "completed":
        return "completed", 6, "Complete", 100
    if s in ("failed", "cancelled"):
        return "failed", -1, "Failed", 0
    state, stage, name, floor = LEGACY_STATE.get(job["stage"], LEGACY_STATE["prepare"])
    return state, stage, name, max(floor, job["progress"])


@router.post("/analyze")
async def analyze(request: Request):
    """Blocking form of POST /jobs for callers that still wait on the response."""
    body = await request.json()
    job_id = body.get("engine_job_id")
    if not job_id:
        raise invalid("engine_job_id required")
    req = JobRequest(job_id=job_id, session_token=body.get("session_token"), video_key=body.get("video_key"),
                     angle=body.get("requested_angle") or body.get("angle"), player_index=body.get("player_index"),
                     sport=body.get("sport"), render=body.get("render", True))
    if jobs.get(job_id) is None:
        jobs.create(job_id, _params(req))
    elif jobs.get(job_id)["state"] in ("failed", "cancelled"):
        jobs.retry(job_id)
    while True:
        job = jobs.require(job_id)
        if job["state"] == "completed":
            return {"ok": True}
        if job["state"] == "failed":
            return JSONResponse(job["error"], status_code=500)
        if job["state"] == "cancelled":
            return JSONResponse({"code": "CANCELLED", "message": "Job cancelled.", "layer": "engine",
                                 "retryable": False}, status_code=409)
        await asyncio.sleep(0.5)


@router.get("/status/{job_id}")
def status(job_id: str):
    job = jobs.require(job_id)
    state, stage, name, pct = _legacy_state(job)
    err = job["error"] or ({"message": "Job cancelled.", "code": "CANCELLED", "retryable": False}
                           if job["state"] == "cancelled" else None)
    summary = None
    if job["state"] == "completed":
        summary = legacy_summary(jobs.load_result(job_id))
    return {
        "job_id": job_id, "state": state, "stage": stage, "stage_name": name, "progress": pct,
        "complete": job["state"] in ("completed", "failed", "cancelled"), "summary": summary,
        "video_ready": storage.backend().exists(storage.result_key(job_id, "analysis.mp4")),
        "error": err["message"] if err else None, "error_code": err["code"] if err else None,
        "retryable": err["retryable"] if err else True,
    }


@router.get("/download/{job_id}")
def download(job_id: str):
    jobs.require(job_id)
    return _serve(job_id, "analysis.mp4")
