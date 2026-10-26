"""Object storage: local disk by default, S3-compatible when configured.

Keys look like `raw/<session>/<angle>/<uuid>.mp4` (uploads) and
`results/<job>/<name>` (outputs).
"""

import contextlib
import shutil
import tempfile
import uuid
from pathlib import Path

from . import config


def raw_key(session: str, angle: str) -> str:
    return f"raw/{session}/{angle}/{uuid.uuid4().hex}.mp4"


def result_key(job_id: str, name: str) -> str:
    return f"results/{job_id}/{name}"


class Local:
    name = "local"

    def __init__(self) -> None:
        self.root = (config.settings.data_dir / "objects").resolve()

    def path(self, key: str) -> Path:
        p = (self.root / key.lstrip("/")).resolve()
        if self.root not in p.parents:
            raise ValueError(f"bad storage key: {key}")
        return p

    def put(self, key: str, src: str) -> None:
        dest = self.path(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(src, dest)

    def exists(self, key: str) -> bool:
        return self.path(key).is_file()

    def delete(self, key: str) -> None:
        self.path(key).unlink(missing_ok=True)

    def delete_prefix(self, prefix: str) -> None:
        shutil.rmtree(self.path(prefix), ignore_errors=True)

    @contextlib.contextmanager
    def local_copy(self, key: str):
        p = self.path(key)
        if not p.is_file():
            raise FileNotFoundError(key)
        yield str(p)

    def serve(self, key: str) -> tuple[str, str]:
        p = self.path(key)
        if not p.is_file():
            raise FileNotFoundError(key)
        return "file", str(p)

    def upload_slot(self, key: str, mime: str) -> dict:
        return {"mode": "multipart", "scan_url": "/scan"}


class S3(Local):
    name = "s3"

    def __init__(self) -> None:
        super().__init__()
        import boto3

        s = config.settings
        self.bucket = s.s3_bucket
        self.client = boto3.client("s3", region_name=s.s3_region or None, endpoint_url=s.s3_endpoint or None)

    def put(self, key: str, src: str) -> None:
        self.client.upload_file(src, self.bucket, key)

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:
            return False

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def delete_prefix(self, prefix: str) -> None:
        listing = self.client.list_objects_v2(Bucket=self.bucket, Prefix=prefix)
        for obj in listing.get("Contents", []):
            self.client.delete_object(Bucket=self.bucket, Key=obj["Key"])

    @contextlib.contextmanager
    def local_copy(self, key: str):
        tmp = tempfile.NamedTemporaryFile(suffix=Path(key).suffix, delete=False)
        tmp.close()
        try:
            self.client.download_file(self.bucket, key, tmp.name)
            yield tmp.name
        finally:
            Path(tmp.name).unlink(missing_ok=True)

    def serve(self, key: str) -> tuple[str, str]:
        url = self.client.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=3600
        )
        return "url", url

    def upload_slot(self, key: str, mime: str) -> dict:
        post = self.client.generate_presigned_post(
            Bucket=self.bucket, Key=key, Fields={"Content-Type": mime},
            Conditions=[["content-length-range", 1, config.settings.max_upload_bytes], {"Content-Type": mime}],
            ExpiresIn=3600,
        )
        return {"mode": "presigned", "url": post["url"], "fields": post["fields"]}


def backend() -> Local:
    return S3() if config.settings.storage_backend == "s3" else Local()
