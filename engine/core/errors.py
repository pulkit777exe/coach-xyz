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


# ── Validation Errors ─────────────────────────────────────────────────────────

class InvalidRequestError(EngineError):
    def __init__(self, detail: str = "") -> None:
        super().__init__(
            code="INVALID_REQUEST",
            message=detail or "Invalid request format.",
            retryable=False,
        )


class NoPlayersDetectedError(EngineError):
    def __init__(self, detail: str = "") -> None:
        super().__init__(
            code="NO_PLAYERS_DETECTED",
            message=detail or "No players detected. Try better lighting or a less crowded frame.",
            retryable=True,
        )


# ── Video Errors ──────────────────────────────────────────────────────────────

class VideoDecodeError(EngineError):
    def __init__(self, detail: str = "") -> None:
        super().__init__(
            code="VIDEO_DECODE_FAILED",
            message=detail or "Could not read this video. Try MP4 or MOV format.",
            retryable=True,
        )


# ── Gemini Errors ─────────────────────────────────────────────────────────────

class GeminiQuotaError(EngineError):
    def __init__(self, detail: str = "") -> None:
        super().__init__(
            code="GEMINI_QUOTA_EXCEEDED",
            message=detail or "AI quota reached. Try again in a few minutes.",
            retryable=True,
        )


class GeminiTimeoutError(EngineError):
    def __init__(self, detail: str = "") -> None:
        super().__init__(
            code="GEMINI_TIMEOUT",
            message=detail or "AI analysis timed out. Try a shorter video.",
            retryable=True,
        )


class GeminiProcessingError(EngineError):
    def __init__(self, detail: str = "") -> None:
        super().__init__(
            code="GEMINI_PROCESSING_FAILED",
            message=detail or "AI video processing failed. Try again.",
            retryable=True,
        )


class GeminiParseError(EngineError):
    def __init__(self, detail: str = "") -> None:
        super().__init__(
            code="GEMINI_PARSE_FAILED",
            message=detail or "AI returned unexpected response. Try again.",
            retryable=True,
        )


# ── State Errors ──────────────────────────────────────────────────────────────

class JobNotFoundError(EngineError):
    def __init__(self, detail: str = "") -> None:
        super().__init__(
            code="JOB_NOT_FOUND",
            message=detail or "Session expired. Please upload your video again.",
            retryable=False,
        )


class InvalidStateTransition(EngineError):
    def __init__(self, from_state: str, to_state: str) -> None:
        super().__init__(
            code="INVALID_STATE_TRANSITION",
            message=f"Cannot transition from '{from_state}' to '{to_state}'. Please retry.",
            retryable=False,
        )


# ── Infrastructure Errors ─────────────────────────────────────────────────────

class RedisUnavailableError(EngineError):
    def __init__(self) -> None:
        super().__init__(
            code="REDIS_UNAVAILABLE",
            message="Job storage is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
            retryable=False,
        )


class MediaPipeUnavailableError(EngineError):
    def __init__(self) -> None:
        super().__init__(
            code="MEDIAPIPE_UNAVAILABLE",
            message="Player detection is unavailable. Please try again.",
            retryable=False,
        )


class StorageError(EngineError):
    def __init__(self, detail: str = "") -> None:
        super().__init__(
            code="STORAGE_ERROR",
            message=detail or "Failed to save video. Please try again.",
            retryable=True,
        )


class VideoNotFoundError(EngineError):
    def __init__(self) -> None:
        super().__init__(
            code="VIDEO_NOT_FOUND",
            message="Rendered video is not available yet.",
            retryable=False,
        )


class VideoExpiredError(EngineError):
    def __init__(self) -> None:
        super().__init__(
            code="VIDEO_EXPIRED",
            message="This video is no longer available. The server may have restarted. Please upload your video again.",
            retryable=False,
        )
