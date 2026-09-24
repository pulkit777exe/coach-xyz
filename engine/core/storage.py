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
    return _backend() == "local"


def _backend() -> str:
    return (os.getenv("STORAGE_BACKEND") or "local").strip().lower()


def _s3_bucket() -> str:
    bucket = (os.getenv("S3_BUCKET") or "").strip()
    if not bucket:
        raise RuntimeError("S3_BUCKET is not configured")
    return bucket


def _s3_client():
    """Lazily imported so local-only deploys never need boto3 installed."""
    try:
        import boto3
    except ImportError as exc:
        raise RuntimeError("boto3 is required for STORAGE_BACKEND=s3") from exc
    kwargs: dict[str, str] = {}
    region = (os.getenv("S3_REGION") or "").strip()
    if region:
        kwargs["region_name"] = region
    endpoint = (os.getenv("S3_ENDPOINT_URL") or "").strip()
    if endpoint:
        kwargs["endpoint_url"] = endpoint
    return boto3.client("s3", **kwargs)


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

    Local backend: both source and destination are on the same filesystem,
    so copying is wasteful — return the storage path directly (read-only).
    S3 backend: download the object into the shared tmp dir.
    """
    if is_local_backend():
        source = _key_to_local_path(key)
        if not source.exists():
            raise FileNotFoundError(f"Storage object not found: {key}")
        return str(source)
    dest = TMP_ROOT / "s3" / Path(key).name
    dest.parent.mkdir(parents=True, exist_ok=True)
    _s3_client().download_file(_s3_bucket(), key, str(dest))
    return str(dest)


def upload_result_video(local_path: str, job_id: str) -> str:
    key = result_key(job_id)
    if is_local_backend():
        dest = _key_to_local_path(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(local_path, dest)
        return key
    _s3_client().upload_file(local_path, _s3_bucket(), key)
    try:
        os.unlink(local_path)
    except FileNotFoundError:
        pass
    return key


def delete_file(key: str) -> None:
    if is_local_backend():
        path = _key_to_local_path(key)
        path.unlink(missing_ok=True)
        return
    _s3_client().delete_object(Bucket=_s3_bucket(), Key=key)


def presigned_upload(key: str, mime_type: str, expires_in: int = 3600) -> dict[str, object]:
    """Presigned POST for browser-direct upload (§8). S3 backend only."""
    conditions: list[object] = [
        ["content-length-range", 1, 500 * 1024 * 1024],
        {"Content-Type": mime_type},
    ]
    post = _s3_client().generate_presigned_post(
        Bucket=_s3_bucket(),
        Key=key,
        Fields={"Content-Type": mime_type},
        Conditions=conditions,
        ExpiresIn=expires_in,
    )
    return {"url": post["url"], "fields": post["fields"], "key": key}


def presigned_download(key: str, expires_in: int = 3600) -> str:
    """Presigned GET for browser-direct download. S3 backend only."""
    return _s3_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": _s3_bucket(), "Key": key},
        ExpiresIn=expires_in,
    )
