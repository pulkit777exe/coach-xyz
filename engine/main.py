from __future__ import annotations

import os
import threading
import time
import uuid
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from starlette.datastructures import UploadFile as StarletteUploadFile

from core import storage
from core.analyzer import run_analysis
from core.detector import detect_players
from core.errors import JobNotFoundError, NoPlayersDetectedError, VideoDecodeError
from core.jobs import create_job, get_job, start_cleanup_scheduler
from core.pose_backend import pose_backend_available, pose_backend_name


load_dotenv()

sessions: Dict[str, Dict[str, Any]] = {}
sessions_lock = threading.Lock()


app = FastAPI(title="CoachAI Engine", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _error_response(status_code: int, error: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": error, "message": message})


def _safe_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except Exception:
        return None


def _validate_video_upload(upload: UploadFile | StarletteUploadFile | None) -> Optional[JSONResponse]:
    if upload is None:
        return _error_response(400, "INVALID_REQUEST", "Missing video upload")

    content_type = getattr(upload, "content_type", None) or ""
    if not content_type.startswith("video/"):
        return _error_response(422, "VIDEO_DECODE_FAILED", "Could not read this video file. Try MP4, MOV, or AVI format.")

    return None


def _session_video_key(session_token: str) -> tuple[Optional[str], Optional[JSONResponse]]:
    with sessions_lock:
        session = sessions.get(session_token)

    if not session:
        return None, _error_response(404, "SESSION_EXPIRED", "Session expired. Please upload your video again.")

    video_key = session.get("video_key")
    if not video_key:
        return None, _error_response(404, "SESSION_EXPIRED", "Session expired. Please upload your video again.")

    return str(video_key), None


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse(status_code=200, content={"status": "healthy"})


@app.on_event("startup")
def on_startup() -> None:
    start_cleanup_scheduler(interval_seconds=30 * 60)
    print("CoachAI Engine running on :8001")
    backend = pose_backend_name()
    if not pose_backend_available():
        print(
            "WARNING: mediapipe Pose backend unavailable. "
            "Install a mediapipe build with either `mp.solutions.pose` or `mediapipe.tasks` support."
        )
    else:
        print(f"MediaPipe pose backend: {backend}")


@app.post("/scan")
async def scan(video: UploadFile | None = None) -> JSONResponse:
    validation_error = _validate_video_upload(video)
    if validation_error:
        return validation_error

    file_bytes = await video.read()
    await video.close()

    r2_key = f"uploads/{uuid.uuid4().hex}.mp4"
    storage.upload_video(file_bytes, r2_key)

    local_path = storage.download_video_to_tmp(r2_key)
    try:
        players = detect_players(local_path)
    except NoPlayersDetectedError:
        storage.delete_file(r2_key)
        return _error_response(
            422,
            "NO_PLAYERS_DETECTED",
            "No players detected clearly in this video. Try better lighting or a less crowded frame.",
        )
    except VideoDecodeError as exc:
        storage.delete_file(r2_key)
        if "MediaPipe Pose backend unavailable" in exc.message:
            return _error_response(
                503,
                "ENGINE_UNAVAILABLE",
                "MediaPipe runtime is unavailable on the engine. Reinstall dependencies and restart the engine.",
            )
        return _error_response(
            422,
            "VIDEO_DECODE_FAILED",
            "Could not read this video file. Try MP4, MOV, or AVI format.",
        )
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
    content_type = (request.headers.get("content-type") or "").lower()

    session_token: Optional[str] = None
    player_index: Optional[int] = None
    model = "gemini-2.5-flash"
    video_key: Optional[str] = None

    if content_type.startswith("application/json"):
        try:
            payload = await request.json()
        except Exception:
            return _error_response(400, "INVALID_REQUEST", "Invalid JSON body")

        session_token = payload.get("session_token")
        player_index = _safe_int(payload.get("player_index"))
        model = str(payload.get("model") or "gemini-2.5-flash")

        if session_token:
            video_key, err = _session_video_key(session_token)
            if err:
                return err
        else:
            return _error_response(
                400,
                "INVALID_REQUEST",
                "When session_token is null, send multipart/form-data with a video file.",
            )

    elif content_type.startswith("multipart/form-data"):
        form = await request.form()
        session_token = form.get("session_token")
        player_index = _safe_int(form.get("player_index"))
        model = str(form.get("model") or "gemini-2.5-flash")

        if session_token:
            video_key, err = _session_video_key(str(session_token))
            if err:
                return err
        else:
            maybe_video = form.get("video")
            if not isinstance(maybe_video, StarletteUploadFile):
                return _error_response(400, "INVALID_REQUEST", "Missing video upload")

            validation_error = _validate_video_upload(maybe_video)
            if validation_error:
                return validation_error

            file_bytes = await maybe_video.read()
            await maybe_video.close()
            video_key = f"uploads/{uuid.uuid4().hex}.mp4"
            storage.upload_video(file_bytes, video_key)
    else:
        return _error_response(415, "INVALID_REQUEST", "Unsupported content type")

    # model is accepted by contract for forward-compatibility; current pipeline uses gemini-2.5-flash.
    _ = model

    if not video_key:
        return _error_response(404, "VIDEO_NOT_FOUND", "Video not found for analysis")

    job_id = str(uuid.uuid4())
    create_job(job_id)

    threading.Thread(
        target=run_analysis,
        args=(job_id, video_key, player_index),
        daemon=True,
    ).start()

    return JSONResponse(status_code=200, content={"job_id": job_id})


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
            "stage": job.stage,
            "stage_name": job.stage_name,
            "progress": job.progress,
            "complete": job.complete,
            "summary": job.summary,
            "video_ready": bool(job.video_key),
            "error": job.error,
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
