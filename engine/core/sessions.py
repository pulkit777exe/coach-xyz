"""A session groups the uploads (camera angles) scanned for one analysis.

Sessions live in the database, so a restart no longer loses them.
"""

import json
import re
import time
import uuid

from . import config, db, storage

PRIMARY = "primary"


def angle_label(value) -> str:
    if not isinstance(value, str):
        return PRIMARY
    return re.sub(r"[^a-z0-9_-]", "", value.strip().lower())[:32] or PRIMARY


def new_token() -> str:
    return uuid.uuid4().hex


def get(token: str | None) -> dict | None:
    if not token:
        return None
    row = db.one("SELECT data, created_at FROM sessions WHERE token=?", (token,))
    if not row or time.time() - row["created_at"] > config.settings.session_ttl_s:
        return None
    return json.loads(row["data"])


def save(token: str, data: dict) -> None:
    db.run(
        "INSERT INTO sessions(token, created_at, data) VALUES (?,?,?) "
        "ON CONFLICT(token) DO UPDATE SET data=excluded.data",
        (token, time.time(), db.dumps(data)),
    )


def add_angle(token: str, angle: str, entry: dict) -> str | None:
    """Store a scanned angle. Returns the storage key of an upload it replaced."""
    data = get(token) or {"angles": {}}
    previous = data["angles"].get(angle, {}).get("video_key")
    data["angles"][angle] = entry
    save(token, data)
    return previous if previous and previous != entry["video_key"] else None


def angle(token: str, label: str) -> tuple[str, dict] | None:
    """The requested angle, falling back to primary, then to whatever exists."""
    data = get(token)
    if not data or not data["angles"]:
        return None
    angles = data["angles"]
    for candidate in (label, PRIMARY):
        if candidate in angles:
            return candidate, angles[candidate]
    first = next(iter(angles))
    return first, angles[first]


def labels(token: str) -> list[str]:
    data = get(token)
    return list(data["angles"]) if data else []


def expire() -> int:
    """Drop expired sessions and the uploads they own."""
    cutoff = time.time() - config.settings.session_ttl_s
    store = storage.backend()
    dropped = 0
    for row in db.rows("SELECT token, data FROM sessions WHERE created_at < ?", (cutoff,)):
        for entry in json.loads(row["data"]).get("angles", {}).values():
            try:
                store.delete(entry["video_key"])
            except Exception:
                pass
        db.run("DELETE FROM sessions WHERE token=?", (row["token"],))
        dropped += 1
    return dropped
