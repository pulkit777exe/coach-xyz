from __future__ import annotations

import time
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, Optional, Tuple, Union

from fastapi import UploadFile
from fastapi.responses import JSONResponse
from starlette.datastructures import UploadFile as StarletteUploadFile

SESSION_TTL = 7200
MAX_SESSIONS = 10
SESSION_EVICTION_INTERVAL = 300

sessions: Dict[str, Dict[str, Any]] = {}
sessions_lock = threading.Lock()

scan_progress: Dict[str, Dict[str, Any]] = {}
scan_progress_lock = threading.Lock()

_analysis_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="analysis")


def _evict_old_sessions_unlocked() -> None:
    now = time.time()
    expired = [sid for sid, s in sessions.items()
               if now - s.get("created_at", 0) > SESSION_TTL]
    for sid in expired:
        sessions.pop(sid, None)

    while len(sessions) > MAX_SESSIONS:
        oldest_sid = min(sessions, key=lambda s: sessions[s].get("created_at", 0))
        sessions.pop(oldest_sid, None)


def _evict_old_sessions() -> None:
    with sessions_lock:
        _evict_old_sessions_unlocked()


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


def _session_video_path(session_token: str) -> Tuple[Optional[str], Optional[JSONResponse]]:
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


def _error_response(status_code: int, error: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "code": error,
            "message": message,
            "layer": "engine",
            "retryable": status_code >= 500,
        },
    )


def _safe_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except Exception:
        return None
