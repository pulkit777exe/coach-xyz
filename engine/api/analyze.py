from __future__ import annotations

import asyncio
import logging
import traceback

from contextvars import copy_context
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from core.analyzer import run_analysis
from core.errors import EngineError, JobNotFoundError
from core.jobs import create_job, get_job, update_job, fail_job
from core.logging_config import set_job_id

from .sessions import _session_video_path, _error_response, _safe_int, _analysis_executor

router = APIRouter()


@router.post("/analyze")
async def analyze(request: Request) -> JSONResponse:
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
    video_key_fallback = payload.get("video_key")

    if not engine_job_id:
        return _error_response(400, "MISSING_JOB_ID", "engine_job_id required")

    set_job_id(engine_job_id)

    try:
        get_job(engine_job_id)
    except JobNotFoundError:
        create_job(engine_job_id, initial_state="uploading")

    video_key = None
    if session_token:
        video_key, err = _session_video_path(session_token)
        if err:
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

    if video_key:
        try:
            update_job(engine_job_id, video_key=video_key)
        except Exception:
            pass

    try:
        loop = asyncio.get_running_loop()
        ctx = copy_context()
        await loop.run_in_executor(
            _analysis_executor,
            lambda: ctx.run(run_analysis, engine_job_id, video_key, player_index),
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


@router.post("/analyze-async")
async def analyze_async(request: Request) -> JSONResponse:
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

    video_key, err = _session_video_path(session_token)
    if err:
        return err

    engine_job_id = create_job(session_token, video_key=video_key)

    def _run_analysis():
        try:
            run_analysis(engine_job_id, video_key, player_index)
        except Exception as e:
            logging.error(f"[ASYNC] Analysis failed for {engine_job_id}: {e}\n{traceback.format_exc()}")
            from core.jobs import fail_job as _fail_job
            from core.errors import EngineError as _EngineError
            _fail_job(engine_job_id, _EngineError(
                code="INTERNAL_ERROR",
                message="Unexpected analysis error.",
                retryable=True,
            ))

    _analysis_executor.submit(_run_analysis)

    return JSONResponse({
        "job_id": engine_job_id,
        "status": "processing",
        "message": "Analysis started. Use GET /status/{job_id} or GET /analyze-progress/{job_id} for updates.",
    })


@router.get("/analyze-progress/{job_id}")
async def analyze_progress(job_id: str):
    from fastapi.responses import StreamingResponse
    import asyncio
    import json

    async def event_generator():
        try:
            while True:
                try:
                    job = get_job(job_id)

                    data = json.dumps({
                        "job_id": job_id,
                        "stage": job.state,
                        "progress": job.progress,
                        "complete": job.complete,
                        "error": job.error,
                    })
                    yield f"data: {data}\n\n"

                    if job.state in ("completed", "failed"):
                        break

                except Exception:
                    try:
                        get_job(job_id)
                    except JobNotFoundError:
                        data = json.dumps({
                            "job_id": job_id,
                            "stage": "failed",
                            "progress": 0,
                            "complete": True,
                            "error": "Job not found or expired.",
                            "error_code": "JOB_NOT_FOUND",
                        })
                        yield f"data: {data}\n\n"
                        break
                    except Exception:
                        data = json.dumps({
                            "job_id": job_id,
                            "stage": "queued",
                            "progress": 0,
                            "complete": False,
                            "error": None,
                        })
                        yield f"data: {data}\n\n"

                await asyncio.sleep(1)
        except asyncio.CancelledError:
            pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/status/{job_id}")
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


@router.post("/fail/{job_id}")
async def fail(job_id: str, request: Request) -> JSONResponse:
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
        pass

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
