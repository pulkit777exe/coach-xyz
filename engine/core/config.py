"""
core/config.py — Shared configuration constants and utilities.

All environment-driven configuration lives here. Other modules import from here
instead of reading os.environ directly.
"""

import os

# ── Gemini Configuration ────────────────────────────────────────────────────

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

# ── Version Registry (§22 precursor) ─────────────────────────────────────────
# Stamped into every analysis summary as `provenance` so a report stays
# explainable after upgrades. Bump the prompt versions when prompt text
# changes; bump sport-pack versions in sports/*.json alongside criteria edits.

ENGINE_VERSION = "0.2.0"
ANALYSIS_PROMPT_VERSION = "1"
CHAT_PROMPT_VERSION = "2"

# ── File Limits ─────────────────────────────────────────────────────────────

MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024
CHUNK_SIZE = 8 * 1024 * 1024  # 8MB streaming chunk size

# ── Timeouts ────────────────────────────────────────────────────────────────

FFMPEG_TIMEOUT_S = int(os.environ.get("FFMPEG_TIMEOUT_S", "300"))

# Upper bound for one conversational Gemini round-trip. The server gives /chat
# 60s and /chat/stream 120s; the engine deadline sits inside both so a hung
# model call surfaces as a structured error instead of a hung SSE stream.
CHAT_GEMINI_TIMEOUT_S = int(os.environ.get("CHAT_GEMINI_TIMEOUT_S", "100"))

# Upper bound for the analysis Gemini call (multimodal, up to 20 frames). The
# server gives /analyze 12 minutes; this deadline sits inside it so a hung
# model call fails the job with a retryable error instead of wedging the
# worker until BullMQ's stuck-job recovery fires.
GEMINI_ANALYSIS_TIMEOUT_S = int(os.environ.get("GEMINI_ANALYSIS_TIMEOUT_S", "600"))

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
