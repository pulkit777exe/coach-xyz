from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import BinaryIO

from core.config import CHUNK_SIZE

# ── Bucket layout (§10 precursor) ────────────────────────────────────────────
# Keys are namespaced by artifact kind so a future object-store migration maps
# 1:1: raw/ (immutable source uploads, per session+angle), results/ (one
# rendered video per analysis job). Derived/preview artifacts go under the
# same roots as sibling prefixes when added.

RAW_PREFIX = "raw"
RESULTS_PREFIX = "results"


def raw_upload_key(session_token: str, angle: str) -> str:
    """Namespaced key for a source upload. UUID-suffixed so re-uploads of an
    angle never collide; the session record always points at the latest."""
    import uuid

    safe_angle = (angle or "primary").strip().lower() or "primary"
    return f"{RAW_PREFIX}/{session_token}/{safe_angle}/{uuid.uuid4().hex}.mp4"


def result_key(job_id: str) -> str:
    """Namespaced key for a rendered analysis video (one per job)."""
    return f"{RESULTS_PREFIX}/{job_id}.mp4"


ENGINE_ROOT = Path(__file__).resolve().parent.parent
TMP_ROOT = (ENGINE_ROOT / "tmp").resolve()
_local_storage_env = os.getenv("LOCAL_STORAGE_DIR")
if _local_storage_env:
    _local_storage_path = Path(_local_storage_env)
    if not _local_storage_path.is_absolute():
        _local_storage_path = ENGINE_ROOT / _local_storage_path
    LOCAL_STORAGE_ROOT = _local_storage_path.resolve()
else:
    LOCAL_STORAGE_ROOT = (TMP_ROOT / "storage").resolve()


def is_local_backend() -> bool:
    return True  # Always local on free tier


def _key_to_local_path(key: str) -> Path:
    """Convert a storage key to a local file path with path traversal protection."""
    rel = Path(key.lstrip("/"))
    path = (LOCAL_STORAGE_ROOT / rel).resolve()
    # Ensure the resolved path is within LOCAL_STORAGE_ROOT
    try:
        path.relative_to(LOCAL_STORAGE_ROOT)
    except ValueError:
        raise ValueError(f"Invalid storage key: path traversal detected in '{key}'")
    return path


def get_local_file_path(key: str) -> str | None:
    path = _key_to_local_path(key)
    if not path.exists() or not path.is_file():
        return None
    return str(path)


# ── Streaming Upload (Memory-Efficient) ─────────────────────────────────────


def upload_video_streaming(fileobj: BinaryIO, key: str) -> str:
    """
    Upload video using streaming for large files.
    Memory-efficient: never loads entire file into memory.
    """
    local_path = _key_to_local_path(key)
    local_path.parent.mkdir(parents=True, exist_ok=True)
    with open(local_path, "wb") as f:
        while True:
            chunk = fileobj.read(CHUNK_SIZE)
            if not chunk:
                break
            f.write(chunk)
    return key


def upload_video(file_bytes: bytes, key: str) -> str:
    """Upload video from bytes."""
    local_path = _key_to_local_path(key)
    local_path.parent.mkdir(parents=True, exist_ok=True)
    local_path.write_bytes(file_bytes)
    return key


# ── Streaming Download (Memory-Efficient) ───────────────────────────────────


def download_video_to_tmp(key: str) -> str:
    """Return the local path for a stored video.

    On the local backend both source and destination are on the same
    filesystem, so copying is wasteful.  We return the storage path
    directly and let callers treat it as read-only.  The caller is
    responsible for NOT deleting this path (use ``delete_file(key)``
    instead of unlinking the returned path directly).
    """
    source = _key_to_local_path(key)
    if not source.exists():
        raise FileNotFoundError(f"Storage object not found: {key}")
    return str(source)


def upload_result_video(local_path: str, job_id: str) -> str:
    key = result_key(job_id)
    dest = _key_to_local_path(key)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(local_path, dest)
    return key


def get_download_url(key: str, expires_in: int = 3600) -> str:
    """Local storage doesn't support presigned URLs."""
    raise RuntimeError("Presigned URL is not available in local storage mode")


def delete_file(key: str) -> None:
    path = _key_to_local_path(key)
    path.unlink(missing_ok=True)
