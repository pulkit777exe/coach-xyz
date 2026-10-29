import asyncio
import hashlib
import logging
import os
import re
import tempfile

import cv2
from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse

from core import config, events, people, pipeline, sessions, sports, storage, video
from core.errors import EngineError, invalid

router = APIRouter()
log = logging.getLogger("engine.scan")
KEY = re.compile(r"^raw/[A-Za-z0-9_@.|-]+/[a-z0-9_-]+/[a-f0-9]{32}\.mp4$")
CHUNK = 8 << 20


def _stream(token: str, angle: str) -> str:
    return f"scan:{token}:{angle}"


async def _scan(key: str, path: str, token: str, angle: str, sha: str | None) -> JSONResponse:
    """Probe, find the players, remember them in the session."""
    stream = _stream(token, angle)
    store = storage.backend()

    def progress(done: int, total: int) -> None:
        events.emit(stream, "scan.progress", {"session_token": token, "angle": angle, "current": done,
                                              "total": total, "complete": False, "error": None}, webhook=False)

    def work():
        media = video.probe(path)
        cap = cv2.VideoCapture(path)
        info = {"width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
                "duration": round(media.duration, 1), "has_audio": media.has_audio}
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
        message = exc.message if isinstance(exc, EngineError) else "Could not scan this video."
        events.emit(stream, "scan.failed", {"session_token": token, "angle": angle, "current": 0, "total": 0,
                                            "complete": True, "error": message}, webhook=False)
        raise

    replaced = sessions.add_angle(token, angle, {
        "video_key": key, "sha256": sha, "media": info,
        "players": [{k: p[k] for k in ("player_index", "bbox", "frame_timestamp", "confidence", "signature")}
                    for p in found],
    })
    if replaced:
        store.delete(replaced)
    events.emit(stream, "scan.completed", {"session_token": token, "angle": angle, "current": 1, "total": 1,
                                           "complete": True, "error": None}, webhook=False)
    return JSONResponse({
        "session_token": token, "video_key": key, "angle": angle, "angles": sessions.labels(token),
        "player_count": len(found), "media": info,
        "players": [{"player_index": p["player_index"], "confidence": p["confidence"],
                     "crop_base64": p["crop_base64"]} for p in found],
    })


@router.post("/scan")
async def scan(video_file: UploadFile = File(alias="video"), session_token: str | None = Form(default=None),
               angle: str | None = Form(default=None)):
    label = sessions.angle_label(angle)
    token = session_token if sessions.get(session_token) else sessions.new_token()
    key = storage.raw_key(token, label)
    limit = config.settings.max_upload_bytes
    fd, tmp = tempfile.mkstemp(suffix=".mp4")
    digest, size, first = hashlib.sha256(), 0, True
    try:
        with os.fdopen(fd, "wb") as f:
            while chunk := await video_file.read(CHUNK):
                if first:
                    first = False
                    if not video.looks_like_video(chunk):
                        raise EngineError("VIDEO_DECODE_FAILED", "Could not read this video. Try MP4, MOV or WebM.",
                                          status=422)
                size += len(chunk)
                if size > limit:
                    raise EngineError("FILE_TOO_LARGE", f"File exceeds {limit // (1 << 20)}MB.", status=413)
                digest.update(chunk)
                f.write(chunk)
        await video_file.close()
        if size == 0:
            raise invalid("Missing video upload")
        store = storage.backend()
        store.put(key, tmp)
        path = str(store.path(key)) if store.name == "local" else tmp
        return await _scan(key, path, token, label, digest.hexdigest())
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


@router.post("/upload-intent")
async def upload_intent(request: Request):
    body = await request.json()
    mime, name = body.get("mime_type"), body.get("filename")
    if not isinstance(name, str) or not name.strip() or len(name) > 255:
        raise invalid("filename (<=255 chars) required")
    if not isinstance(mime, str) or not mime.startswith("video/"):
        raise EngineError("INVALID_FILE_TYPE", "Please upload a video file.")
    try:
        size = int(body.get("size_bytes"))
    except (TypeError, ValueError):
        raise invalid("size_bytes (integer) required") from None
    limit = config.settings.max_upload_bytes
    if not 1 <= size <= limit:
        raise EngineError("FILE_TOO_LARGE", f"File must be between 1 byte and {limit // (1 << 20)}MB.", status=413)
    label = sessions.angle_label(body.get("angle"))
    token = body.get("session_token") if sessions.get(body.get("session_token")) else sessions.new_token()
    key = storage.raw_key(token, label)
    return {"key": key, "session_token": token, "angle": label, "upload": storage.backend().upload_slot(key, mime)}


@router.post("/scan-from-key")
async def scan_from_key(request: Request):
    body = await request.json()
    key = body.get("storage_key")
    if not isinstance(key, str) or not KEY.match(key):
        raise invalid("storage_key must be an upload-intent key")
    label = sessions.angle_label(body.get("angle"))
    token = body.get("session_token") if sessions.get(body.get("session_token")) else sessions.new_token()
    store = storage.backend()
    try:
        with store.local_copy(key) as path:
            sha = await asyncio.to_thread(video.sha256_file, path)
            return await _scan(key, path, token, label, sha)
    except FileNotFoundError:
        raise EngineError("SESSION_EXPIRED", "Upload not found in storage. Please upload your video again.",
                          status=404) from None


@router.get("/scan-progress/{token}")
async def scan_progress(token: str, request: Request, angle: str | None = None):
    stream = _stream(token, sessions.angle_label(angle))
    return events.sse_stream(
        events.follow(stream, disconnected=request.is_disconnected, idle_timeout=120)
    )


@router.get("/sports/{sport}/positions")
def positions(sport: str):
    return {"sport": sport.lower(), "positions": sports.load(sport).positions}
