"""Serving result artefacts without letting a caller escape the result prefix."""

import mimetypes
import re

from fastapi.responses import FileResponse, RedirectResponse

from core import storage
from core.errors import invalid, not_found

FILE_NAME = re.compile(r"^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)?$")


def serve(job_id: str, name: str):
    """Inline a stored result file, or redirect to its presigned URL on S3."""
    if not FILE_NAME.match(name) or ".." in name:
        raise invalid("bad file name")
    try:
        kind, target = storage.backend().serve(storage.result_key(job_id, name))
    except FileNotFoundError:
        raise not_found("FILE_NOT_FOUND", "File not available.") from None
    if kind == "url":
        return RedirectResponse(target, status_code=302)
    media = mimetypes.guess_type(name)[0] or "application/octet-stream"
    return FileResponse(
        target,
        media_type=media,
        headers={"Content-Disposition": f'inline; filename="{name.split("/")[-1]}"'},
    )
