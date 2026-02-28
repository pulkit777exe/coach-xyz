from __future__ import annotations


class EngineError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class NoPlayersDetectedError(EngineError):
    def __init__(self, message: str = "No players detected in the video") -> None:
        super().__init__("NO_PLAYERS_DETECTED", message)


class VideoDecodeError(EngineError):
    def __init__(self, message: str = "Failed to decode video") -> None:
        super().__init__("VIDEO_DECODE_FAILED", message)


class GeminiParseError(EngineError):
    def __init__(self, message: str = "Failed to parse Gemini response") -> None:
        super().__init__("GEMINI_PARSE_FAILED", message)


class GeminiQuotaError(EngineError):
    def __init__(self, message: str = "Gemini quota exceeded") -> None:
        super().__init__("GEMINI_QUOTA_EXCEEDED", message)


class JobNotFoundError(EngineError):
    def __init__(self, message: str = "Job not found") -> None:
        super().__init__("JOB_NOT_FOUND", message)
