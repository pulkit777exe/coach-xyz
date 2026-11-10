import asyncio
import hashlib
import logging
import os
import re
import tempfile

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse

from core import config, events, sessions, sports, storage, video
from core.errors import EngineError, invalid
from core.scan_service import run_scan, stream_name

router = APIRouter()
log = logging.getLogger("engine.scan")
KEY = re.compile(r"^raw/[A-Za-z0-9_@.|-]+/[a-z0-9_-]+/[a-f0-9]{32}\.mp4$")
CHUNK = 8 << 20


async def _scan(
    key: str, path: str, token: str, angle: str, sha: str | None
) -> JSONResponse:
    """HTTP adapter over core scan orchestration."""
    return JSONResponse(await run_scan(key, path, token, angle, sha))


@router.post("/scan")
async def scan(
    video_file: UploadFile = File(alias="video"),  # noqa: B008
    session_token: str | None = Form(default=None),
    angle: str | None = Form(default=None),
):
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
                        raise EngineError(
                            "VIDEO_DECODE_FAILED",
                            "Could not read this video. Try MP4, MOV or WebM.",
                            status=422,
                        )
                size += len(chunk)
                if size > limit:
                    raise EngineError(
                        "FILE_TOO_LARGE",
                        f"File exceeds {limit // (1 << 20)}MB.",
                        status=413,
                    )
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
        raise EngineError(
            "FILE_TOO_LARGE",
            f"File must be between 1 byte and {limit // (1 << 20)}MB.",
            status=413,
        )
    label = sessions.angle_label(body.get("angle"))
    token = (
        body.get("session_token")
        if sessions.get(body.get("session_token"))
        else sessions.new_token()
    )
    key = storage.raw_key(token, label)
    return {
        "key": key,
        "session_token": token,
        "angle": label,
        "upload": storage.backend().upload_slot(key, mime),
    }


@router.post("/scan-from-key")
async def scan_from_key(request: Request):
    body = await request.json()
    key = body.get("storage_key")
    if not isinstance(key, str) or not KEY.match(key):
        raise invalid("storage_key must be an upload-intent key")
    label = sessions.angle_label(body.get("angle"))
    token = (
        body.get("session_token")
        if sessions.get(body.get("session_token"))
        else sessions.new_token()
    )
    store = storage.backend()
    try:
        with store.local_copy(key) as path:
            sha = await asyncio.to_thread(video.sha256_file, path)
            return await _scan(key, path, token, label, sha)
    except FileNotFoundError:
        raise EngineError(
            "SESSION_EXPIRED",
            "Upload not found in storage. Please upload your video again.",
            status=404,
        ) from None


@router.get("/scan-progress/{token}")
async def scan_progress(token: str, request: Request, angle: str | None = None):
    stream = stream_name(token, sessions.angle_label(angle))
    return events.sse_stream(
        events.follow(stream, disconnected=request.is_disconnected, idle_timeout=120)
    )


@router.get("/sports/{sport}/positions")
def positions(sport: str):
    return {"sport": sport.lower(), "positions": sports.load(sport).positions}
