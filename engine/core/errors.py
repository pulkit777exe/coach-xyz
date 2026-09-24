from __future__ import annotations

from dataclasses import dataclass


@dataclass
class EngineError(Exception):
    """Base error for all engine failures. Every error has a code, message, and retryable flag."""
    code: str
    message: str
    retryable: bool = True

    def __post_init__(self) -> None:
        super().__init__(self.message)

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "message": self.message,
            "layer": "engine",
            "retryable": self.retryable,
        }


# ── HTTP Status Registry ─────────────────────────────────────────────────────
# The engine owns the code → HTTP status mapping so the queue and callers can
# rely on one source of truth. Codes not listed here fall back to 422 when
# retryable, 500 otherwise (see error_status()).

STATUS_BY_CODE = {
    "NO_PLAYERS_DETECTED": 400,
    "VIDEO_DECODE_FAILED": 400,
    "VIDEO_EXPIRED": 400,
    "VIDEO_NOT_FOUND": 404,
    "JOB_NOT_FOUND": 404,
    "GEMINI_QUOTA_EXCEEDED": 429,
    "GEMINI_TIMEOUT": 504,
    "GEMINI_PARSE_FAILED": 500,
    "GEMINI_PROCESSING_FAILED": 500,
    "MEDIAPIPE_UNAVAILABLE": 503,
    "REDIS_UNAVAILABLE": 503,
    "STORAGE_ERROR": 503,
    "ENGINE_UNAVAILABLE": 503,
}


def error_status(exc: EngineError) -> int:
    """HTTP status for an engine error. Unknown codes fall back on retryability."""
    return STATUS_BY_CODE.get(exc.code, 422 if exc.retryable else 500)


# ── Retryability Registry ─────────────────────────────────────────────────────
# The engine owns code → retryable, ONE entry per code. The error classes
# below derive their `retryable` flag from this table, and api/errors.py's
# error_response() renders the wire field from it (error_retryable) — so a
# body's {code, retryable} no longer depends on which rendering path produced
# it (error_response vs the EngineError handler in main.py). Codes without an
# entry (proxy/validation codes such as FORBIDDEN, FILE_TOO_LARGE,
# GEMINI_NOT_CONFIGURED) carry no engine intent and fall back on the HTTP
# status in error_retryable() — the same value error_response produced before
# this table existed, so no current call site changes its wire behavior.

RETRYABLE_BY_CODE = {
    "NO_PLAYERS_DETECTED": True,
    "VIDEO_DECODE_FAILED": False,
    "VIDEO_EXPIRED": False,
    "VIDEO_NOT_FOUND": False,
    "JOB_NOT_FOUND": False,
    "INVALID_REQUEST": False,
    "INVALID_STATE_TRANSITION": False,
    "GEMINI_QUOTA_EXCEEDED": True,
    "GEMINI_TIMEOUT": True,
    "GEMINI_PARSE_FAILED": True,
    "GEMINI_PROCESSING_FAILED": True,
    "MEDIAPIPE_UNAVAILABLE": False,
    "REDIS_UNAVAILABLE": False,
    "STORAGE_ERROR": True,
    "ENGINE_UNAVAILABLE": True,
}


def error_retryable(code: str, status_code: int) -> bool:
    """Wire `retryable` for a rendered error body.

    The registry owns known codes; unregistered codes fall back on the status
    (5xx is transient) — the pre-registry derivation, kept only as the default
    for codes the engine has no explicit intent for.
    """
    return RETRYABLE_BY_CODE.get(code, status_code >= 500)


# ── Validation Errors ─────────────────────────────────────────────────────────

# Each class's `retryable` reads RETRYABLE_BY_CODE — the registry above is the
# single declaration; the classes carry code + message only.


class InvalidRequestError(EngineError):
    def __init__(self, detail: str = "") -> None:
        super().__init__(
            code="INVALID_REQUEST",
            message=detail or "Invalid request format.",
            retryable=RETRYABLE_BY_CODE["INVALID_REQUEST"],
        )


class NoPlayersDetectedError(EngineError):
    def __init__(self, detail: str = "") -> None:
        super().__init__(
            code="NO_PLAYERS_DETECTED",
            message=detail or "No players detected. Try better lighting or a less crowded frame.",
            retryable=RETRYABLE_BY_CODE["NO_PLAYERS_DETECTED"],
        )


# ── Video Errors ──────────────────────────────────────────────────────────────

class VideoDecodeError(EngineError):
    def __init__(self, detail: str = "") -> None:
        super().__init__(
            code="VIDEO_DECODE_FAILED",
            message=detail or "Could not read this video. Try MP4 or MOV format.",
            # A corrupt video will not decode on retry (registry: False)
            retryable=RETRYABLE_BY_CODE["VIDEO_DECODE_FAILED"],
        )


# ── Gemini Errors ─────────────────────────────────────────────────────────────

class GeminiQuotaError(EngineError):
    def __init__(self, detail: str = "") -> None:
        super().__init__(
            code="GEMINI_QUOTA_EXCEEDED",
            message=detail or "AI quota reached. Try again in a few minutes.",
            retryable=RETRYABLE_BY_CODE["GEMINI_QUOTA_EXCEEDED"],
        )


class GeminiTimeoutError(EngineError):
    def __init__(self, detail: str = "") -> None:
        super().__init__(
            code="GEMINI_TIMEOUT",
            message=detail or "AI analysis timed out. Try a shorter video.",
            retryable=RETRYABLE_BY_CODE["GEMINI_TIMEOUT"],
        )


class GeminiProcessingError(EngineError):
    def __init__(self, detail: str = "") -> None:
        super().__init__(
            code="GEMINI_PROCESSING_FAILED",
            message=detail or "AI video processing failed. Try again.",
            retryable=RETRYABLE_BY_CODE["GEMINI_PROCESSING_FAILED"],
        )


class GeminiParseError(EngineError):
    def __init__(self, detail: str = "") -> None:
        super().__init__(
            code="GEMINI_PARSE_FAILED",
            message=detail or "AI returned unexpected response. Try again.",
            retryable=RETRYABLE_BY_CODE["GEMINI_PARSE_FAILED"],
        )


# ── State Errors ──────────────────────────────────────────────────────────────

class JobNotFoundError(EngineError):
    def __init__(self, detail: str = "") -> None:
        super().__init__(
            code="JOB_NOT_FOUND",
            message=detail or "Session expired. Please upload your video again.",
            retryable=RETRYABLE_BY_CODE["JOB_NOT_FOUND"],
        )


class InvalidStateTransition(EngineError):
    def __init__(self, from_state: str, to_state: str) -> None:
        super().__init__(
            code="INVALID_STATE_TRANSITION",
            message=f"Cannot transition from '{from_state}' to '{to_state}'. Please retry.",
            retryable=RETRYABLE_BY_CODE["INVALID_STATE_TRANSITION"],
        )


# ── Infrastructure Errors ─────────────────────────────────────────────────────

class RedisUnavailableError(EngineError):
    def __init__(self) -> None:
        super().__init__(
            code="REDIS_UNAVAILABLE",
            message="Job storage is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
            retryable=RETRYABLE_BY_CODE["REDIS_UNAVAILABLE"],
        )


class MediaPipeUnavailableError(EngineError):
    def __init__(self) -> None:
        super().__init__(
            code="MEDIAPIPE_UNAVAILABLE",
            message="Player detection is unavailable. Please try again.",
            retryable=RETRYABLE_BY_CODE["MEDIAPIPE_UNAVAILABLE"],
        )


class StorageError(EngineError):
    def __init__(self, detail: str = "") -> None:
        super().__init__(
            code="STORAGE_ERROR",
            message=detail or "Failed to save video. Please try again.",
            retryable=RETRYABLE_BY_CODE["STORAGE_ERROR"],
        )


class VideoNotFoundError(EngineError):
    def __init__(self) -> None:
        super().__init__(
            code="VIDEO_NOT_FOUND",
            message="Rendered video is not available yet.",
            retryable=RETRYABLE_BY_CODE["VIDEO_NOT_FOUND"],
        )


class VideoExpiredError(EngineError):
    def __init__(self) -> None:
        super().__init__(
            code="VIDEO_EXPIRED",
            message="This video is no longer available. The server may have restarted. Please upload your video again.",
            retryable=RETRYABLE_BY_CODE["VIDEO_EXPIRED"],
        )
