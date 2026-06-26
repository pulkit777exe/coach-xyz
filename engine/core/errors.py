from __future__ import annotations

from dataclasses import dataclass


@dataclass
class EngineError(Exception):
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


class NoPlayersDetectedError(EngineError):
    def __init__(self) -> None:
        super().__init__(
            code="NO_PLAYERS_DETECTED",
            message="No players detected. Try better lighting or a less crowded frame.",
            retryable=True,
        )


class VideoDecodeError(EngineError):
    def __init__(self, detail: str = "") -> None:
        super().__init__(
            code="VIDEO_DECODE_FAILED",
            message="Could not read this video. Please try MP4 or MOV format.",
            retryable=True,
        )


class GeminiQuotaError(EngineError):
    def __init__(self) -> None:
        super().__init__(
            code="GEMINI_QUOTA_EXCEEDED",
            message="AI analysis quota reached. Please try again in a few minutes.",
            retryable=True,
        )


class GeminiTimeoutError(EngineError):
    def __init__(self) -> None:
        super().__init__(
            code="GEMINI_TIMEOUT",
            message="AI analysis timed out. Try a shorter video clip.",
            retryable=True,
        )


class GeminiParseError(EngineError):
    def __init__(self) -> None:
        super().__init__(
            code="GEMINI_PARSE_FAILED",
            message="AI returned an unexpected response. Please try again.",
            retryable=True,
        )


class JobNotFoundError(EngineError):
    def __init__(self) -> None:
        super().__init__(
            code="JOB_NOT_FOUND",
            message="This analysis session has expired. Please upload again.",
            retryable=False,
        )


class MediaPipeUnavailableError(EngineError):
    def __init__(self) -> None:
        super().__init__(
            code="MEDIAPIPE_UNAVAILABLE",
            message="Player detection is unavailable. Please try again shortly.",
            retryable=False,
        )
