"""api/scan.py — Scan intake: uploads, direct-to-storage keys, and live progress."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import tempfile
import time
import traceback
import uuid
from typing import Any, Optional, Union

from fastapi import APIRouter, Form, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.datastructures import UploadFile as StarletteUploadFile

from api.errors import error_response
from core import storage
from core.config import CHUNK_SIZE, MAX_FILE_SIZE_BYTES
from core.errors import NoPlayersDetectedError, VideoDecodeError
from core.multicam import angle_labels, append_angle, normalize_angle_label, scan_progress_key
from sessions import (
    evict_old_sessions_unlocked,
    scan_progress,
    scan_progress_lock,
    sessions,
    sessions_lock,
)

router = APIRouter()


def _validate_video_upload(upload: Union[UploadFile, StarletteUploadFile, None]) -> Optional[JSONResponse]:
    if upload is None:
        return error_response(400, "INVALID_REQUEST", "Missing video upload")

    content_type = getattr(upload, "content_type", None) or ""
    if not content_type.startswith("video/"):
        return error_response(
            422,
            "VIDEO_DECODE_FAILED",
            "Could not read this video file. Try MP4, MOV, or AVI format.",
        )

    return None


async def _scan_stored_file(
    r2_key: str,
    local_path: str,
    session_token: str,
    angle_label: str,
    append_to_session: bool,
) -> JSONResponse:
    """Shared scan core: probe → detect → session store → response.

    Used by /scan (after multipart upload) and /scan-from-key (after a
    direct-to-storage upload). Cleans up S3 tmp copies; local files live
    until session eviction.
    """
    try:
        # Server-side media inspection (§8): never trust client filename/mime —
        # probe the actual bytes before detection or session creation.
        media_info: dict | None = None
        try:
            from core.video_io import probe_video

            _probe = probe_video(local_path)
            media_info = {
                "width": _probe["width"],
                "height": _probe["height"],
                "duration": round(_probe["duration"], 1),
                "has_audio": _probe.get("has_audio", False),
            }
            logging.info(
                f"[SCAN] Media OK: {_probe['width']}x{_probe['height']}, {_probe['duration']:.1f}s"
            )
        except VideoDecodeError as exc:
            storage.delete_file(r2_key)
            if "MediaPipe Pose backend unavailable" in exc.message:
                return error_response(
                    503,
                    "ENGINE_UNAVAILABLE",
                    "MediaPipe runtime is unavailable on the engine.",
                )
            raise

        # Set up scan progress tracking, keyed per angle so concurrent scans of
        # different perspectives on one session don't overwrite each other.
        progress_key = scan_progress_key(session_token, angle_label)
        with scan_progress_lock:
            scan_progress[progress_key] = {
                "session_token": session_token,
                "current": 0,
                "total": 0,
                "complete": False,
                "error": None,
                "angle": angle_label,
                "started_at": time.time(),
            }

        def _report_scan_progress(current: int, total: int) -> None:
            with scan_progress_lock:
                if progress_key in scan_progress:
                    scan_progress[progress_key]["current"] = current
                    scan_progress[progress_key]["total"] = total

        def _fail_scan_progress(message: str) -> None:
            with scan_progress_lock:
                if progress_key in scan_progress:
                    scan_progress[progress_key]["complete"] = True
                    scan_progress[progress_key]["error"] = message

        def _complete_scan_progress() -> None:
            with scan_progress_lock:
                if progress_key in scan_progress:
                    scan_progress[progress_key]["complete"] = True
                    scan_progress[progress_key]["error"] = None

        try:
            from core.detector import detect_players
            players = await asyncio.to_thread(detect_players, local_path, on_progress=_report_scan_progress)
        except NoPlayersDetectedError as e:
            _fail_scan_progress(str(e))
            storage.delete_file(r2_key)
            # The stored object is gone; a local tmp copy (S3) is unlinked by the finally below.
            raise  # caught by global handler
        except VideoDecodeError as exc:
            _fail_scan_progress(str(exc))
            storage.delete_file(r2_key)
            # The stored object is gone; a local tmp copy (S3) is unlinked by the finally below.
            if "MediaPipe Pose backend unavailable" in exc.message:
                return error_response(
                    503,
                    "ENGINE_UNAVAILABLE",
                    "MediaPipe runtime is unavailable on the engine.",
                )
            raise  # caught by global handler
        except Exception as exc:
            _fail_scan_progress(str(exc))
            storage.delete_file(r2_key)
            # The stored object is gone; a local tmp copy (S3) is unlinked by the finally below.
            raise  # caught by global handler

        # Mark scan progress as complete
        _complete_scan_progress()

        # Evict old sessions before creating new one (memory optimization)
        with sessions_lock:
            evict_old_sessions_unlocked()
            if not append_to_session:
                sessions[session_token] = {
                    "video_key": r2_key,
                    "players": players,
                    "created_at": time.time(),
                }
            session = sessions.get(session_token)
            if session is None:
                # Evicted between checks — recreate it.
                session = {
                    "video_key": r2_key,
                    "players": players,
                    "created_at": time.time(),
                }
                sessions[session_token] = session
            append_angle(session, angle_label, r2_key, players)
            labels = angle_labels(session)
            # Re-uploading an angle replaces its file — delete the orphaned
            # previous upload now (the session only references the latest).
            previous = session.pop("_replaced_video_key", None)
        if previous and previous != r2_key:
            try:
                storage.delete_file(previous)
            except Exception as e:
                # Orphaned upload leaks storage — visible, not silent.
                logging.warning(f"orphaned upload cleanup failed for {previous}: {e}")
        # Warm cache for this video (makes subsequent analyses faster)
        # Must happen before local_path is deleted
        try:
            from core.cache import compute_video_hash, warm_cache_for_video
            video_hash = compute_video_hash(local_path)
            warm_cache_for_video(video_hash, local_path)
        except Exception as e:
            logging.warning(f"Cache warming failed: {e}")

        # Do NOT delete local_path here — storage.download_video_to_tmp now returns
        # the storage path directly (no copy), so local_path IS the stored file.
        # Source uploads live until their session is evicted (see
        # sessions.delete_session_files) so re-analysis keeps working.

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
                "angle": angle_label,
                "angles": labels,
                "player_count": len(response_players),
                "players": response_players,
                "media": media_info,
            },
        )
    finally:
        if not storage.is_local_backend():
            try:
                os.unlink(local_path)
            except OSError:
                pass


@router.post("/scan")
async def scan(
    video: UploadFile,
    session_token: str | None = Form(default=None),
    angle: str | None = Form(default=None),
) -> JSONResponse:
    logging.info(f"[SCAN] Received upload: filename={video.filename}, content_type={video.content_type}, size={video.size}")
    validation_error = _validate_video_upload(video)
    if validation_error:
        logging.info(f"[SCAN] Validation failed: {validation_error.body}")
        return validation_error

    # Resolve the session before streaming so the upload lands under its
    # namespaced key (raw/{session}/{angle}/...). An unknown token starts a
    # new session; angle labels are sanitized by the session layer.
    angle_label = normalize_angle_label(angle)
    with sessions_lock:
        existing = sessions.get(session_token) if session_token else None
    if existing is None:
        session_token = str(uuid.uuid4())

    # Stream upload to storage (memory-efficient for large files)
    r2_key = storage.raw_upload_key(session_token, angle_label)
    logging.info(f"[SCAN] Streaming upload to storage: {r2_key}")

    # Always stream to disk (memory optimization: remove 10MB threshold)
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
                    return error_response(
                        413,
                        "FILE_TOO_LARGE",
                        f"File exceeds maximum size of {max_upload_size // (1024*1024)}MB.",
                    )
                f.write(chunk)
        await video.close()
        logging.info(f"[SCAN] Streamed {os.path.getsize(temp_path)} bytes to temp file")

        # Upload from temp file
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
        # Clean up the uploaded file if download fails
        storage.delete_file(r2_key)
        raise
    logging.info(f"[SCAN] Saved to {local_path} ({os.path.getsize(local_path)} bytes)")

    return await _scan_stored_file(
        r2_key=r2_key,
        local_path=local_path,
        session_token=session_token,
        angle_label=angle_label,
        append_to_session=existing is not None,
    )


@router.post("/upload-intent")
async def upload_intent(request: Request) -> JSONResponse:
    """Mint a direct-to-storage upload slot (§8).

    Validates the client-declared metadata up front, resolves (or mints) the
    scan session, and returns a namespaced storage key plus the upload
    mechanism: presigned POST fields on the S3 backend, or the multipart
    /scan endpoint on local (the app server still proxies small uploads).
    The bytes themselves are always re-validated by ffprobe at scan time.
    """
    try:
        payload = await request.json()
    except Exception:
        return error_response(400, "INVALID_REQUEST", "Invalid JSON body")
    if not isinstance(payload, dict):
        return error_response(400, "INVALID_REQUEST", "Invalid JSON body")

    filename = payload.get("filename")
    mime_type = payload.get("mime_type")
    size_bytes = payload.get("size_bytes")
    if not isinstance(filename, str) or not filename.strip() or len(filename) > 255:
        return error_response(400, "INVALID_REQUEST", "filename (<=255 chars) required")
    if not isinstance(mime_type, str) or not mime_type.startswith("video/"):
        return error_response(400, "INVALID_FILE_TYPE", "Please upload a video file.")
    try:
        size = int(size_bytes)
    except (TypeError, ValueError):
        return error_response(400, "INVALID_REQUEST", "size_bytes (integer) required")
    max_upload_size = int(os.environ.get("MAX_FILE_SIZE", MAX_FILE_SIZE_BYTES))
    if size < 1 or size > max_upload_size:
        return error_response(
            413,
            "FILE_TOO_LARGE",
            f"File must be between 1 byte and {max_upload_size // (1024 * 1024)}MB.",
        )

    angle_label = normalize_angle_label(payload.get("angle"))
    with sessions_lock:
        existing = sessions.get(payload.get("session_token")) if payload.get("session_token") else None
    session_token = payload.get("session_token") if existing is not None else str(uuid.uuid4())

    key = storage.raw_upload_key(session_token, angle_label)
    if storage.is_local_backend():
        return JSONResponse(
            status_code=200,
            content={
                "key": key,
                "session_token": session_token,
                "angle": angle_label,
                "upload": {"mode": "multipart", "scan_url": "/scan"},
            },
        )
    try:
        presigned = storage.presigned_upload(key, mime_type)
    except Exception:
        logging.error(traceback.format_exc())
        return error_response(500, "STORAGE_ERROR", "Could not mint an upload URL. Please try again.")
    return JSONResponse(
        status_code=200,
        content={
            "key": key,
            "session_token": session_token,
            "angle": angle_label,
            "upload": {"mode": "presigned", "url": presigned["url"], "fields": presigned["fields"]},
        },
    )


_STORAGE_KEY_RE = re.compile(r"^raw/[A-Za-z0-9_@.|-]+/[a-z0-9_-]+/[a-f0-9]{32}\.mp4$")


@router.post("/scan-from-key")
async def scan_from_key(request: Request) -> JSONResponse:
    """Scan a video already in storage (after a direct upload, §8).

    Only keys minted by /upload-intent are accepted (raw/ prefix + strict
    shape) — never result keys or arbitrary paths.
    """
    try:
        payload = await request.json()
    except Exception:
        return error_response(400, "INVALID_REQUEST", "Invalid JSON body")
    if not isinstance(payload, dict):
        return error_response(400, "INVALID_REQUEST", "Invalid JSON body")

    storage_key = payload.get("storage_key")
    if not isinstance(storage_key, str) or not _STORAGE_KEY_RE.match(storage_key):
        return error_response(400, "INVALID_REQUEST", "storage_key must be an upload-intent key")

    angle_label = normalize_angle_label(payload.get("angle"))
    with sessions_lock:
        existing = sessions.get(payload.get("session_token")) if payload.get("session_token") else None
    session_token = payload.get("session_token") if existing is not None else str(uuid.uuid4())

    try:
        local_path = storage.download_video_to_tmp(storage_key)
    except FileNotFoundError:
        return error_response(
            404, "SESSION_EXPIRED", "Upload not found in storage. Please upload your video again."
        )
    except Exception:
        logging.error(traceback.format_exc())
        return error_response(500, "STORAGE_ERROR", "Could not read the uploaded video. Please try again.")

    return await _scan_stored_file(
        r2_key=storage_key,
        local_path=local_path,
        session_token=session_token,
        angle_label=angle_label,
        append_to_session=existing is not None,
    )


@router.get("/scan-progress/{session_token}")
async def scan_progress_endpoint(session_token: str, angle: str | None = None):
    """
    SSE endpoint for live scan progress updates.
    Client can listen for real-time frame scanning progress.
    `angle` selects which perspective's progress to stream (multi-angle
    sessions track each angle separately); it defaults to the primary angle.
    """
    angle_label = normalize_angle_label(angle)
    progress_key = scan_progress_key(session_token, angle_label)

    def _read_progress() -> dict[str, Any] | None:
        with scan_progress_lock:
            entry = scan_progress.get(progress_key)
            if entry is None and angle_label == "primary":
                # Back-compat: entries written before per-angle keys.
                entry = scan_progress.get(session_token)
            return dict(entry) if entry is not None else None

    async def event_generator():
        try:
            while True:
                try:
                    progress = _read_progress()

                    if progress is None:
                        # Session not found or expired
                        data = json.dumps({
                            "session_token": session_token,
                            "angle": angle_label,
                            "current": 0,
                            "total": 0,
                            "complete": True,
                            "error": "Session not found.",
                        })
                        yield f"data: {data}\n\n"
                        break

                    # Send progress update
                    data = json.dumps({
                        "session_token": session_token,
                        "angle": progress.get("angle", angle_label),
                        "current": progress["current"],
                        "total": progress["total"],
                        "complete": progress["complete"],
                        "error": progress["error"],
                    })
                    yield f"data: {data}\n\n"

                    # Check if done
                    if progress["complete"]:
                        break

                except Exception:
                    # Transient error, send current state and retry
                    progress = _read_progress() or {}
                    data = json.dumps({
                        "session_token": session_token,
                        "angle": progress.get("angle", angle_label),
                        "current": progress.get("current", 0),
                        "total": progress.get("total", 0),
                        "complete": progress.get("complete", False),
                        "error": progress.get("error"),
                    })
                    yield f"data: {data}\n\n"

                    if progress.get("complete"):
                        break

                await asyncio.sleep(0.5)  # Update every 500ms for smooth progress
        except asyncio.CancelledError:
            pass  # Client disconnected — clean up gracefully

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
