from __future__ import annotations

import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.datastructures import UploadFile as StarletteUploadFile

from core.analyzer import run_analysis
from core.detector import detect_players
from core.errors import JobNotFoundError, NoPlayersDetectedError, VideoDecodeError
from core.jobs import create_job, get_job, start_cleanup_scheduler


load_dotenv()

TMP_DIR = (Path(__file__).resolve().parent / "tmp").resolve()
TMP_DIR.mkdir(parents=True, exist_ok=True)

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


async def _save_upload(upload: UploadFile) -> str:
    suffix = Path(upload.filename or "input.mp4").suffix.lower() or ".mp4"
    path = TMP_DIR / f"{uuid.uuid4().hex}{suffix}"
    with path.open("wb") as f:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
    await upload.close()
    return str(path)


def _validate_video_upload(upload: UploadFile | StarletteUploadFile | None) -> Optional[JSONResponse]:
    if upload is None:
        return _error_response(400, "INVALID_REQUEST", "Missing video upload")

    content_type = getattr(upload, "content_type", None) or ""
    if not content_type.startswith("video/"):
        return _error_response(422, "VIDEO_DECODE_FAILED", "Could not read this video file. Try MP4, MOV, or AVI format.")

    return None


def _session_video_path(session_token: str) -> tuple[Optional[str], Optional[JSONResponse]]:
    with sessions_lock:
        session = sessions.get(session_token)

    if not session:
        return None, _error_response(404, "SESSION_EXPIRED", "Session expired. Please upload your video again.")

    return str(session["video_path"]), None


@app.on_event("startup")
def on_startup() -> None:
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    start_cleanup_scheduler(interval_seconds=30 * 60)
    print("CoachAI Engine running on :8001")


@app.post("/scan")
async def scan(video: UploadFile | None = None) -> JSONResponse:
    validation_error = _validate_video_upload(video)
    if validation_error:
        return validation_error

    video_path = await _save_upload(video)
    try:
        players = detect_players(video_path)
    except NoPlayersDetectedError:
        return _error_response(
            422,
            "NO_PLAYERS_DETECTED",
            "No players detected clearly in this video. Try better lighting or a less crowded frame.",
        )
    except VideoDecodeError:
        return _error_response(
            422,
            "VIDEO_DECODE_FAILED",
            "Could not read this video file. Try MP4, MOV, or AVI format.",
        )

    session_token = str(uuid.uuid4())
    with sessions_lock:
        sessions[session_token] = {
            "video_path": video_path,
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
    video_path: Optional[str] = None

    if content_type.startswith("application/json"):
        try:
            payload = await request.json()
        except Exception:
            return _error_response(400, "INVALID_REQUEST", "Invalid JSON body")

        session_token = payload.get("session_token")
        player_index = _safe_int(payload.get("player_index"))
        model = str(payload.get("model") or "gemini-2.5-flash")

        if session_token:
            video_path, err = _session_video_path(session_token)
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
            video_path, err = _session_video_path(str(session_token))
            if err:
                return err
        else:
            maybe_video = form.get("video")
            if not isinstance(maybe_video, StarletteUploadFile):
                return _error_response(400, "INVALID_REQUEST", "Missing video upload")

            validation_error = _validate_video_upload(maybe_video)
            if validation_error:
                return validation_error

            video_path = await _save_upload(maybe_video)
    else:
        return _error_response(415, "INVALID_REQUEST", "Unsupported content type")

    # model is accepted by contract for forward-compatibility; current pipeline uses gemini-2.5-flash.
    _ = model

    if not video_path or not os.path.exists(video_path):
        return _error_response(404, "VIDEO_NOT_FOUND", "Video file not found for analysis")

    job_id = str(uuid.uuid4())
    create_job(job_id)

    threading.Thread(
        target=run_analysis,
        args=(job_id, video_path, player_index),
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
            "video_ready": bool(job.video_path),
            "error": job.error,
        },
    )


@app.get("/download/{job_id}")
def download(job_id: str):
    try:
        job = get_job(job_id)
    except JobNotFoundError:
        return _error_response(404, "JOB_NOT_FOUND", "Job not found")

    if not job.complete or not job.video_path or not os.path.exists(job.video_path):
        return _error_response(404, "VIDEO_NOT_FOUND", "Rendered video is not available")

    return FileResponse(
        job.video_path,
        media_type="video/mp4",
        filename=f"coachai_analysis_{job_id[:8]}.mp4",
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
