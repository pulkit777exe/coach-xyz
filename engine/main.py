from __future__ import annotations

import asyncio
import glob
import hmac
import json
import logging
import os
import time
import traceback
import uuid
from contextlib import asynccontextmanager

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
from core.logging_config import setup_logging
setup_logging()

# ── Validate Required Environment Variables ──────────────────────────────────
_required_env_vars = ["GEMINI_API_KEY"]
_missing_env_vars = [k for k in _required_env_vars if not os.environ.get(k)]
if _missing_env_vars:
    logging.error(f"Missing required environment variables: {', '.join(_missing_env_vars)}")
    raise SystemExit(1)

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.analyze import analysis_executor, router as analyze_router
from api.chat import router as chat_router
from api.errors import error_response
from api.health import pose_backend_available, pose_backend_name, router as health_router
from api.jobs import download_router, router as jobs_router
from api.report import router as report_router
from api.scan import router as scan_router
from api.sports import router as sports_router
from core.errors import EngineError, error_status
from sessions import SESSION_EVICTION_INTERVAL, evict_old_sessions


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

    analysis_executor.shutdown(wait=True, cancel_futures=False)
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


app = FastAPI(title="CoachAI Engine", version="0.2.0", lifespan=lifespan)
# NOTE: no GZipMiddleware by design. GZip buffers the full response body before
# compressing, which stalls Server-Sent Events (scan-progress, chat/stream)
# and wastes CPU re-compressing already-compressed mp4 bytes on /download.
# JSON payloads stay small (FastAPI's native Pydantic serialization); videos
# are served as-is.
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


@app.middleware("http")
async def service_token_middleware(request: Request, call_next):
    expected = os.environ.get("SERVICE_TOKEN")
    if not expected or request.url.path == "/health":
        return await call_next(request)
    token = request.headers.get("x-service-token", "")
    if not hmac.compare_digest(token, expected):
        return error_response(403, "FORBIDDEN", "Invalid service credentials")
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


# ── Routes (registered in the original declaration order) ────────────────────

app.include_router(health_router)
app.include_router(sports_router)
app.include_router(scan_router)
app.include_router(analyze_router)
app.include_router(jobs_router)
app.include_router(chat_router)
app.include_router(report_router)
app.include_router(download_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
