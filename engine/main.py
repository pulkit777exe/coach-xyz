import asyncio
import hmac
import json
import logging
import sys
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core import config, db, events, jobs, pose, sessions
from core.errors import EngineError
from routes import chat, scan
from routes import jobs as job_routes

log = logging.getLogger("engine")
STARTED = time.time()


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {"ts": round(record.created, 3), "level": record.levelname, "logger": record.name,
                 "message": record.getMessage()}
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry)


def setup_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(config.settings.log_level)
    logging.getLogger("httpx").setLevel(logging.WARNING)


async def maintenance() -> None:
    while True:
        await asyncio.sleep(600)
        try:
            await asyncio.to_thread(lambda: (sessions.expire(), jobs.purge()))
        except Exception:
            log.exception("maintenance failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = config.settings
    setup_logging()
    if s.production and not s.service_token:
        raise RuntimeError("ENVIRONMENT=production requires SERVICE_TOKEN; refusing to start unauthenticated.")
    if s.sentry_dsn:
        import sentry_sdk

        sentry_sdk.init(dsn=s.sentry_dsn, environment=s.env, release=f"engine@{config.ENGINE_VERSION}")
    db.conn()
    dispatcher = events.Dispatcher()
    dispatcher.start()
    resumed = jobs.recover()
    sweeper = asyncio.create_task(maintenance())
    log.info("engine %s ready (storage=%s, workers=%s, resumed=%s)", config.ENGINE_VERSION, s.storage_backend,
             s.workers, resumed)
    yield
    sweeper.cancel()
    dispatcher.stop()
    jobs.shutdown()


app = FastAPI(title="CoachAI Engine", version=config.ENGINE_VERSION, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=list(config.settings.cors_origins), allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def guard(request: Request, call_next):
    token = config.settings.service_token
    if token and request.url.path != "/health":
        if not hmac.compare_digest(request.headers.get("x-service-token", ""), token):
            return JSONResponse({"code": "FORBIDDEN", "message": "Invalid service credentials", "layer": "engine",
                                 "retryable": False}, status_code=403)
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    began = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-Id"] = request_id
    took = (time.perf_counter() - began) * 1000
    response.headers["X-Response-Time"] = f"{took:.0f}ms"
    if took > 2000 and "text/event-stream" not in response.headers.get("content-type", ""):
        log.warning("slow request %s %s %.0fms", request.method, request.url.path, took)
    return response


@app.exception_handler(EngineError)
async def engine_error(_, exc: EngineError):
    return JSONResponse(exc.to_dict(), status_code=exc.status)


@app.exception_handler(RequestValidationError)
async def invalid_request(_, exc: RequestValidationError):
    return JSONResponse({"code": "INVALID_REQUEST", "message": "Invalid request format.", "layer": "engine",
                         "retryable": False}, status_code=400)


@app.exception_handler(Exception)
async def unexpected(_, exc: Exception):
    log.exception("unhandled error")
    return JSONResponse({"code": "INTERNAL_ERROR", "message": "An unexpected error occurred.", "layer": "engine",
                         "retryable": True}, status_code=500)


@app.get("/health")
def health():
    return {"status": "ok", "uptime": round(time.time() - STARTED, 1), "version": config.ENGINE_VERSION}


@app.get("/health/deep")
def health_deep():
    from core import llm

    pending = db.one("SELECT COUNT(*) AS n FROM jobs WHERE state IN ('queued','running')")["n"]
    return {
        "status": "ok",
        "pose_model": pose.model_path().is_file(),
        "gemini_key": bool(config.settings.gemini_key),
        "gemini_models_blocked": sorted(m for m, until in llm._blocked.items() if until > time.monotonic()),
        "jobs_active": pending,
        "workers": config.settings.workers,
        "storage": config.settings.storage_backend,
    }


app.include_router(scan.router)
app.include_router(job_routes.router)
app.include_router(chat.router)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8001)
