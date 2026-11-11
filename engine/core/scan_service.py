"""Scan orchestration: probe, detect players, persist session angles, emit events.

Separated from HTTP routes so scan workflow/state updates live in core while
routes stay thin adapters over uploads and request parsing.
"""

import asyncio
import logging
import re

import cv2

from . import events, people, pipeline, sessions, storage, video
from .errors import EngineError, invalid

log = logging.getLogger("engine.scan")
RAW_KEY = re.compile(r"^raw/[A-Za-z0-9_@.|-]+/[a-z0-9_-]+/[a-f0-9]{32}\.mp4$")


def stream_name(token: str, angle: str) -> str:
    return f"scan:{token}:{angle}"


def resolve_scan_session(
    session_token: str | None, angle: str | None
) -> tuple[str, str]:
    """Return (token, label), reusing an existing session token when valid."""
    label = sessions.angle_label(angle)
    token = session_token if sessions.get(session_token) else sessions.new_token()
    return token, label


def validate_scan_storage_key(key: object) -> str:
    if not isinstance(key, str) or not RAW_KEY.match(key):
        raise invalid("storage_key must be an upload-intent key")
    return key


def build_upload_intent(
    *,
    mime_type: object,
    filename: object,
    size_bytes: object,
    session_token: str | None,
    angle: str | None,
    max_upload_bytes: int,
) -> dict:
    if not isinstance(filename, str) or not filename.strip() or len(filename) > 255:
        raise invalid("filename (<=255 chars) required")
    if not isinstance(mime_type, str) or not mime_type.startswith("video/"):
        raise EngineError("INVALID_FILE_TYPE", "Please upload a video file.")
    try:
        size = int(size_bytes)
    except (TypeError, ValueError):
        raise invalid("size_bytes (integer) required") from None
    if not 1 <= size <= max_upload_bytes:
        raise EngineError(
            "FILE_TOO_LARGE",
            f"File must be between 1 byte and {max_upload_bytes // (1 << 20)}MB.",
            status=413,
        )
    token, label = resolve_scan_session(session_token, angle)
    key = storage.raw_key(token, label)
    return {
        "key": key,
        "session_token": token,
        "angle": label,
        "upload": storage.backend().upload_slot(key, mime_type),
    }


async def run_scan(
    key: str, path: str, token: str, angle: str, sha: str | None
) -> dict:
    """Probe, find the players, remember them in the session."""
    stream = stream_name(token, angle)
    store = storage.backend()

    def progress(done: int, total: int) -> None:
        events.emit(
            stream,
            "scan.progress",
            {
                "session_token": token,
                "angle": angle,
                "current": done,
                "total": total,
                "complete": False,
                "error": None,
            },
            webhook=False,
        )

    def work():
        media = video.probe(path)
        cap = cv2.VideoCapture(path)
        info = {
            "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
            "duration": round(media.duration, 1),
            "has_audio": media.has_audio,
        }
        cap.release()
        detector = pipeline.make_detector()
        try:
            return info, people.scan(path, detector, progress)
        finally:
            if hasattr(detector, "close"):
                detector.close()

    try:
        info, found = await asyncio.to_thread(work)
    except Exception as exc:
        store.delete(key)
        message = (
            exc.message
            if isinstance(exc, EngineError)
            else "Could not scan this video."
        )
        events.emit(
            stream,
            "scan.failed",
            {
                "session_token": token,
                "angle": angle,
                "current": 0,
                "total": 0,
                "complete": True,
                "error": message,
            },
            webhook=False,
        )
        raise

    replaced = sessions.add_angle(
        token,
        angle,
        {
            "video_key": key,
            "sha256": sha,
            "media": info,
            "players": [
                {
                    k: p[k]
                    for k in (
                        "player_index",
                        "bbox",
                        "frame_timestamp",
                        "confidence",
                        "signature",
                    )
                }
                for p in found
            ],
        },
    )
    if replaced:
        store.delete(replaced)
    events.emit(
        stream,
        "scan.completed",
        {
            "session_token": token,
            "angle": angle,
            "current": 1,
            "total": 1,
            "complete": True,
            "error": None,
        },
        webhook=False,
    )
    return {
        "session_token": token,
        "video_key": key,
        "angle": angle,
        "angles": sessions.labels(token),
        "player_count": len(found),
        "media": info,
        "players": [
            {
                "player_index": p["player_index"],
                "confidence": p["confidence"],
                "crop_base64": p["crop_base64"],
            }
            for p in found
        ],
    }
