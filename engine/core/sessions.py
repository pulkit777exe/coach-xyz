"""
sessions.py — Engine scan-session lifecycle.

Owns the in-memory session registry: resolve-or-mint, scan-result storage,
scan-progress tracking, TTL eviction, and file teardown. Endpoints in main.py
cross this interface instead of touching module dicts and locks directly, so
lock discipline and expiry policy live in exactly one place.
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any, Optional

from core import storage
from core.multicam import angle_labels, append_angle, scan_progress_key

# Session management constants (memory optimization)
SESSION_TTL = 7200  # 2 hours (aligned with job TTL)
MAX_SESSIONS = 10  # Max concurrent sessions
SESSION_EVICTION_INTERVAL = 300  # Run eviction every 5 minutes
SCAN_PROGRESS_TTL = SESSION_TTL  # scan-progress dict entries expire with the session
COMPLETE_SCAN_PROGRESS_RETENTION = 300  # drop completed entries after 5 minutes

_sessions: dict[str, dict[str, Any]] = {}
_sessions_lock = threading.Lock()

# Scan progress tracking (keyed by session_token + angle)
_scan_progress: dict[str, dict[str, Any]] = {}
_scan_progress_lock = threading.Lock()


def resolve_session(session_token: str | None) -> tuple[str, Optional[dict[str, Any]]]:
    """Resolve-or-mint: return (token, existing session or None).

    An unknown or missing token mints a fresh uuid; the upload then lands
    under its namespaced key. All three scan entries share this path.
    """
    with _sessions_lock:
        existing = _sessions.get(session_token) if session_token else None
    if existing is None:
        return str(uuid.uuid4()), None
    return session_token, existing  # type: ignore[return-value]


def get_session(session_token: str) -> Optional[dict[str, Any]]:
    """Thread-safe session lookup (None when expired or unknown)."""
    with _sessions_lock:
        return _sessions.get(session_token)


def store_scan_result(
    session_token: str,
    video_key: str,
    players: list[dict[str, Any]],
    angle_label: str,
    append_to_session: bool,
) -> tuple[dict[str, Any], list[str], Optional[str]]:
    """Evict, then create-or-append the scan result; return (session, labels, replaced_key).

    The replaced key (re-uploaded angle orphaning its previous file) is
    returned — not deleted — so the caller drops it outside the lock.
    """
    with _sessions_lock:
        _evict_old_sessions_unlocked()
        if not append_to_session:
            _sessions[session_token] = {
                "video_key": video_key,
                "players": players,
                "created_at": time.time(),
            }
        session = _sessions.get(session_token)
        if session is None:
            # Evicted between checks — recreate it.
            session = {
                "video_key": video_key,
                "players": players,
                "created_at": time.time(),
            }
            _sessions[session_token] = session
        append_angle(session, angle_label, video_key, players)
        labels = angle_labels(session)
        # Re-uploading an angle replaces its file — surface the orphaned
        # previous upload now (the session only references the latest).
        previous = session.pop("_replaced_video_key", None)
    return session, labels, previous


def delete_session_files(session: Any) -> None:
    """Delete every upload backing an evicted session (all angles).

    Sessions own their source files: the analyzer no longer deletes uploads
    on completion so re-analysis works, which makes eviction the lifetime
    boundary (plus the shutdown sweep as a backstop).
    """
    if not isinstance(session, dict):
        return
    keys: set[str] = set()
    video_key = session.get("video_key")
    if video_key:
        keys.add(str(video_key))
    angles = session.get("angles")
    if isinstance(angles, dict):
        for entry in angles.values():
            if isinstance(entry, dict) and entry.get("video_key"):
                keys.add(str(entry["video_key"]))
    for key in keys:
        try:
            storage.delete_file(key)
        except Exception:
            pass


def _evict_old_sessions_unlocked() -> None:
    """Evict sessions older than SESSION_TTL and enforce MAX_SESSIONS limit.

    Must be called with _sessions_lock held.
    """
    now = time.time()
    # Remove expired sessions
    expired = [sid for sid, s in _sessions.items() if now - s.get("created_at", 0) > SESSION_TTL]
    for sid in expired:
        session = _sessions.pop(sid, None)
        delete_session_files(session)

    # Enforce max sessions limit (remove oldest first)
    while len(_sessions) > MAX_SESSIONS:
        oldest_sid = min(_sessions, key=lambda s: _sessions[s].get("created_at", 0))
        session = _sessions.pop(oldest_sid, None)
        delete_session_files(session)


def evict_old_sessions() -> None:
    """Thread-safe eviction of old sessions (plus scan-progress pruning)."""
    with _sessions_lock:
        _evict_old_sessions_unlocked()
    evict_old_scan_progress()


def evict_old_scan_progress() -> None:
    """Prune scan-progress dict so finished/stale scans do not accumulate in memory."""
    now = time.time()
    with _scan_progress_lock:
        stale = [
            sid
            for sid, p in _scan_progress.items()
            if now - p.get("started_at", 0) > SCAN_PROGRESS_TTL
            or (p.get("complete") and now - p.get("started_at", 0) > COMPLETE_SCAN_PROGRESS_RETENTION)
        ]
        for sid in stale:
            _scan_progress.pop(sid, None)


def init_scan_progress(session_token: str, angle_label: str) -> str:
    """Register a scan-progress entry; returns its per-angle progress key."""
    progress_key = scan_progress_key(session_token, angle_label)
    with _scan_progress_lock:
        _scan_progress[progress_key] = {
            "session_token": session_token,
            "current": 0,
            "total": 0,
            "complete": False,
            "error": None,
            "angle": angle_label,
            "started_at": time.time(),
        }
    return progress_key


def report_scan_progress(progress_key: str, current: int, total: int) -> None:
    with _scan_progress_lock:
        if progress_key in _scan_progress:
            _scan_progress[progress_key]["current"] = current
            _scan_progress[progress_key]["total"] = total


def fail_scan_progress(progress_key: str, message: str) -> None:
    with _scan_progress_lock:
        if progress_key in _scan_progress:
            _scan_progress[progress_key]["complete"] = True
            _scan_progress[progress_key]["error"] = message


def complete_scan_progress(progress_key: str) -> None:
    with _scan_progress_lock:
        if progress_key in _scan_progress:
            _scan_progress[progress_key]["complete"] = True
            _scan_progress[progress_key]["error"] = None


def read_scan_progress(session_token: str, angle_label: str) -> Optional[dict[str, Any]]:
    """Thread-safe progress read (copy); falls back to the pre-angle key."""
    progress_key = scan_progress_key(session_token, angle_label)
    with _scan_progress_lock:
        entry = _scan_progress.get(progress_key)
        if entry is None and angle_label == "primary":
            # Back-compat: entries written before per-angle keys.
            entry = _scan_progress.get(session_token)
        return dict(entry) if entry is not None else None
