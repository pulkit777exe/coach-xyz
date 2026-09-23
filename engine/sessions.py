"""sessions.py — In-memory scan-session store and lifetime management.

One shared store behind every router (scan intake, analyze resolution, the
eviction loop in the app lifespan): sessions own their source uploads, so
eviction is the lifetime boundary (plus the shutdown sweep as a backstop).
Scan-progress entries live here too and expire with the session.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Dict

from core import storage

# Session management constants (memory optimization)
SESSION_TTL = 7200  # 2 hours (aligned with job TTL)
MAX_SESSIONS = 10  # Max concurrent sessions
SESSION_EVICTION_INTERVAL = 300  # Run eviction every 5 minutes
SCAN_PROGRESS_TTL = SESSION_TTL  # scan-progress dict entries expire with the session
COMPLETE_SCAN_PROGRESS_RETENTION = 300  # drop completed entries after 5 minutes

sessions: Dict[str, Dict[str, Any]] = {}
sessions_lock = threading.Lock()

# Scan progress tracking (keyed by session_token)
scan_progress: Dict[str, Dict[str, Any]] = {}
scan_progress_lock = threading.Lock()


def delete_session_files(session: dict[str, Any]) -> None:
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


def evict_old_sessions_unlocked() -> None:
    """Evict sessions older than SESSION_TTL and enforce MAX_SESSIONS limit.

    Must be called with sessions_lock held.
    """
    now = time.time()
    # Remove expired sessions
    expired = [sid for sid, s in sessions.items()
               if now - s.get("created_at", 0) > SESSION_TTL]
    for sid in expired:
        session = sessions.pop(sid, None)
        delete_session_files(session)

    # Enforce max sessions limit (remove oldest first)
    while len(sessions) > MAX_SESSIONS:
        oldest_sid = min(sessions, key=lambda s: sessions[s].get("created_at", 0))
        session = sessions.pop(oldest_sid, None)
        delete_session_files(session)


def evict_old_sessions() -> None:
    """Thread-safe eviction of old sessions."""
    with sessions_lock:
        evict_old_sessions_unlocked()
    evict_old_scan_progress()


def evict_old_scan_progress() -> None:
    """Prune scan-progress dict so finished/stale scans do not accumulate in memory."""
    now = time.time()
    with scan_progress_lock:
        stale = [
            sid
            for sid, p in scan_progress.items()
            if now - p.get("started_at", 0) > SCAN_PROGRESS_TTL
            or (p.get("complete") and now - p.get("started_at", 0) > COMPLETE_SCAN_PROGRESS_RETENTION)
        ]
        for sid in stale:
            scan_progress.pop(sid, None)
