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


# ── Backend seam ─────────────────────────────────────────────────────────────
# Local-vs-S3 differences live behind StorageBackend so callers use
# capability methods (download_to_tmp, discard_tmp_copy, mint_upload,
# resolve_download) instead of branching on is_local_backend(). The
# module-level functions below stay as thin delegates so existing import
# sites (CLI, tests, sessions teardown) keep working.


class LocalBackend:
    """Filesystem backend: storage paths are used in place (never copied)."""

    name = "local"

    def download_to_tmp(self, key: str) -> str:
        source = _key_to_local_path(key)
        if not source.exists():
            raise FileNotFoundError(f"Storage object not found: {key}")
        return str(source)

    def upload_result(self, local_path: str, job_id: str) -> str:
        key = result_key(job_id)
        dest = _key_to_local_path(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(local_path, dest)
        return key

    def delete(self, key: str) -> None:
        _key_to_local_path(key).unlink(missing_ok=True)

    def local_path_or_none(self, key: str) -> str | None:
        return get_local_file_path(key)

    def discard_tmp_copy(self, path: str | None) -> None:
        # Local downloads ARE the stored file — never delete.
        return None

    def mint_upload(self, key: str, mime_type: str) -> dict[str, object]:
        return {"mode": "multipart"}

    def resolve_download(self, key: str) -> tuple[str, str]:
        path = get_local_file_path(key)
        if path is None:
            raise FileNotFoundError(f"Storage object not found: {key}")
        return ("file", path)


class S3Backend:
    """Object-store backend: downloads are throwaway tmp copies."""

    name = "s3"

    def download_to_tmp(self, key: str) -> str:
        dest = TMP_ROOT / "s3" / Path(key).name
        dest.parent.mkdir(parents=True, exist_ok=True)
        _s3_client().download_file(_s3_bucket(), key, str(dest))
        return str(dest)

    def upload_result(self, local_path: str, job_id: str) -> str:
        key = result_key(job_id)
        _s3_client().upload_file(local_path, _s3_bucket(), key)
        try:
            os.unlink(local_path)
        except FileNotFoundError:
            pass
        return key

    def delete(self, key: str) -> None:
        _s3_client().delete_object(Bucket=_s3_bucket(), Key=key)

    def local_path_or_none(self, key: str) -> str | None:
        return None

    def discard_tmp_copy(self, path: str | None) -> None:
        if not path:
            return None
        # Only unlink copies we made (under the shared tmp dir) — never
        # arbitrary paths.
        try:
            Path(path).resolve().relative_to(TMP_ROOT.resolve())
        except ValueError:
            return None
        try:
            os.unlink(path)
        except OSError:
            pass
        return None

    def mint_upload(self, key: str, mime_type: str) -> dict[str, object]:
        post = presigned_upload(key, mime_type)
        return {"mode": "presigned", "url": post["url"], "fields": post["fields"]}

    def resolve_download(self, key: str) -> tuple[str, str]:
        return ("url", presigned_download(key))


def get_backend() -> LocalBackend | S3Backend:
    """Active backend from STORAGE_BACKEND (read per call so tests can flip env)."""
    return S3Backend() if _backend() == "s3" else LocalBackend()


def discard_tmp_copy(path: str | None) -> None:
    """Drop a path returned by download_video_to_tmp (no-op unless a copy)."""
    get_backend().discard_tmp_copy(path)


def mint_upload(key: str, mime_type: str) -> dict[str, object]:
    """Upload descriptor for /upload-intent (multipart locally, presigned on S3)."""
    return get_backend().mint_upload(key, mime_type)


def resolve_download(key: str) -> tuple[str, str]:
    """Resolve a result key to ("file", path) or ("url", presigned URL).

    Raises FileNotFoundError when a local result is gone (S3 failures
    surface as the client's own exception).
    """
    return get_backend().resolve_download(key)


def download_video_to_tmp(key: str) -> str:
    """Return the local path for a stored video.

    Local backend: both source and destination are on the same filesystem,
    so copying is wasteful — return the storage path directly (read-only).
    S3 backend: download the object into the shared tmp dir.
    """
    return get_backend().download_to_tmp(key)


def upload_result_video(local_path: str, job_id: str) -> str:
    return get_backend().upload_result(local_path, job_id)


def get_download_url(key: str, expires_in: int = 3600) -> str:
    """Local storage doesn't support presigned URLs."""
    raise RuntimeError("Presigned URL is not available in local storage mode")


def delete_file(key: str) -> None:
    get_backend().delete(key)


def get_local_file_path_or_none(key: str) -> str | None:
    """Local path only when the backend is local and the file exists."""
    return get_backend().local_path_or_none(key)


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
