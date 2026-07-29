"""
core/config.py — Shared configuration constants and utilities.

All environment-driven configuration lives here. Other modules import from here
instead of reading os.environ directly.
"""

import os

# ── Gemini Configuration ────────────────────────────────────────────────────

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

# ── File Limits ─────────────────────────────────────────────────────────────

MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024

# ── Timeouts ────────────────────────────────────────────────────────────────

FFMPEG_TIMEOUT_S = int(os.environ.get("FFMPEG_TIMEOUT_S", "300"))
ANALYSIS_TIMEOUT_S = int(os.environ.get("ANALYSIS_TIMEOUT_S", "600"))

# ── Shared Utilities ────────────────────────────────────────────────────────

def parse_timestamp(ts: str) -> float:
    """Convert 'M:SS.s' timestamp string to seconds."""
    try:
        parts = ts.split(":")
        if len(parts) == 2:
            return float(parts[0]) * 60 + float(parts[1])
        return float(ts)
    except (ValueError, IndexError):
        return 0.0
