"""api/analyze.py — Synchronous analysis execution (driven by the server queue)."""

from __future__ import annotations

import asyncio
import logging
import traceback
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from api.errors import error_response
from core.errors import EngineError, JobNotFoundError
from core.jobs import create_job, fail_job, get_job, update_job
from core.logging_config import set_job_id
from core.multicam import normalize_angle_label, resolve_angle_video_key
from sessions import sessions, sessions_lock

router = APIRouter()

# Bounded executor for async analysis (memory optimization)
analysis_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="analysis")


def _safe_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except Exception:
        return None


def _session_angle_video_path(
    session_token: str, angle: Any
) -> tuple[Optional[str], Optional[str], Optional[JSONResponse]]:
    """Resolve (video_key, angle_label) for an analyze request.

    Falls back to the session's primary angle when the requested angle is
    unknown, so single-angle clients (no angle sent) keep working unchanged.
    """
    with sessions_lock:
        session = sessions.get(session_token)

    if not session:
        return None, None, error_response(
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
    return None, None, error_response(
        404, "SESSION_EXPIRED", "Session expired. Please upload your video again."
    )


@router.post("/analyze")
async def analyze(request: Request) -> JSONResponse:
    """
    Called by BullMQ worker (server), NOT by end users directly.
    Runs analysis SYNCHRONOUSLY — BullMQ handles concurrency.
    """
    content_type = (request.headers.get("content-type") or "").lower()

    if not content_type.startswith("application/json"):
        return error_response(415, "INVALID_REQUEST", "JSON required")

    try:
        payload = await request.json()
    except Exception:
        return error_response(400, "INVALID_REQUEST", "Invalid JSON body")

    engine_job_id = payload.get("engine_job_id")
    session_token = payload.get("session_token")
    player_index = _safe_int(payload.get("player_index"))
    video_key_fallback = payload.get("video_key")
    requested_angle = payload.get("angle")

    if not engine_job_id:
        return error_response(400, "MISSING_JOB_ID", "engine_job_id required")

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
        return error_response(400, "INVALID_REQUEST", "session_token or video_key required")

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
            analysis_executor,
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
