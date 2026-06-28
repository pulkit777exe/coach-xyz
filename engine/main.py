from __future__ import annotations

import logging
import os
import time
import traceback
import threading
import uuid
from typing import Any, Dict, Optional, Union

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from starlette.datastructures import UploadFile as StarletteUploadFile

from core import storage
from core.analyzer import run_analysis
from core.detector import detect_players
from core.errors import (
    EngineError,
    JobNotFoundError,
    NoPlayersDetectedError,
    VideoDecodeError,
)
from core.jobs import create_job, get_job, fail_job, update_job, transition_job
from core.pose_backend import pose_backend_available, pose_backend_name

sessions: Dict[str, Dict[str, Any]] = {}
sessions_lock = threading.Lock()

START_TIME = time.time()

app = FastAPI(title="CoachAI Engine", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Global Exception Handlers ────────────────────────────────────────────────


@app.exception_handler(EngineError)
async def engine_error_handler(request: Request, exc: EngineError):
    logging.error(f"{exc.code}: {exc.message}")
    status = 422 if exc.retryable else 500
    return JSONResponse(status_code=status, content=exc.to_dict())


@app.exception_handler(Exception)
async def generic_error_handler(request: Request, exc: Exception):
    logging.error(traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={
            "code": "INTERNAL_ERROR",
            "message": "An unexpected error occurred.",
            "layer": "engine",
            "retryable": True,
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=400,
        content={
            "code": "INVALID_REQUEST",
            "message": "Invalid request format.",
            "layer": "engine",
            "retryable": False,
        },
    )


# ── Helpers ──────────────────────────────────────────────────────────────────


def _error_response(status_code: int, error: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "code": error,
            "message": message,
            "layer": "engine",
            "retryable": status_code < 500,
        },
    )


def _safe_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except Exception:
        return None


def _validate_video_upload(upload: Union[UploadFile, StarletteUploadFile, None]) -> Optional[JSONResponse]:
    if upload is None:
        return _error_response(400, "INVALID_REQUEST", "Missing video upload")

    content_type = getattr(upload, "content_type", None) or ""
    if not content_type.startswith("video/"):
        return _error_response(
            422,
            "VIDEO_DECODE_FAILED",
            "Could not read this video file. Try MP4, MOV, or AVI format.",
        )

    return None


def _session_video_path(session_token: str) -> tuple[Optional[str], Optional[JSONResponse]]:
    with sessions_lock:
        session = sessions.get(session_token)

    if not session:
        return None, _error_response(
            404, "SESSION_EXPIRED", "Session expired. Please upload your video again."
        )

    video_key = session.get("video_key")
    if not video_key:
        return None, _error_response(
            404, "SESSION_EXPIRED", "Session expired. Please upload your video again."
        )

    return str(video_key), None


# ── Health Endpoints ─────────────────────────────────────────────────────────


@app.get("/health")
def health():
    """Shallow — always fast, always 200 if process is alive."""
    return {"status": "ok", "uptime": round(time.time() - START_TIME, 1)}


@app.get("/health/deep")
def health_deep():
    """Deep — check Redis + MediaPipe for real system status."""
    from core.jobs import redis as jobs_redis

    # Check Redis
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

    # Check MediaPipe
    mp_ok = pose_backend_available()

    status = "healthy" if (redis_ok and mp_ok) else "degraded"

    return {
        "status": status,
        "checks": {
            "redis": {"ok": redis_ok, "latency_ms": redis_latency},
            "mediapipe": {"ok": mp_ok},
        },
        "uptime": round(time.time() - START_TIME, 1),
    }


# ── Startup ──────────────────────────────────────────────────────────────────


@app.on_event("startup")
def on_startup() -> None:
    print("CoachAI Engine running on :8001")
    backend = pose_backend_name()
    if not pose_backend_available():
        print(
            "WARNING: mediapipe Pose backend unavailable. "
            "Install a mediapipe build with either `mp.solutions.pose` or `mediapipe.tasks` support."
        )
    else:
        print(f"MediaPipe pose backend: {backend}")


# ── Routes ───────────────────────────────────────────────────────────────────


@app.post("/scan")
async def scan(video: UploadFile) -> JSONResponse:
    logging.error(f"[SCAN] Received upload: filename={video.filename}, content_type={video.content_type}, size={video.size}")
    validation_error = _validate_video_upload(video)
    if validation_error:
        logging.error(f"[SCAN] Validation failed: {validation_error.body}")
        return validation_error

    file_bytes = await video.read()
    await video.close()
    logging.error(f"[SCAN] Read {len(file_bytes)} bytes from upload")

    r2_key = f"uploads/{uuid.uuid4().hex}.mp4"
    storage.upload_video(file_bytes, r2_key)

    local_path = storage.download_video_to_tmp(r2_key)
    logging.error(f"[SCAN] Saved to {local_path} ({os.path.getsize(local_path)} bytes)")
    try:
        players = detect_players(local_path)
    except NoPlayersDetectedError:
        storage.delete_file(r2_key)
        raise  # caught by global handler
    except VideoDecodeError as exc:
        storage.delete_file(r2_key)
        if "MediaPipe Pose backend unavailable" in exc.message:
            return _error_response(
                503,
                "ENGINE_UNAVAILABLE",
                "MediaPipe runtime is unavailable on the engine.",
            )
        raise  # caught by global handler
    finally:
        try:
            os.unlink(local_path)
        except FileNotFoundError:
            pass

    session_token = str(uuid.uuid4())
    with sessions_lock:
        sessions[session_token] = {
            "video_key": r2_key,
            "players": players,
            "created_at": time.time(),
        }

    response_players = [
        {
            "player_index": p["player_index"],
            "confidence": p["confidence"],
            "crop_base64": p["crop_base64"],
        }
        for p in players
    ]

    return JSONResponse(
        status_code=200,
        content={
            "session_token": session_token,
            "player_count": len(response_players),
            "players": response_players,
        },
    )


@app.post("/analyze")
async def analyze(request: Request) -> JSONResponse:
    """
    Called by BullMQ worker (server), NOT by end users directly.
    Runs analysis SYNCHRONOUSLY — BullMQ handles concurrency.
    """
    content_type = (request.headers.get("content-type") or "").lower()

    if not content_type.startswith("application/json"):
        return _error_response(415, "INVALID_REQUEST", "JSON required")

    try:
        payload = await request.json()
    except Exception:
        return _error_response(400, "INVALID_REQUEST", "Invalid JSON body")

    engine_job_id = payload.get("engine_job_id")
    session_token = payload.get("session_token")
    player_index = _safe_int(payload.get("player_index"))

    if not engine_job_id:
        return _error_response(400, "MISSING_JOB_ID", "engine_job_id required")

    # Verify job exists in Redis
    try:
        get_job(engine_job_id)
    except JobNotFoundError:
        return _error_response(404, "JOB_NOT_FOUND", "Job not found")

    # Get video key from session
    if not session_token:
        return _error_response(400, "INVALID_REQUEST", "session_token required")

    video_key, err = _session_video_path(session_token)
    if err:
        fail_job(engine_job_id, JobNotFoundError())
        return err

    # Run SYNCHRONOUSLY — BullMQ worker is waiting for this response
    # Do NOT use threading.Thread
    try:
        run_analysis(engine_job_id, video_key, player_index)
        return JSONResponse({"ok": True})
    except EngineError as e:
        fail_job(engine_job_id, e)
        return JSONResponse(status_code=500, content=e.to_dict())
    except Exception as e:
        logging.error(traceback.format_exc())
        err = EngineError(
            code="INTERNAL_ERROR",
            message="Unexpected analysis error.",
            retryable=True,
        )
        fail_job(engine_job_id, err)
        return JSONResponse(status_code=500, content=err.to_dict())


@app.get("/status/{job_id}")
def status(job_id: str) -> JSONResponse:
    try:
        job = get_job(job_id)
    except JobNotFoundError:
        return _error_response(404, "JOB_NOT_FOUND", "Job not found")

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


@app.get("/download/{job_id}")
def download(job_id: str):
    try:
        job = get_job(job_id)
    except JobNotFoundError:
        return _error_response(404, "JOB_NOT_FOUND", "Job not found")

    if not job.complete or not job.video_key:
        return _error_response(404, "VIDEO_NOT_FOUND", "Rendered video is not available")

    if storage.is_local_backend():
        local_video_path = storage.get_local_file_path(job.video_key)
        if not local_video_path:
            return _error_response(404, "VIDEO_NOT_FOUND", "Rendered video is not available")

        return FileResponse(
            path=local_video_path,
            media_type="video/mp4",
            filename="coachai_analysis.mp4",
        )

    url = storage.get_download_url(job.video_key)
    return RedirectResponse(url=url, status_code=302)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
