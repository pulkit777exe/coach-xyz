from __future__ import annotations

import asyncio
import glob
import json
import logging
import os
import tempfile
import time
import traceback
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional, Union

from dotenv import load_dotenv

load_dotenv()

# Initialize Sentry (must be early in lifecycle)
import sentry_sdk

sentry_sdk.init(
    dsn=os.environ.get("SENTRY_DSN"),
    send_default_pii=True,
    default_integrations=False,
)

# Chunk size for streaming uploads (8MB)
CHUNK_SIZE = 8 * 1024 * 1024

# Session management constants (memory optimization)
SESSION_TTL = 7200  # 2 hours (aligned with job TTL)
MAX_SESSIONS = 10  # Max concurrent sessions
SESSION_EVICTION_INTERVAL = 300  # Run eviction every 5 minutes

# ── Validate Required Environment Variables ──────────────────────────────────
_required_env_vars = ["GEMINI_API_KEY"]
_missing_env_vars = [k for k in _required_env_vars if not os.environ.get(k)]
if _missing_env_vars:
    logging.error(f"Missing required environment variables: {', '.join(_missing_env_vars)}")
    raise SystemExit(1)

from fastapi import FastAPI, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from starlette.datastructures import UploadFile as StarletteUploadFile

try:
    from fastapi.responses import ORJSONResponse
    _default_response_class = ORJSONResponse
except ImportError:
    _default_response_class = JSONResponse

from core import storage
from core.errors import (
    EngineError,
    JobNotFoundError,
    NoPlayersDetectedError,
    VideoDecodeError,
    VideoExpiredError,
)
from core.jobs import create_job, get_job, fail_job, update_job, transition_job

sessions: Dict[str, Dict[str, Any]] = {}
sessions_lock = threading.Lock()

# Bounded executor for async analysis (memory optimization)
_analysis_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="analysis")

START_TIME = time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print("CoachAI Engine running on :8001")
    try:
        from core.pose_backend import pose_backend_name, pose_backend_available
        backend = pose_backend_name()
        if not pose_backend_available():
            print(
                "WARNING: mediapipe Pose backend unavailable. "
                "Install a mediapipe build with either `mp.solutions.pose` or `mediapipe.tasks` support."
            )
        else:
            print(f"MediaPipe pose backend: {backend}")
    except Exception as e:
        print(f"WARNING: Could not initialize MediaPipe: {e}")

    # Start background session eviction task
    async def session_eviction_loop():
        while True:
            await asyncio.sleep(SESSION_EVICTION_INTERVAL)
            _evict_old_sessions()

    eviction_task = asyncio.create_task(session_eviction_loop())
    print(f"Session eviction task started (interval: {SESSION_EVICTION_INTERVAL}s)")

    yield

    # Shutdown
    eviction_task.cancel()
    try:
        await eviction_task
    except asyncio.CancelledError:
        pass

    logging.info("CoachAI Engine shutting down")
    storage_dir = os.environ.get("LOCAL_STORAGE_DIR", "./tmp/storage")
    if os.path.exists(storage_dir):
        now = time.time()
        for f in glob.glob(os.path.join(storage_dir, "*")):
            try:
                if os.path.isfile(f) and now - os.path.getmtime(f) > 3600:
                    os.unlink(f)
                    logging.info(f"[SHUTDOWN] Cleaned up orphaned file: {f}")
            except Exception:
                pass


app = FastAPI(title="CoachAI Engine", version="0.2.0", lifespan=lifespan, default_response_class=_default_response_class)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("SERVER_URL", "http://localhost:8000")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request Timing Middleware ────────────────────────────────────────────────


@app.middleware("http")
async def timing_middleware(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Response-Time"] = f"{duration_ms:.1f}ms"
    if duration_ms > 1000:
        logging.warning(
            json.dumps({
                "type": "slow_request",
                "method": request.method,
                "path": request.url.path,
                "duration_ms": round(duration_ms, 1),
            })
        )
    return response


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


def _evict_old_sessions() -> None:
    """Evict sessions older than SESSION_TTL and enforce MAX_SESSIONS limit."""
    now = time.time()
    with sessions_lock:
        # Remove expired sessions
        expired = [sid for sid, s in sessions.items()
                   if now - s.get("created_at", 0) > SESSION_TTL]
        for sid in expired:
            sessions.pop(sid, None)
        
        # Enforce max sessions limit (remove oldest first)
        while len(sessions) > MAX_SESSIONS:
            oldest_sid = min(sessions, key=lambda s: sessions[s].get("created_at", 0))
            sessions.pop(oldest_sid, None)


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


# ── Routes ───────────────────────────────────────────────────────────────────


@app.post("/scan")
async def scan(video: UploadFile) -> JSONResponse:
    logging.info(f"[SCAN] Received upload: filename={video.filename}, content_type={video.content_type}, size={video.size}")
    validation_error = _validate_video_upload(video)
    if validation_error:
        logging.info(f"[SCAN] Validation failed: {validation_error.body}")
        return validation_error

    # Stream upload to storage (memory-efficient for large files)
    r2_key = f"uploads/{uuid.uuid4().hex}.mp4"
    logging.info(f"[SCAN] Streaming upload to storage: {r2_key}")

    # Always stream to disk (memory optimization: remove 10MB threshold)
    fd, temp_path = tempfile.mkstemp(suffix=".mp4")
    os.close(fd)
    try:
        with open(temp_path, "wb") as f:
            while True:
                chunk = await video.read(CHUNK_SIZE)
                if not chunk:
                    break
                f.write(chunk)
        await video.close()
        logging.info(f"[SCAN] Streamed {os.path.getsize(temp_path)} bytes to temp file")

        # Upload from temp file
        with open(temp_path, "rb") as f:
            storage.upload_video_streaming(f, r2_key)
    finally:
        try:
            os.unlink(temp_path)
        except FileNotFoundError:
            pass

    local_path = storage.download_video_to_tmp(r2_key)
    logging.info(f"[SCAN] Saved to {local_path} ({os.path.getsize(local_path)} bytes)")
    try:
        from core.detector import detect_players
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
    # Evict old sessions before creating new one (memory optimization)
    _evict_old_sessions()
    with sessions_lock:
        sessions[session_token] = {
            "video_key": r2_key,
            "players": players,
            "created_at": time.time(),
        }

    # Warm cache for this video (makes subsequent analyses faster)
    try:
        from core.cache import compute_video_hash, warm_cache_for_video
        video_hash = compute_video_hash(local_path)
        warm_cache_for_video(video_hash, local_path)
    except Exception as e:
        logging.warning(f"Cache warming failed: {e}")

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
        from core.analyzer import run_analysis
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


@app.post("/analyze-async")
async def analyze_async(request: Request) -> JSONResponse:
    """
    Start analysis and return job ID immediately.
    Client can poll /status/{job_id} or use /analyze-progress/{job_id} for SSE.
    """
    content_type = (request.headers.get("content-type") or "").lower()

    if not content_type.startswith("application/json"):
        return _error_response(415, "INVALID_REQUEST", "JSON required")

    try:
        payload = await request.json()
    except Exception:
        return _error_response(400, "INVALID_REQUEST", "Invalid JSON body")

    session_token = payload.get("session_token")
    player_index = _safe_int(payload.get("player_index"))

    if not session_token:
        return _error_response(400, "INVALID_REQUEST", "session_token required")

    # Get video key from session
    video_key, err = _session_video_path(session_token)
    if err:
        return err

    # Create job in Redis
    from core.jobs import create_job
    engine_job_id = create_job(session_token, video_key)

    # Start analysis in bounded executor (memory optimization)
    def _run_analysis():
        from core.analyzer import run_analysis
        run_analysis(engine_job_id, video_key, player_index)
    
    _analysis_executor.submit(_run_analysis)

    return JSONResponse({
        "job_id": engine_job_id,
        "status": "processing",
        "message": "Analysis started. Use GET /status/{job_id} or GET /analyze-progress/{job_id} for updates.",
    })


@app.get("/analyze-progress/{job_id}")
async def analyze_progress(job_id: str):
    """
    SSE endpoint for live progress updates.
    Client can listen for real-time stage updates.
    """
    from fastapi.responses import StreamingResponse

    async def event_generator():
        while True:
            try:
                from core.jobs import get_job
                job = get_job(job_id)

                # Send progress update
                data = json.dumps({
                    "job_id": job_id,
                    "stage": job.stage if hasattr(job, "stage") else "unknown",
                    "progress": job.progress if hasattr(job, "progress") else 0,
                    "complete": job.stage == "completed" if hasattr(job, "stage") else False,
                    "error": job.error if hasattr(job, "error") else None,
                })
                yield f"data: {data}\n\n"

                # Check if done
                if hasattr(job, "stage") and job.stage in ("completed", "failed"):
                    break

            except Exception as e:
                # Job might not exist yet
                data = json.dumps({
                    "job_id": job_id,
                    "stage": "queued",
                    "progress": 0,
                    "complete": False,
                    "error": None,
                })
                yield f"data: {data}\n\n"

            await asyncio.sleep(1)  # Update every second

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


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
            return _error_response(404, "VIDEO_EXPIRED", "This video is no longer available. The server may have restarted. Please upload your video again.")

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
