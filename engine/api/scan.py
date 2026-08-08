from __future__ import annotations

import logging
import os
import tempfile
import uuid

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from core import storage
from core.config import MAX_FILE_SIZE_BYTES, CHUNK_SIZE
from core.detector import detect_players
from core.errors import NoPlayersDetectedError, VideoDecodeError
from core.cache import compute_video_hash, warm_cache_for_video

from .sessions import (
    sessions, sessions_lock, scan_progress, scan_progress_lock,
    _evict_old_sessions_unlocked, _validate_video_upload, _error_response,
)

router = APIRouter()


@router.post("/scan")
async def scan(video) -> JSONResponse:
    logging.info(f"[SCAN] Received upload: filename={video.filename}, content_type={video.content_type}, size={video.size}")
    validation_error = _validate_video_upload(video)
    if validation_error:
        logging.info(f"[SCAN] Validation failed: {validation_error.body}")
        return validation_error

    r2_key = f"uploads/{uuid.uuid4().hex}.mp4"
    logging.info(f"[SCAN] Streaming upload to storage: {r2_key}")

    max_upload_size = int(os.environ.get("MAX_FILE_SIZE", MAX_FILE_SIZE_BYTES))
    fd, temp_path = tempfile.mkstemp(suffix=".mp4")
    os.close(fd)
    try:
        total_bytes = 0
        with open(temp_path, "wb") as f:
            while True:
                chunk = await video.read(CHUNK_SIZE)
                if not chunk:
                    break
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
        storage.delete_file(r2_key)
        raise
    logging.info(f"[SCAN] Saved to {local_path} ({os.path.getsize(local_path)} bytes)")

    session_token = str(uuid.uuid4())

    with scan_progress_lock:
        scan_progress[session_token] = {
            "current": 0,
            "total": 0,
            "complete": False,
            "error": None,
        }

    def _report_scan_progress(current: int, total: int) -> None:
        with scan_progress_lock:
            if session_token in scan_progress:
                scan_progress[session_token]["current"] = current
                scan_progress[session_token]["total"] = total

    try:
        players = detect_players(local_path, on_progress=_report_scan_progress)
    except NoPlayersDetectedError as e:
        with scan_progress_lock:
            if session_token in scan_progress:
                scan_progress[session_token]["complete"] = True
                scan_progress[session_token]["error"] = str(e)
        storage.delete_file(r2_key)
        raise
    except VideoDecodeError as exc:
        with scan_progress_lock:
            if session_token in scan_progress:
                scan_progress[session_token]["complete"] = True
                scan_progress[session_token]["error"] = str(exc)
        storage.delete_file(r2_key)
        if "MediaPipe Pose backend unavailable" in exc.message:
            return _error_response(
                503,
                "ENGINE_UNAVAILABLE",
                "MediaPipe runtime is unavailable on the engine.",
            )
        raise
    except Exception as exc:
        with scan_progress_lock:
            if session_token in scan_progress:
                scan_progress[session_token]["complete"] = True
                scan_progress[session_token]["error"] = str(exc)
        storage.delete_file(r2_key)
        raise

    with scan_progress_lock:
        if session_token in scan_progress:
            scan_progress[session_token]["complete"] = True

    import time
    with sessions_lock:
        _evict_old_sessions_unlocked()
        sessions[session_token] = {
            "video_key": r2_key,
            "players": players,
            "created_at": time.time(),
        }

    try:
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
            "player_count": len(response_players),
            "players": response_players,
        },
    )


@router.get("/scan-progress/{session_token}")
async def scan_progress_endpoint(session_token: str):
    from fastapi.responses import StreamingResponse
    import asyncio
    import json

    async def event_generator():
        try:
            while True:
                try:
                    with scan_progress_lock:
                        progress = scan_progress.get(session_token)

                    if progress is None:
                        data = json.dumps({
                            "session_token": session_token,
                            "current": 0,
                            "total": 0,
                            "complete": True,
                            "error": "Session not found.",
                        })
                        yield f"data: {data}\n\n"
                        break

                    data = json.dumps({
                        "session_token": session_token,
                        "current": progress["current"],
                        "total": progress["total"],
                        "complete": progress["complete"],
                        "error": progress["error"],
                    })
                    yield f"data: {data}\n\n"

                    if progress["complete"]:
                        break

                except Exception:
                    with scan_progress_lock:
                        progress = scan_progress.get(session_token, {})
                    data = json.dumps({
                        "session_token": session_token,
                        "current": progress.get("current", 0),
                        "total": progress.get("total", 0),
                        "complete": progress.get("complete", False),
                        "error": progress.get("error"),
                    })
                    yield f"data: {data}\n\n"

                    if progress.get("complete"):
                        break

                await asyncio.sleep(0.5)
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
