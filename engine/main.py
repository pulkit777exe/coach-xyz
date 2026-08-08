from __future__ import annotations

import asyncio
import glob
import logging
import os
import time
import traceback
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)

from dotenv import load_dotenv

load_dotenv()

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

from core.logging_config import setup_logging
setup_logging()

from core.pose_backend import pose_backend_name, pose_backend_available

from api.sessions import _evict_old_sessions, SESSION_EVICTION_INTERVAL, _analysis_executor

_required_env_vars = ["GEMINI_API_KEY"]
_missing_env_vars = [k for k in _required_env_vars if not os.environ.get(k)]
if _missing_env_vars:
    logging.error(f"Missing required environment variables: {', '.join(_missing_env_vars)}")
    raise SystemExit(1)

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

try:
    from fastapi.responses import ORJSONResponse
    _default_response_class = ORJSONResponse
except ImportError:
    _default_response_class = JSONResponse

from core.errors import EngineError

from api.health import router as health_router
from api.scan import router as scan_router
from api.analyze import router as analyze_router
from api.chat import router as chat_router
from api.download import router as download_router
from api.search import router as search_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("CoachAI Engine running on :8001")
    backend = pose_backend_name()
    if not pose_backend_available():
        logger.warning(
            "mediapipe Pose backend unavailable. "
            "Install a mediapipe build with either `mp.solutions.pose` or `mediapipe.tasks` support."
        )
    else:
        logger.info(f"MediaPipe pose backend: {backend}")

    async def session_eviction_loop():
        while True:
            await asyncio.sleep(SESSION_EVICTION_INTERVAL)
            _evict_old_sessions()

    eviction_task = asyncio.create_task(session_eviction_loop())
    logger.info(f"Session eviction task started (interval: {SESSION_EVICTION_INTERVAL}s)")

    yield

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


app = FastAPI(
    title="CoachAI Engine",
    version="0.2.0",
    lifespan=lifespan,
    default_response_class=_default_response_class,
)
app.add_middleware(GZipMiddleware, minimum_size=1000)
_cors_origins = [o.strip() for o in os.environ.get("SERVER_URL", "http://localhost:8000").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def timing_middleware(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Response-Time"] = f"{duration_ms:.1f}ms"
    if duration_ms > 1000:
        import json
        logging.warning(json.dumps({
            "type": "slow_request",
            "method": request.method,
            "path": request.url.path,
            "duration_ms": round(duration_ms, 1),
        }))
    return response


@app.exception_handler(EngineError)
async def engine_error_handler(request: Request, exc: EngineError):
    logging.error(f"{exc.code}: {exc.message}")
    _status_map = {
        "NO_PLAYERS_DETECTED": 400,
        "VIDEO_DECODE_FAILED": 400,
        "VIDEO_EXPIRED": 400,
        "VIDEO_NOT_FOUND": 404,
        "JOB_NOT_FOUND": 404,
        "GEMINI_QUOTA_EXCEEDED": 429,
        "GEMINI_TIMEOUT": 504,
        "GEMINI_PARSE_FAILED": 500,
        "GEMINI_PROCESSING_FAILED": 500,
        "MEDIAPIPE_UNAVAILABLE": 503,
        "REDIS_UNAVAILABLE": 503,
        "STORAGE_ERROR": 503,
        "ENGINE_UNAVAILABLE": 503,
    }
    status = _status_map.get(exc.code, 422 if exc.retryable else 500)
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


app.include_router(health_router)
app.include_router(scan_router)
app.include_router(analyze_router)
app.include_router(chat_router)
app.include_router(download_router)
app.include_router(search_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
