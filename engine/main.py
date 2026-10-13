from __future__ import annotations

import asyncio
import glob
import json
import logging
import os
import re
import tempfile
import time
from datetime import datetime, timezone
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional, Union

logger = logging.getLogger(__name__)

from dotenv import load_dotenv

load_dotenv()

# Initialize Sentry (must be early in lifecycle)
import sentry_sdk

try:
    sentry_sdk.init(
        dsn=os.environ.get("SENTRY_DSN"),
        send_default_pii=False,
        release="coachai-engine@0.2.0",
        environment=os.environ.get("ENVIRONMENT", "development"),
        integrations=[],
    )
except Exception:
    pass

# Set up structured logging
from core.logging_config import setup_logging, set_job_id
setup_logging()

# Import shared constants
from core.config import CHUNK_SIZE, MAX_FILE_SIZE_BYTES

# Session management constants live in core.sessions (the session lifecycle
# module); imported here for the eviction loop below.
from core.sessions import (
    SESSION_EVICTION_INTERVAL,
    complete_scan_progress,
    evict_old_sessions,
    fail_scan_progress,
    get_session,
    init_scan_progress,
    read_scan_progress,
    report_scan_progress,
    resolve_session,
    store_scan_result,
)

# ── Validate Required Environment Variables ──────────────────────────────────
_required_env_vars = ["GEMINI_API_KEY"]
_missing_env_vars = [k for k in _required_env_vars if not os.environ.get(k)]
if _missing_env_vars:
    logging.error(f"Missing required environment variables: {', '.join(_missing_env_vars)}")
    raise SystemExit(1)

from fastapi import FastAPI, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from starlette.datastructures import UploadFile as StarletteUploadFile

try:
    from fastapi.responses import ORJSONResponse
    _default_response_class = ORJSONResponse
except ImportError:
    _default_response_class = JSONResponse

from core import storage
from core.multicam import normalize_angle_label
from core.errors import (
    EngineError,
    JobNotFoundError,
    NoPlayersDetectedError,
    VideoDecodeError,
    error_status,
)
from core.jobs import create_job, get_job, update_job, fail_job
from core.http import (
    error_response as _error_response,
    extract_timestamp_refs,
    get_job_or_404,
    is_quota_error,
    map_gemini_error,
    require_completed_summary,
    require_gemini,
    require_json_body,
    require_json_content,
)

try:
    from google import genai
    from google.genai import types as genai_types
    _gemini_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY")) if os.getenv("GEMINI_API_KEY") else None
except ImportError:
    genai = None
    genai_types = None
    _gemini_client = None

# Scan-session state lives in core.sessions — endpoints cross its interface
# instead of touching module dicts directly.

# Bounded executor for async analysis (memory optimization)
_analysis_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="analysis")

# Module-level MediaPipe availability check (used by /health/deep)
try:
    from core.pose_backend import pose_backend_name, pose_backend_available
except Exception:
    def pose_backend_available() -> bool:
        return False
    def pose_backend_name() -> str:
        return "unavailable"

START_TIME = time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("CoachAI Engine running on :8001")
    backend = pose_backend_name()
    if not pose_backend_available():
        logger.warning(
            "mediapipe Pose backend unavailable. "
            "Install a mediapipe build with either `mp.solutions.pose` or `mediapipe.tasks` support."
        )
    else:
        logger.info(f"MediaPipe pose backend: {backend}")

    # Start background session eviction task
    async def session_eviction_loop():
        while True:
            await asyncio.sleep(SESSION_EVICTION_INTERVAL)
            evict_old_sessions()

    eviction_task = asyncio.create_task(session_eviction_loop())
    logger.info(f"Session eviction task started (interval: {SESSION_EVICTION_INTERVAL}s)")

    yield

    # Shutdown
    eviction_task.cancel()
    try:
        await eviction_task
    except asyncio.CancelledError:
        pass

    _analysis_executor.shutdown(wait=True, cancel_futures=False)
    logging.info("CoachAI Engine shutting down")
    storage_dir = os.environ.get("LOCAL_STORAGE_DIR", "./tmp/storage")
    if os.path.exists(storage_dir):
        now = time.time()
        for f in glob.glob(os.path.join(storage_dir, "*")):
            try:
                if os.path.isfile(f) and now - os.path.getmtime(f) > 7200:
                    os.unlink(f)
                    logging.info(f"[SHUTDOWN] Cleaned up orphaned file: {f}")
            except Exception:
                pass


app = FastAPI(title="CoachAI Engine", version="0.2.0", lifespan=lifespan, default_response_class=_default_response_class)
# NOTE: no GZipMiddleware by design. GZip buffers the full response body before
# compressing, which stalls Server-Sent Events (scan-progress, chat/stream)
# and wastes CPU re-compressing already-compressed mp4 bytes on /download.
# JSON payloads stay small via ORJSON; videos are served as-is.
_cors_origins = [o.strip() for o in os.environ.get("SERVER_URL", "http://localhost:8000").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Service-token auth ───────────────────────────────────────────────────────
# When SERVICE_TOKEN is set (production), every route except /health requires
# the shared x-service-token header. Inert when unset so local dev keeps working
# — mirrors the server-side serviceGuard identity boundary.

import hmac


@app.middleware("http")
async def service_token_middleware(request: Request, call_next):
    expected = os.environ.get("SERVICE_TOKEN")
    if not expected or request.url.path == "/health":
        return await call_next(request)
    token = request.headers.get("x-service-token", "")
    if not hmac.compare_digest(token, expected):
        return _error_response(403, "FORBIDDEN", "Invalid service credentials")
    return await call_next(request)


# ── Request Timing Middleware ────────────────────────────────────────────────


@app.middleware("http")
async def timing_middleware(request: Request, call_next):
    start = time.perf_counter()
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Response-Time"] = f"{duration_ms:.1f}ms"
    response.headers["X-Request-Id"] = request_id
    if duration_ms > 1000:
        logging.warning(
            json.dumps({
                "type": "slow_request",
                "method": request.method,
                "path": request.url.path,
                "duration_ms": round(duration_ms, 1),
                "request_id": request_id,
            })
        )
    return response


# ── Global Exception Handlers ────────────────────────────────────────────────


@app.exception_handler(EngineError)
async def engine_error_handler(request: Request, exc: EngineError):
    logging.error(f"{exc.code}: {exc.message}")
    status = error_status(exc)
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


def _session_angle_video_path(
    session_token: str, angle: Any
) -> tuple[Optional[str], Optional[str], Optional[JSONResponse]]:
    """Resolve (video_key, angle_label) for an analyze request.

    Falls back to the session's primary angle when the requested angle is
    unknown, so single-angle clients (no angle sent) keep working unchanged.
    """
    from core.multicam import normalize_angle_label, resolve_angle_video_key

    session = get_session(session_token)

    if not session:
        return None, None, _error_response(
            404, "SESSION_EXPIRED", "Session expired. Please upload your video again."
        )

    label = normalize_angle_label(angle)
    video_key = resolve_angle_video_key(session, label)
    if video_key:
        return video_key, label, None
    # Unknown angle — fall back to primary rather than failing the job.
    primary = resolve_angle_video_key(session, "primary")
    if primary:
        return primary, "primary", None
    return None, None, _error_response(
        404, "SESSION_EXPIRED", "Session expired. Please upload your video again."
    )


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

    # Check executor queue depth
    executor_depth = _analysis_executor._work_queue.qsize() if hasattr(_analysis_executor, '_work_queue') else -1

    status = "healthy" if (redis_ok and mp_ok) else "degraded"

    return {
        "status": status,
        "checks": {
            "redis": {"ok": redis_ok, "latency_ms": redis_latency},
            "mediapipe": {"ok": mp_ok},
            "executor": {"queue_depth": executor_depth, "max_workers": getattr(_analysis_executor, '_max_workers', -1)},
        },
        "uptime": round(time.time() - START_TIME, 1),
    }


# ── Routes ───────────────────────────────────────────────────────────────────


async def _scan_stored_file(
    r2_key: str,
    local_path: str,
    session_token: str,
    angle_label: str,
    append_to_session: bool,
) -> JSONResponse:
    """Shared scan core: probe → detect → session store → response.

    Used by /scan (after multipart upload) and /scan-from-key (after a
    direct-to-storage upload). Cleans up S3 tmp copies; local files live
    until session eviction.
    """
    try:
        # Server-side media inspection (§8): never trust client filename/mime —
        # probe the actual bytes before detection or session creation.
        media_info: dict | None = None
        try:
            from core.video_io import probe_video

            _probe = probe_video(local_path)
            media_info = {
                "width": _probe["width"],
                "height": _probe["height"],
                "duration": round(_probe["duration"], 1),
                "has_audio": _probe.get("has_audio", False),
            }
            logging.info(
                f"[SCAN] Media OK: {_probe['width']}x{_probe['height']}, {_probe['duration']:.1f}s"
            )
        except VideoDecodeError as exc:
            storage.delete_file(r2_key)
            if "MediaPipe Pose backend unavailable" in exc.message:
                return _error_response(
                    503,
                    "ENGINE_UNAVAILABLE",
                    "MediaPipe runtime is unavailable on the engine.",
                )
            raise

        # Set up scan progress tracking, keyed per angle so concurrent scans of
        # different perspectives on one session don't overwrite each other.
        progress_key = init_scan_progress(session_token, angle_label)

        def _report_scan_progress(current: int, total: int) -> None:
            report_scan_progress(progress_key, current, total)

        def _fail_scan_progress(message: str) -> None:
            fail_scan_progress(progress_key, message)

        def _complete_scan_progress() -> None:
            complete_scan_progress(progress_key)

        try:
            from core.detector import detect_players
            players = await asyncio.to_thread(detect_players, local_path, on_progress=_report_scan_progress)
        except NoPlayersDetectedError as e:
            _fail_scan_progress(str(e))
            storage.delete_file(r2_key)
            # The stored object is gone; a local tmp copy (S3) is unlinked by the finally below.
            raise  # caught by global handler
        except VideoDecodeError as exc:
            _fail_scan_progress(str(exc))
            storage.delete_file(r2_key)
            # The stored object is gone; a local tmp copy (S3) is unlinked by the finally below.
            if "MediaPipe Pose backend unavailable" in exc.message:
                return _error_response(
                    503,
                    "ENGINE_UNAVAILABLE",
                    "MediaPipe runtime is unavailable on the engine.",
                )
            raise  # caught by global handler
        except Exception as exc:
            _fail_scan_progress(str(exc))
            storage.delete_file(r2_key)
            # The stored object is gone; a local tmp copy (S3) is unlinked by the finally below.
            raise  # caught by global handler

        # Mark scan progress as complete
        _complete_scan_progress()

        # Evict old sessions before creating new one (memory optimization)
        session, labels, previous = store_scan_result(
            session_token,
            video_key=r2_key,
            players=players,
            angle_label=angle_label,
            append_to_session=append_to_session,
        )
        if previous and previous != r2_key:
            try:
                storage.delete_file(previous)
            except Exception:
                pass
        # Warm cache for this video (makes subsequent analyses faster)
        # Must happen before local_path is deleted
        try:
            from core.cache import compute_video_hash, warm_cache_for_video
            video_hash = compute_video_hash(local_path)
            warm_cache_for_video(video_hash, local_path)
        except Exception as e:
            logging.warning(f"Cache warming failed: {e}")

        # Do NOT delete local_path here — storage.download_video_to_tmp now returns
        # the storage path directly (no copy), so local_path IS the stored file.
        # Source uploads live until their session is evicted (see
        # _delete_session_files in core.sessions) so re-analysis keeps working.

        response_players = [
            {
                "player_index": p["player_index"],
                "confidence": p["confidence"],
                "crop_base64": p["crop_base64"],
            }
            for p in players
        ]

        for rp in response_players:
            cb64 = rp.get("crop_base64", "")
            logging.info(
                f"[SCAN] player {rp['player_index']}: crop_base64 length={len(cb64)}, "
                f"starts_with={cb64[:20]!r}..."
            )

        return JSONResponse(
            status_code=200,
            content={
                "session_token": session_token,
                "video_key": r2_key,
                "angle": angle_label,
                "angles": labels,
                "player_count": len(response_players),
                "players": response_players,
                "media": media_info,
            },
        )
    finally:
        storage.discard_tmp_copy(local_path)


@app.get("/sports/{sport}/positions")
def sport_positions_endpoint(sport: str):
    """Canonical position vocabulary for a sport (roster forms).

    Served from the sport pack so the roster UI never drifts from the
    analysis vocabulary. Unknown sports yield an empty list.
    """
    from core.sport_config import sport_positions

    return {"sport": sport.lower(), "positions": sport_positions(sport)}


@app.post("/scan")
async def scan(
    video: UploadFile,
    session_token: str | None = Form(default=None),
    angle: str | None = Form(default=None),
) -> JSONResponse:
    logging.info(f"[SCAN] Received upload: filename={video.filename}, content_type={video.content_type}, size={video.size}")
    validation_error = _validate_video_upload(video)
    if validation_error:
        logging.info(f"[SCAN] Validation failed: {validation_error.body}")
        return validation_error

    # Resolve the session before streaming so the upload lands under its
    # namespaced key (raw/{session}/{angle}/...). An unknown token starts a
    # new session; angle labels are sanitized by the session layer.
    angle_label = normalize_angle_label(angle)
    session_token, existing = resolve_session(session_token)

    # Stream upload to storage (memory-efficient for large files)
    r2_key = storage.raw_upload_key(session_token, angle_label)
    logging.info(f"[SCAN] Streaming upload to storage: {r2_key}")

    # Always stream to disk (memory optimization: remove 10MB threshold)
    max_upload_size = int(os.environ.get("MAX_FILE_SIZE", MAX_FILE_SIZE_BYTES))
    fd, temp_path = tempfile.mkstemp(suffix=".mp4")
    os.close(fd)
    try:
        total_bytes = 0
        first_chunk = True
        with open(temp_path, "wb") as f:
            while True:
                chunk = await video.read(CHUNK_SIZE)
                if not chunk:
                    break
                if first_chunk:
                    first_chunk = False
                    # Magic-byte sniff before committing disk: the MIME check
                    # above trusts a client header, ffprobe runs only after
                    # the full body lands. Random bytes die here, not after
                    # 500 MB.
                    from core.video_io import looks_like_video_container

                    if not looks_like_video_container(chunk):
                        await video.close()
                        os.unlink(temp_path)
                        return _error_response(
                            422,
                            "VIDEO_DECODE_FAILED",
                            "Could not read this video file. Try MP4, MOV, or AVI format.",
                        )
                total_bytes += len(chunk)
                if total_bytes > max_upload_size:
                    os.unlink(temp_path)
                    return _error_response(
                        413,
                        "FILE_TOO_LARGE",
                        f"File exceeds maximum size of {max_upload_size // (1024*1024)}MB.",
                    )
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

    try:
        local_path = storage.download_video_to_tmp(r2_key)
    except Exception:
        # Clean up the uploaded file if download fails
        storage.delete_file(r2_key)
        raise
    logging.info(f"[SCAN] Saved to {local_path} ({os.path.getsize(local_path)} bytes)")

    return await _scan_stored_file(
        r2_key=r2_key,
        local_path=local_path,
        session_token=session_token,
        angle_label=angle_label,
        append_to_session=existing is not None,
    )



@app.post("/upload-intent")
async def upload_intent(request: Request) -> JSONResponse:
    """Mint a direct-to-storage upload slot (§8).

    Validates the client-declared metadata up front, resolves (or mints) the
    scan session, and returns a namespaced storage key plus the upload
    mechanism: presigned POST fields on the S3 backend, or the multipart
    /scan endpoint on local (the app server still proxies small uploads).
    The bytes themselves are always re-validated by ffprobe at scan time.
    """
    payload = await require_json_body(request)
    if isinstance(payload, JSONResponse):
        return payload

    filename = payload.get("filename")
    mime_type = payload.get("mime_type")
    size_bytes = payload.get("size_bytes")
    if not isinstance(filename, str) or not filename.strip() or len(filename) > 255:
        return _error_response(400, "INVALID_REQUEST", "filename (<=255 chars) required")
    if not isinstance(mime_type, str) or not mime_type.startswith("video/"):
        return _error_response(400, "INVALID_FILE_TYPE", "Please upload a video file.")
    try:
        size = int(size_bytes)
    except (TypeError, ValueError):
        return _error_response(400, "INVALID_REQUEST", "size_bytes (integer) required")
    max_upload_size = int(os.environ.get("MAX_FILE_SIZE", MAX_FILE_SIZE_BYTES))
    if size < 1 or size > max_upload_size:
        return _error_response(
            413,
            "FILE_TOO_LARGE",
            f"File must be between 1 byte and {max_upload_size // (1024 * 1024)}MB.",
        )


    angle_label = normalize_angle_label(payload.get("angle"))
    session_token, existing = resolve_session(payload.get("session_token"))

    key = storage.raw_upload_key(session_token, angle_label)
    try:
        upload = storage.mint_upload(key, mime_type)
    except Exception:
        logging.error(traceback.format_exc())
        return _error_response(500, "STORAGE_ERROR", "Could not mint an upload URL. Please try again.")
    content: dict[str, object] = {
        "key": key,
        "session_token": session_token,
        "angle": angle_label,
    }
    if upload["mode"] == "multipart":
        content["upload"] = {"mode": "multipart", "scan_url": "/scan"}
    else:
        content["upload"] = {
            "mode": "presigned",
            "url": upload["url"],
            "fields": upload["fields"],
        }
    return JSONResponse(status_code=200, content=content)


_STORAGE_KEY_RE = re.compile(r"^raw/[A-Za-z0-9_@.|-]+/[a-z0-9_-]+/[a-f0-9]{32}\.mp4$")


@app.post("/scan-from-key")
async def scan_from_key(request: Request) -> JSONResponse:
    """Scan a video already in storage (after a direct upload, §8).

    Only keys minted by /upload-intent are accepted (raw/ prefix + strict
    shape) — never result keys or arbitrary paths.
    """
    payload = await require_json_body(request)
    if isinstance(payload, JSONResponse):
        return payload

    storage_key = payload.get("storage_key")
    if not isinstance(storage_key, str) or not _STORAGE_KEY_RE.match(storage_key):
        return _error_response(400, "INVALID_REQUEST", "storage_key must be an upload-intent key")


    angle_label = normalize_angle_label(payload.get("angle"))
    session_token, existing = resolve_session(payload.get("session_token"))

    try:
        local_path = storage.download_video_to_tmp(storage_key)
    except FileNotFoundError:
        return _error_response(
            404, "SESSION_EXPIRED", "Upload not found in storage. Please upload your video again."
        )
    except Exception:
        logging.error(traceback.format_exc())
        return _error_response(500, "STORAGE_ERROR", "Could not read the uploaded video. Please try again.")

    return await _scan_stored_file(
        r2_key=storage_key,
        local_path=local_path,
        session_token=session_token,
        angle_label=angle_label,
        append_to_session=existing is not None,
    )


@app.get("/scan-progress/{session_token}")
async def scan_progress_endpoint(session_token: str, angle: str | None = None):
    """
    SSE endpoint for live scan progress updates.
    Client can listen for real-time frame scanning progress.
    `angle` selects which perspective's progress to stream (multi-angle
    sessions track each angle separately); it defaults to the primary angle.
    """
    from fastapi.responses import StreamingResponse

    angle_label = normalize_angle_label(angle)

    def _read_progress() -> dict[str, Any] | None:
        return read_scan_progress(session_token, angle_label)

    async def event_generator():
        try:
            while True:
                try:
                    progress = _read_progress()

                    if progress is None:
                        # Session not found or expired
                        data = json.dumps({
                            "session_token": session_token,
                            "angle": angle_label,
                            "current": 0,
                            "total": 0,
                            "complete": True,
                            "error": "Session not found.",
                        })
                        yield f"data: {data}\n\n"
                        break

                    # Send progress update
                    data = json.dumps({
                        "session_token": session_token,
                        "angle": progress.get("angle", angle_label),
                        "current": progress["current"],
                        "total": progress["total"],
                        "complete": progress["complete"],
                        "error": progress["error"],
                    })
                    yield f"data: {data}\n\n"

                    # Check if done
                    if progress["complete"]:
                        break

                except Exception:
                    # Transient error, send current state and retry
                    progress = _read_progress() or {}
                    data = json.dumps({
                        "session_token": session_token,
                        "angle": progress.get("angle", angle_label),
                        "current": progress.get("current", 0),
                        "total": progress.get("total", 0),
                        "complete": progress.get("complete", False),
                        "error": progress.get("error"),
                    })
                    yield f"data: {data}\n\n"

                    if progress.get("complete"):
                        break

                await asyncio.sleep(0.5)  # Update every 500ms for smooth progress
        except asyncio.CancelledError:
            pass  # Client disconnected — clean up gracefully

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/analyze")
async def analyze(request: Request) -> JSONResponse:
    """
    Called by BullMQ worker (server), NOT by end users directly.
    Runs analysis SYNCHRONOUSLY — BullMQ handles concurrency.
    """
    if (err := require_json_content(request)) is not None:
        return err

    payload = await require_json_body(request)
    if isinstance(payload, JSONResponse):
        return payload

    engine_job_id = payload.get("engine_job_id")
    session_token = payload.get("session_token")
    player_index = _safe_int(payload.get("player_index"))
    video_key_fallback = payload.get("video_key")
    requested_angle = payload.get("angle")

    if not engine_job_id:
        return _error_response(400, "MISSING_JOB_ID", "engine_job_id required")

    # Set correlation ID for structured logging
    set_job_id(engine_job_id)

    # Create job in Redis if it doesn't exist (server may not have created it yet)
    try:
        get_job(engine_job_id)
    except JobNotFoundError:
        # Create the job with uploading state so it can be tracked
        create_job(engine_job_id, initial_state="uploading")

    # Get video key from session (with fallback to persisted video_key)
    video_key = None
    angle_label = "primary"
    if session_token:
        video_key, angle_label, err = _session_angle_video_path(session_token, requested_angle)
        if err:
            # Session expired — try fallback video_key from job state
            if video_key_fallback:
                video_key = video_key_fallback
                err = None
            else:
                fail_job(engine_job_id, JobNotFoundError())
                return err
    elif video_key_fallback:
        video_key = video_key_fallback
    else:
        return _error_response(400, "INVALID_REQUEST", "session_token or video_key required")

    # Persist video_key in Redis job so retry can find it after session expires
    if video_key:
        try:
            update_job(engine_job_id, video_key=video_key)
        except Exception:
            pass  # Best effort — don't fail analysis over this

    # Run in thread pool to avoid blocking the event loop
    # BullMQ worker waits for this response, so we await the result
    try:
        from core.analyzer import run_analysis
        from contextvars import copy_context
        loop = asyncio.get_running_loop()
        # Propagate ContextVar (job_id) to the thread
        ctx = copy_context()
        await loop.run_in_executor(
            _analysis_executor,
            lambda: ctx.run(run_analysis, engine_job_id, video_key, player_index, angle_label),
        )
        return JSONResponse({"ok": True})
    except EngineError as e:
        fail_job(engine_job_id, e)
        return JSONResponse(status_code=500, content=e.to_dict())
    except Exception:
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
    job, err = get_job_or_404(job_id)
    if err is not None:
        return err

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


@app.post("/fail/{job_id}")
async def fail(job_id: str, request: Request) -> JSONResponse:
    """Mark a job as failed. Called by the server when queue retries are exhausted.

    Accepts optional body with { code, message, retryable } to preserve
    the actual error details from the engine instead of overwriting them.
    """
    from core.errors import EngineError

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
        return _error_response(404, "JOB_NOT_FOUND", "Job not found")


@app.post("/chat")
async def chat(request: Request) -> JSONResponse:
    """Conversational follow-up on an analysis result.

    Accepts a job_id, user message, and optional conversation history.
    Returns an AI reply grounded in the original analysis data.

    Uses asyncio.to_thread for the blocking Gemini call so the event loop
    stays responsive.
    """
    if (err := require_json_content(request)) is not None:
        return err

    payload = await require_json_body(request)
    if isinstance(payload, JSONResponse):
        return payload

    job_id = payload.get("job_id")
    user_message = (payload.get("message") or "").strip()
    conversation_history = payload.get("conversation_history") or []

    if not job_id:
        return _error_response(400, "INVALID_REQUEST", "job_id required")
    if not user_message:
        return _error_response(400, "INVALID_REQUEST", "message required")

    # Load the job's analysis result
    job, err = get_job_or_404(job_id, "Job not found or expired")
    if err is not None:
        return err

    if (err := require_completed_summary(job)) is not None:
        return err

    # Build the chat prompt
    from core.chat_prompt import get_chat_prompt
    from core.config import GEMINI_MODEL, CHAT_GEMINI_TIMEOUT_S

    messages = get_chat_prompt(
        analysis_result=job.summary,
        conversation_history=conversation_history,
        user_message=user_message,
    )

    # Call Gemini in a thread to avoid blocking the event loop, with an
    # overall deadline so a hung model call fails fast (the server gives
    # /chat 60s — this deadline sits inside it).
    if (err := require_gemini(_gemini_client)) is not None:
        return err

    try:
        def _call_gemini():
            return _gemini_client.models.generate_content(
                model=GEMINI_MODEL,
                contents=messages[0]["content"],
                config=genai_types.GenerateContentConfig(temperature=0.4),
            )

        response = await asyncio.wait_for(
            asyncio.to_thread(_call_gemini), timeout=CHAT_GEMINI_TIMEOUT_S
        )
        reply = getattr(response, "text", None) or ""
    except asyncio.TimeoutError:
        logging.error("Chat Gemini timeout")
        return _error_response(504, "GEMINI_TIMEOUT", "AI service timed out. Please try again.")
    except Exception as exc:
        return map_gemini_error(exc, "Chat Gemini error")

    timestamp_refs = extract_timestamp_refs(reply)

    return JSONResponse(content={
        "reply": reply,
        "timestamp_refs": sorted(set(timestamp_refs)),
        "event_refs": [],
    })


@app.post("/chat/stream")
async def chat_stream(request: Request):
    """Streaming version of /chat — returns Server-Sent Events.

    Each SSE event is one of:
      data: {"type":"token","text":"..."}   — incremental text chunk
      data: {"type":"done","text":"full reply","timestamp_refs":[...]}  — final
      data: {"type":"error","message":"..."}  — error
    """
    from fastapi.responses import StreamingResponse

    if (err := require_json_content(request)) is not None:
        return err

    payload = await require_json_body(request)
    if isinstance(payload, JSONResponse):
        return payload

    job_id = payload.get("job_id")
    user_message = (payload.get("message") or "").strip()
    conversation_history = payload.get("conversation_history") or []

    if not job_id:
        return _error_response(400, "INVALID_REQUEST", "job_id required")
    if not user_message:
        return _error_response(400, "INVALID_REQUEST", "message required")

    job, err = get_job_or_404(job_id, "Job not found or expired")
    if err is not None:
        return err

    if (err := require_completed_summary(job)) is not None:
        return err

    from core.chat_prompt import get_chat_prompt
    from core.config import GEMINI_MODEL, CHAT_GEMINI_TIMEOUT_S

    messages = get_chat_prompt(
        analysis_result=job.summary,
        conversation_history=conversation_history,
        user_message=user_message,
    )

    if (err := require_gemini(_gemini_client)) is not None:
        return err

    def _stream_error_event(exc: BaseException) -> str:
        if is_quota_error(exc):
            return f"data: {json.dumps({'type': 'error', 'message': 'AI quota exceeded. Please try again later.'})}\n\n"
        logging.error(f"Chat stream Gemini error: {exc}")
        return f"data: {json.dumps({'type': 'error', 'message': 'AI service error. Please try again.'})}\n\n"

    async def generate():
        """Async SSE generator — the blocking Gemini iterator runs in a worker
        thread and pushes chunks through a queue, so the event loop stays
        responsive and each chunk is flushed immediately (no buffering lag).
        A first-chunk deadline keeps a hung model call from hanging the SSE
        stream forever."""
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()

        def _pump() -> None:
            try:
                stream = _gemini_client.models.generate_content_stream(
                    model=GEMINI_MODEL,
                    contents=messages[0]["content"],
                    config=genai_types.GenerateContentConfig(temperature=0.4),
                )
                for chunk in stream:
                    text = getattr(chunk, "text", None) or ""
                    if text:
                        loop.call_soon_threadsafe(queue.put_nowait, ("token", text))
                loop.call_soon_threadsafe(queue.put_nowait, ("end", None))
            except Exception as exc:  # noqa: BLE001 — forwarded to the SSE consumer
                loop.call_soon_threadsafe(queue.put_nowait, ("error", exc))

        pump_task = asyncio.create_task(asyncio.to_thread(_pump))
        full_text = ""
        started = loop.time()
        try:
            while True:
                # Short waits double as SSE comment heartbeats (`: ping` lines
                # are ignored by event parsers but keep proxies/CDNs from
                # closing an idle stream); the overall deadline still bounds
                # a hung model call.
                try:
                    kind, payload = await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    if loop.time() - started > CHAT_GEMINI_TIMEOUT_S:
                        logging.error("Chat stream Gemini timeout")
                        yield f"data: {json.dumps({'type': 'error', 'message': 'AI service timed out. Please try again.'})}\n\n"
                        return
                    yield ": ping\n\n"
                    continue
                if kind == "token":
                    full_text += payload
                    yield f"data: {json.dumps({'type': 'token', 'text': payload})}\n\n"
                elif kind == "end":
                    break
                else:
                    yield _stream_error_event(payload)
                    return
        finally:
            if not pump_task.done():
                pump_task.cancel()

        timestamp_refs = extract_timestamp_refs(full_text)
        yield f"data: {json.dumps({'type': 'done', 'text': full_text, 'timestamp_refs': timestamp_refs, 'event_refs': []})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── AI Report Support ────────────────────────────────────────────────────────


def _report_config() -> Any:
    """GenerateContentConfig for structured JSON report output.

    Builds a genai Schema from the plain REPORT_JSON_SCHEMA dict when the
    google-genai package is available; otherwise falls back to a plain dict
    (only reachable in environments where the client is also unavailable).
    """
    from core.report_prompt import REPORT_JSON_SCHEMA

    if genai_types is None:
        return {
            "temperature": 0.4,
            "responseMimeType": "application/json",
            "responseSchema": REPORT_JSON_SCHEMA,
        }

    def _to_schema(node: Dict[str, Any]) -> Any:
        kwargs: Dict[str, Any] = {}
        for key, value in node.items():
            if key == "type":
                kwargs["type"] = genai_types.Type(str(value))
            elif key == "properties":
                kwargs["properties"] = {k: _to_schema(v) for k, v in value.items()}
            elif key == "items":
                kwargs["items"] = _to_schema(value)
            else:
                kwargs[key] = value
        return genai_types.Schema(**kwargs)

    return genai_types.GenerateContentConfig(
        temperature=0.4,
        response_mime_type="application/json",
        response_schema=_to_schema(REPORT_JSON_SCHEMA),
    )


def _normalize_report(parsed: Dict[str, Any], report_context: Dict[str, Any]) -> Dict[str, Any]:
    """Coerce the parsed report to its contract, best-effort.

    Guarantees each schema field exists with the right shape so the server can
    persist the report without re-validating.
    """
    def _string_list(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [item.strip() for item in value if isinstance(item, str) and item.strip()]

    def _text(v: Any) -> str:
        return v if isinstance(v, str) else ""
    trend = _text(parsed.get("form_score_trend")).lower()
    if trend not in ("improving", "steady", "declining", "mixed"):
        trend = "steady"
    generated_at = (
        _text(parsed.get("generated_at"))
        or (report_context.get("generated_at") if isinstance(report_context.get("generated_at"), str) else "")
        or datetime.now(timezone.utc).isoformat()
    )
    return {
        "narrative": _text(parsed.get("narrative")),
        "summary": _text(parsed.get("summary")),
        "strengths": _string_list(parsed.get("strengths")),
        "areas_to_improve": _string_list(parsed.get("areas_to_improve")),
        "recommendations": _string_list(parsed.get("recommendations")),
        "form_score_trend": trend,
        "highlight_max": _string_list(parsed.get("highlight_max"))[:3],
        "generated_at": generated_at,
    }


@app.post("/report")
async def report(request: Request) -> JSONResponse:
    """One-click AI report generation (called by the BullMQ worker).

    Grounded only in `report_context` (org data assembled server-side); returns
    a structured JSON report plus the raw Gemini text so the server can persist
    both and keep a source of truth for re-generation.
    """
    if (err := require_json_content(request)) is not None:
        return err

    payload = await require_json_body(request)
    if isinstance(payload, JSONResponse):
        return payload

    report_context = payload.get("report_context")
    report_type = (payload.get("report_type") or "").strip()

    if not isinstance(report_context, dict) or not report_context:
        return _error_response(400, "INVALID_REQUEST", "report_context (object) required")
    if not report_type:
        return _error_response(400, "INVALID_REQUEST", "report_type required")

    from core.config import GEMINI_MODEL
    from core.gemini_common import parse_json_response
    from core.report_prompt import get_report_prompt

    messages = get_report_prompt(
        report_context=report_context,
        report_type=report_type,
        sport=payload.get("sport"),
        student_name=payload.get("student_name"),
    )

    if (err := require_gemini(_gemini_client)) is not None:
        return err

    # Call Gemini in a thread to avoid blocking the event loop
    try:
        def _call_gemini():
            return _gemini_client.models.generate_content(
                model=GEMINI_MODEL,
                contents=messages[0]["content"],
                config=_report_config(),
            )

        response = await asyncio.to_thread(_call_gemini)
        raw_text = getattr(response, "text", None) or ""
    except Exception as exc:
        return map_gemini_error(exc, "Report Gemini error")

    if not raw_text:
        return _error_response(500, "GEMINI_EMPTY_RESPONSE", "AI returned an empty response. Please try again.")

    try:
        parsed = parse_json_response(raw_text)
    except Exception as exc:
        logging.error(f"Report parse failed: {exc}")
        return _error_response(500, "GEMINI_PARSE_FAILED", "AI returned an unexpected response. Please try again.")

    if not isinstance(parsed, dict):
        return _error_response(500, "GEMINI_PARSE_FAILED", "AI returned an unexpected response. Please try again.")

    report_data = _normalize_report(parsed, report_context)
    return JSONResponse(content={"report": report_data, "raw": raw_text})


@app.get("/download/{job_id}")
def download(job_id: str):
    job, err = get_job_or_404(job_id)
    if err is not None:
        return err

    if job.state != "completed" or not job.video_key:
        return _error_response(404, "VIDEO_NOT_FOUND", "Rendered video is not available")

    try:
        kind, target = storage.resolve_download(job.video_key)
    except FileNotFoundError:
        return _error_response(404, "VIDEO_EXPIRED", "This video is no longer available. The server may have restarted. Please upload your video again.")
    except Exception:
        return _error_response(404, "VIDEO_EXPIRED", "This video is no longer available. Please upload your video again.")

    if kind == "file":
        return FileResponse(
            path=target,
            media_type="video/mp4",
            filename="coachai_analysis.mp4",
            headers={"Content-Disposition": 'inline; filename="coachai_analysis.mp4"'},
        )
    return RedirectResponse(url=target, status_code=302)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
