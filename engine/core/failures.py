"""Structured failure codes, kept separate from job state.

A job can complete with a degraded result (for example, the VLM was unavailable
while pose measurements remained valid). That is not the same as a failed job.
The job status therefore lives in ``JobStatus`` and the reasons live in
``FailureCode``; a result may carry several failure codes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

JobStatus = Literal["queued", "running", "completed", "degraded", "failed", "cancelled"]
FailureCode = Literal[
    "F01_ATHLETE_NOT_FOUND",
    "F02_IDENTITY_SWITCH",
    "F03_MISSING_LANDMARK",
    "F04_INVALID_GEOMETRY",
    "F05_UNSUITABLE_VIEW",
    "F06_OBJECT_NOT_DETECTED",
    "F07_MISSED_CANDIDATE",
    "F08_FALSE_CANDIDATE",
    "F09_INCORRECT_VLM_JUDGEMENT",
    "F10_UNSUPPORTED_OBSERVATION",
    "F11_VLM_UNAVAILABLE",
    "F12_INVALID_STRUCTURED_RESPONSE",
    "F13_INSUFFICIENT_COVERAGE",
    "F14_VIDEO_DECODING_FAILURE",
]

FAILURE_CODES: tuple[str, ...] = (
    "F01_ATHLETE_NOT_FOUND",
    "F02_IDENTITY_SWITCH",
    "F03_MISSING_LANDMARK",
    "F04_INVALID_GEOMETRY",
    "F05_UNSUITABLE_VIEW",
    "F06_OBJECT_NOT_DETECTED",
    "F07_MISSED_CANDIDATE",
    "F08_FALSE_CANDIDATE",
    "F09_INCORRECT_VLM_JUDGEMENT",
    "F10_UNSUPPORTED_OBSERVATION",
    "F11_VLM_UNAVAILABLE",
    "F12_INVALID_STRUCTURED_RESPONSE",
    "F13_INSUFFICIENT_COVERAGE",
    "F14_VIDEO_DECODING_FAILURE",
)

# Engine error code -> research failure code. Infrastructure errors (missing
# ffmpeg, missing pose model) intentionally map to None: they are operational
# failures, not evidence failures.
_ERROR_MAP = {
    "VIDEO_DECODE_FAILED": "F14_VIDEO_DECODING_FAILURE",
    "NO_PLAYERS_DETECTED": "F01_ATHLETE_NOT_FOUND",
    "LLM_UNAVAILABLE": "F11_VLM_UNAVAILABLE",
    "POSE_MODEL_MISSING": None,
    "ENGINE_UNAVAILABLE": None,
    "INVALID_REQUEST": None,
    "JOB_NOT_FOUND": None,
    "RESULT_NOT_FOUND": None,
    "INTERNAL_ERROR": None,
}


@dataclass(frozen=True)
class Failure:
    code: str
    stage: str
    message: str
    retryable: bool = False
    detail: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "stage": self.stage,
            "message": self.message,
            "retryable": self.retryable,
            "detail": self.detail,
        }


def failure(code: str, stage: str, message: str, *, retryable: bool = False,
            **detail) -> Failure:
    if code not in FAILURE_CODES:
        raise ValueError(f"unknown failure code: {code}")
    return Failure(code=code, stage=stage, message=message, retryable=retryable, detail=detail)


def from_engine_error(exc, stage: str) -> Failure | None:
    """Translate an EngineError into a research failure when one applies."""
    code = _ERROR_MAP.get(getattr(exc, "code", ""), None)
    if code is None:
        return None
    return failure(code, stage, getattr(exc, "message", str(exc)),
                   retryable=bool(getattr(exc, "retryable", False)))


def status_for(state: str, degraded: list[str] | None = None,
               failures: list[dict] | None = None) -> str:
    """Derive the public job status without replacing the persisted state."""
    if state in ("failed", "cancelled", "queued", "running"):
        return state
    if degraded or failures:
        return "degraded"
    return "completed"
