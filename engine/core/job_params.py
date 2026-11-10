"""Resolve job creation requests into immutable pipeline params.

Separated from HTTP routes so orchestration/param building lives in core while
routes stay thin adapters.
"""

import re

from pydantic import BaseModel, Field

from . import sessions, sports
from .errors import EngineError, invalid

RAW_KEY = re.compile(r"^raw/[A-Za-z0-9_@.|-]+/[a-z0-9_-]+/[a-f0-9]{32}\.mp4$")


class JobRequest(BaseModel):
    job_id: str | None = Field(
        default=None, max_length=80, pattern=r"^[A-Za-z0-9_.:-]+$"
    )
    session_token: str | None = Field(default=None, max_length=80)
    video_key: str | None = None
    sha256: str | None = None
    angle: str | None = None
    player_index: int | None = None
    sport: str | None = None
    render: bool = True
    callback_url: str | None = None
    meta: dict = Field(default_factory=dict)


def build_params(req: JobRequest) -> dict:
    """Resolve a request into the immutable params the pipeline runs on."""
    angle = sessions.angle_label(req.angle)
    sport = (req.sport or "").lower()
    if sport and sport not in sports.KNOWN:
        raise invalid(f"sport must be one of {', '.join(sports.KNOWN)}")
    params = {
        "angle": angle,
        "sport": sport,
        "render": req.render,
        "meta": req.meta,
        "player": None,
    }
    if req.session_token:
        found = sessions.angle(req.session_token, angle)
        if not found:
            raise EngineError(
                "SESSION_EXPIRED",
                "Session expired. Please upload your video again.",
                status=404,
            )
        params["angle"], entry = found
        params.update(video_key=entry["video_key"], sha256=entry.get("sha256"))
        if req.player_index is not None:
            params["player"] = next(
                (p for p in entry["players"] if p["player_index"] == req.player_index),
                None,
            )
            if params["player"] is None:
                raise invalid("player_index was not found in this scan")
    elif req.video_key and RAW_KEY.match(req.video_key):
        params.update(video_key=req.video_key, sha256=req.sha256)
    else:
        raise invalid("session_token or an upload key is required")
    return params
