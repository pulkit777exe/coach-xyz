"""core/multicam.py — multi-perspective (multi-camera-angle) session helpers.

A scan session can accumulate several camera angles of the same drill
(e.g. "front" + "side"). Each angle is an independent upload + player
detection; analysis then runs on the coach-selected angle. Pure functions so
they are unit-testable without the FastAPI app or MediaPipe.
"""

from __future__ import annotations

import re
from typing import Any

PRIMARY_ANGLE = "primary"

_ANGLE_RE = re.compile(r"[^a-z0-9_-]")


def normalize_angle_label(angle: Any) -> str:
    """Coerce a client-supplied angle label to a safe session key."""
    if not isinstance(angle, str):
        return PRIMARY_ANGLE
    cleaned = _ANGLE_RE.sub("", angle.strip().lower())[:32]
    return cleaned or PRIMARY_ANGLE


def scan_progress_key(session_token: str, angle: Any) -> str:
    """Progress-dict key for one angle scan.

    Per-angle keys keep concurrent perspectives on one session from
    overwriting each other's progress slot.
    """
    return f"{session_token}:{normalize_angle_label(angle)}"


def angle_labels(session: dict[str, Any]) -> list[str]:
    """Angle labels in insertion order (primary first)."""
    angles = session.get("angles")
    if isinstance(angles, dict) and angles:
        return list(angles.keys())
    return [PRIMARY_ANGLE]


def append_angle(
    session: dict[str, Any],
    angle: str,
    video_key: str,
    players: list[dict[str, Any]],
) -> dict[str, Any]:
    """Record a scanned angle on the session (mutates and returns it).

    The first angle also seeds the legacy top-level `video_key`/`players`
    fields so single-angle clients keep working unchanged.
    """
    label = normalize_angle_label(angle)
    angles = session.get("angles")
    if not isinstance(angles, dict):
        angles = {}
        session["angles"] = angles
    previous = angles.get(label)
    if (
        isinstance(previous, dict)
        and previous.get("video_key")
        and previous.get("video_key") != video_key
    ):
        # Re-uploaded angle — the caller deletes this orphaned file.
        session["_replaced_video_key"] = previous.get("video_key")
    angles[label] = {"video_key": video_key, "players": players}
    if label == PRIMARY_ANGLE or "video_key" not in session:
        session["video_key"] = video_key
        session["players"] = players
    return session


def resolve_angle_video_key(session: dict[str, Any], angle: Any) -> str | None:
    """Video key for the requested angle (None when unknown)."""
    label = normalize_angle_label(angle)
    angles = session.get("angles")
    if isinstance(angles, dict) and label in angles:
        return angles[label].get("video_key")
    if label == PRIMARY_ANGLE:
        video_key = session.get("video_key")
        return str(video_key) if video_key else None
    return None


def resolve_angle_players(session: dict[str, Any], angle: Any) -> list[dict[str, Any]] | None:
    """Detected players for the requested angle (None when unknown)."""
    label = normalize_angle_label(angle)
    angles = session.get("angles")
    if isinstance(angles, dict) and label in angles:
        players = angles[label].get("players")
        return list(players) if isinstance(players, list) else []
    if label == PRIMARY_ANGLE:
        players = session.get("players")
        return list(players) if isinstance(players, list) else []
    return None
