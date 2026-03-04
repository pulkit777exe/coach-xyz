from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path
from typing import Any


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

R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID") or ""
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID") or ""
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY") or ""
R2_BUCKET = os.getenv("R2_BUCKET_NAME") or ""

R2_CONFIGURED = all([R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET])
STORAGE_BACKEND = (os.getenv("STORAGE_BACKEND") or ("r2" if R2_CONFIGURED else "local")).strip().lower()

if STORAGE_BACKEND not in {"local", "r2"}:
    STORAGE_BACKEND = "local"

if STORAGE_BACKEND == "r2" and not R2_CONFIGURED:
    raise RuntimeError(
        "STORAGE_BACKEND=r2 but one or more R2 env vars are missing: "
        "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME"
    )

client: Any = None
ClientError = Exception
if STORAGE_BACKEND == "r2":
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError as _ClientError

    ClientError = _ClientError
    client = boto3.client(
        "s3",
        endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def is_local_backend() -> bool:
    return STORAGE_BACKEND == "local"


def _key_to_local_path(key: str) -> Path:
    rel = Path(key.lstrip("/"))
    path = (LOCAL_STORAGE_ROOT / rel).resolve()
    if path != LOCAL_STORAGE_ROOT and LOCAL_STORAGE_ROOT not in path.parents:
        raise ValueError("Invalid storage key path")
    return path


def get_local_file_path(key: str) -> str | None:
    if not is_local_backend():
        return None
    path = _key_to_local_path(key)
    if not path.exists() or not path.is_file():
        return None
    return str(path)


def upload_video(file_bytes: bytes, key: str) -> str:
    if is_local_backend():
        local_path = _key_to_local_path(key)
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(file_bytes)
        return key

    client.put_object(Bucket=R2_BUCKET, Key=key, Body=file_bytes)
    return key


def download_video_to_tmp(key: str) -> str:
    fd, local_path = tempfile.mkstemp(suffix=".mp4")
    os.close(fd)

    if is_local_backend():
        source = _key_to_local_path(key)
        if not source.exists():
            raise FileNotFoundError(f"Storage object not found: {key}")
        shutil.copy2(source, local_path)
        return local_path

    client.download_file(R2_BUCKET, key, local_path)
    return local_path


def upload_result_video(local_path: str, job_id: str) -> str:
    key = f"results/{job_id}.mp4"

    if is_local_backend():
        dest = _key_to_local_path(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(local_path, dest)
        return key

    client.upload_file(local_path, R2_BUCKET, key)
    os.unlink(local_path)
    return key


def get_download_url(key: str, expires_in: int = 3600) -> str:
    if is_local_backend():
        raise RuntimeError("Presigned URL is not available in local storage mode")

    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": R2_BUCKET, "Key": key},
        ExpiresIn=expires_in,
    )


def delete_file(key: str) -> None:
    if is_local_backend():
        path = _key_to_local_path(key)
        path.unlink(missing_ok=True)
        return

    try:
        client.delete_object(Bucket=R2_BUCKET, Key=key)
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in {"NoSuchKey", "404"}:
            return
        raise
