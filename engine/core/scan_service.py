"""Scan orchestration: probe, detect players, persist session angles, emit events.

Separated from HTTP routes so scan workflow/state updates live in core while
routes stay thin adapters over uploads and request parsing.
"""

import asyncio
import logging

import cv2

from . import events, people, pipeline, sessions, storage, video
from .errors import EngineError

log = logging.getLogger("engine.scan")


def stream_name(token: str, angle: str) -> str:
    return f"scan:{token}:{angle}"


async def run_scan(key: str, path: str, token: str, angle: str, sha: str | None) -> dict:
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
