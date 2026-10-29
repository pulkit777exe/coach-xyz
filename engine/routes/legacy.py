"""The pre-event API kept for older server builds: blocking analyze, polled
status, and a plain download URL. New callers use `routes/jobs.py`."""

import asyncio

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from core import jobs, storage
from core.errors import invalid

from .files import serve
from .jobs import JobRequest, build_params

router = APIRouter()

LEGACY_STATE = {
    "prepare": ("scanning", 1, "Detecting Players", 15),
    "track": ("scanning", 1, "Detecting Players", 15),
    "candidates": ("analyzing", 3, "Analyzing Technique", 45),
    "judge": ("analyzing", 3, "Analyzing Technique", 45),
    "result": ("analyzing", 3, "Analyzing Technique", 45),
    "render": ("rendering", 5, "Rendering Video", 80),
}


def legacy_summary(result: dict) -> dict:
    summary = result["summary"]
    shots = []
    for event in result["events"]:
        measured = [m for m in event["measurements"] if m["score"] is not None]
        shots.append({
            "timestamp": event["t"],
            "event_type": event["type"],
            "form_score": event["score"] or 0,
            "feedback": event["feedback"],
            "result": event["result"],
            "key_observation": event["feedback"],
            "form_breakdown": {
                m["key"]: "good" if m["score"] >= 0.85 else "needs_work" if m["score"] >= 0.5 else "poor"
                for m in measured
            },
            "biomechanics": {
                "joint_angles": {m["metric"]: m["value"] for m in event["measurements"] if m["value"] is not None},
                "confidence": event["confidence"],
                "measured_at_timestamp": event["t"],
            },
            "weighted_scoring": {
                "composite_score": event["score"],
                "coverage": event["coverage"],
                "weighted_rationale": event["feedback"],
                "criteria": [
                    {
                        "criterion": m["key"],
                        "label": m["label"],
                        "measured_value": m["value"],
                        "unit": m["unit"],
                        "ideal_range": m["ideal"],
                        "acceptable_range": m["acceptable"],
                        "score": m["score"],
                        "weight": m["weight"],
                        "source": m["source"],
                        "rationale": m["note"],
                    }
                    for m in event["measurements"]
                ],
            },
            "injury_risk": None,
        })
    return {
        "sport": result["sport"],
        "player_name": "Player",
        "session_date": None,
        "form_score": summary["average_score"] or 0,
        "overall_rating": summary["rating"] or "N/A",
        "top_tips": summary["focus_areas"],
        "summary": summary["text"],
        "strengths": summary["strengths"],
        "priority_drill": summary["priority_drill"],
        "shot_events": shots,
        "success_rate_percent": summary["success_rate"] or 0,
        "average_form_score": summary["average_score"] or 0,
        "total_events": summary["events"],
        "findings": result["findings"],
        "quality": result["quality"],
        "needs_review": result["needs_review"],
        "provenance": result["provenance"],
        "angle": result["angle"],
        "recommended_angles": result["recommended_angles"],
    }


def _legacy_state(job: dict) -> tuple[str, int, str, int]:
    state = job["state"]
    if state == "queued":
        return "uploading", 0, "Uploading", 0
    if state == "completed":
        return "completed", 6, "Complete", 100
    if state in ("failed", "cancelled"):
        return "failed", -1, "Failed", 0
    legacy, stage, name, floor = LEGACY_STATE.get(job["stage"], LEGACY_STATE["prepare"])
    return legacy, stage, name, max(floor, job["progress"])


@router.post("/analyze")
async def analyze(request: Request):
    """Blocking form of POST /jobs for callers that still wait on the response."""
    body = await request.json()
    job_id = body.get("engine_job_id")
    if not job_id:
        raise invalid("engine_job_id required")
    req = JobRequest(
        job_id=job_id,
        session_token=body.get("session_token"),
        video_key=body.get("video_key"),
        angle=body.get("requested_angle") or body.get("angle"),
        player_index=body.get("player_index"),
        sport=body.get("sport"),
        render=body.get("render", True),
    )
    if jobs.get(job_id) is None:
        jobs.create(job_id, build_params(req))
    elif jobs.get(job_id)["state"] in ("failed", "cancelled"):
        jobs.retry(job_id)
    while True:
        job = jobs.require(job_id)
        if job["state"] == "completed":
            return {"ok": True}
        if job["state"] == "failed":
            return JSONResponse(job["error"], status_code=500)
        if job["state"] == "cancelled":
            return JSONResponse(
                {"code": "CANCELLED", "message": "Job cancelled.", "layer": "engine", "retryable": False},
                status_code=409,
            )
        await asyncio.sleep(0.5)


@router.get("/status/{job_id}")
def status(job_id: str):
    job = jobs.require(job_id)
    state, stage, name, pct = _legacy_state(job)
    err = job["error"] or (
        {"message": "Job cancelled.", "code": "CANCELLED", "retryable": False}
        if job["state"] == "cancelled"
        else None
    )
    return {
        "job_id": job_id,
        "state": state,
        "stage": stage,
        "stage_name": name,
        "progress": pct,
        "complete": job["state"] in ("completed", "failed", "cancelled"),
        "summary": legacy_summary(jobs.load_result(job_id)) if job["state"] == "completed" else None,
        "video_ready": storage.backend().exists(storage.result_key(job_id, "analysis.mp4")),
        "error": err["message"] if err else None,
        "error_code": err["code"] if err else None,
        "retryable": err["retryable"] if err else True,
    }


@router.get("/download/{job_id}")
def download(job_id: str):
    jobs.require(job_id)
    return serve(job_id, "analysis.mp4")
