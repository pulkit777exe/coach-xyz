"""api/jobs.py — Job state queries: status, failure marking, and download."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse

from api.errors import error_response
from core import storage
from core.errors import EngineError, JobNotFoundError
from core.jobs import fail_job, get_job

# Job state queries are registered before chat/report; /download is its own
# router so main can keep the app's route order identical to the original
# monolith (download was declared last).
router = APIRouter()
download_router = APIRouter()


@router.get("/status/{job_id}")
def status(job_id: str) -> JSONResponse:
    try:
        job = get_job(job_id)
    except JobNotFoundError:
        return error_response(404, "JOB_NOT_FOUND", "Job not found")

    return JSONResponse(
        status_code=200,
        content={
            "job_id": job.job_id,
            "state": job.state,
            "stage": job.stage,
            "stage_name": job.stage_name,
            "progress": job.progress,
            "complete": job.complete,
            "summary": job.summary,
            "video_ready": bool(job.video_key),
            "error": job.error,
            "error_code": job.error_code,
            "retryable": job.retryable,
        },
    )


@router.post("/fail/{job_id}")
async def fail(job_id: str, request: Request) -> JSONResponse:
    """Mark a job as failed. Called by the server when queue retries are exhausted.

    Accepts optional body with { code, message, retryable } to preserve
    the actual error details from the engine instead of overwriting them.
    """
    # Parse optional body for error details
    code = "ANALYSIS_FAILED"
    message = "Analysis failed after retries."
    retryable = False

    try:
        content_type = (request.headers.get("content-type") or "").lower()
        if content_type.startswith("application/json"):
            body = await request.json()
            if isinstance(body, dict):
                code = body.get("code", code)
                message = body.get("message", message)
                retryable = body.get("retryable", retryable)
    except Exception:
        pass  # Use defaults

    try:
        error = EngineError(
            code=code,
            message=message,
            retryable=retryable,
        )
        fail_job(job_id, error)
        return JSONResponse(status_code=200, content={"ok": True})
    except JobNotFoundError:
        return error_response(404, "JOB_NOT_FOUND", "Job not found")


@download_router.delete("/download/{job_id}")
def delete_result(job_id: str):
    """Delete a job's rendered result video. Called by the server when the
    analysis is deleted or pruned, so storage does not accumulate orphaned
    mp4s. A missing job reads as already-gone (the server treats 404 as
    success); only a storage failure is a 500."""
    try:
        job = get_job(job_id)
    except JobNotFoundError:
        return error_response(404, "JOB_NOT_FOUND", "Job not found")

    if not job.video_key:
        return JSONResponse(status_code=200, content={"ok": True, "deleted": False})

    try:
        storage.delete_file(job.video_key)
    except Exception:
        return error_response(500, "STORAGE_ERROR", "Could not delete result video")
    return JSONResponse(status_code=200, content={"ok": True, "deleted": True})


@download_router.get("/download/{job_id}")
def download(job_id: str):
    try:
        job = get_job(job_id)
    except JobNotFoundError:
        return error_response(404, "JOB_NOT_FOUND", "Job not found")

    if job.state != "completed" or not job.video_key:
        return error_response(404, "VIDEO_NOT_FOUND", "Rendered video is not available")

    if storage.is_local_backend():
        local_video_path = storage.get_local_file_path(job.video_key)
        if not local_video_path:
            return error_response(404, "VIDEO_EXPIRED", "This video is no longer available. The server may have restarted. Please upload your video again.")

        return FileResponse(
            path=local_video_path,
            media_type="video/mp4",
            filename="coachai_analysis.mp4",
            headers={"Content-Disposition": 'inline; filename="coachai_analysis.mp4"'},
        )

    try:
        url = storage.presigned_download(job.video_key)
    except Exception:
        return error_response(404, "VIDEO_EXPIRED", "This video is no longer available. Please upload your video again.")
    return RedirectResponse(url=url, status_code=302)
