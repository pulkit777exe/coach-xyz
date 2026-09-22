"""Tests for core/errors.py — canonical engine error shape and codes."""

from core.errors import (
    STATUS_BY_CODE,
    EngineError,
    InvalidRequestError,
    InvalidStateTransition,
    JobNotFoundError,
    NoPlayersDetectedError,
    VideoDecodeError,
    error_status,
)


class TestEngineError:
    def test_to_dict_uses_engine_layer(self):
        err = EngineError(code="X", message="boom")
        assert err.to_dict() == {
            "code": "X",
            "message": "boom",
            "layer": "engine",
            "retryable": True,
        }

    def test_retryable_flag_is_preserved(self):
        assert EngineError(code="X", message="m", retryable=False).to_dict()["retryable"] is False

    def test_message_is_set_on_exception(self):
        err = EngineError(code="X", message="boom")
        assert str(err) == "boom"


class TestErrorSubclasses:
    def test_invalid_request_is_not_retryable(self):
        assert InvalidRequestError().code == "INVALID_REQUEST"
        assert InvalidRequestError().retryable is False

    def test_no_players_detected_is_retryable(self):
        assert NoPlayersDetectedError().code == "NO_PLAYERS_DETECTED"
        assert NoPlayersDetectedError().retryable is True

    def test_video_decode_failed_is_not_retryable(self):
        assert VideoDecodeError().retryable is False

    def test_invalid_state_transition_builds_message_and_code(self):
        err = InvalidStateTransition("uploading", "rendering")
        assert err.code == "INVALID_STATE_TRANSITION"
        assert "uploading" in err.message
        assert "rendering" in err.message
        assert err.retryable is False

    def test_job_not_found_is_not_retryable(self):
        assert JobNotFoundError().to_dict()["retryable"] is False
        assert JobNotFoundError().code == "JOB_NOT_FOUND"


class TestStatusRegistry:
    """STATUS_BY_CODE + error_status are the single owner of code → HTTP status.

    The server queue keys its retry policy off the error's retryable flag, so
    this registry is the contract that keeps engine, queue, and API in sync.

    Keep the expected statuses in sync with the server's contract expectations
    in server/tests/errors.test.ts.
    """

    KNOWN = {
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

    def test_known_codes_map_to_expected_statuses(self):
        for code, status in self.KNOWN.items():
            assert STATUS_BY_CODE[code] == status, code

    def test_unknown_retryable_code_falls_back_to_422(self):
        assert error_status(EngineError(code="ODD_CODE", message="m", retryable=True)) == 422

    def test_unknown_non_retryable_code_falls_back_to_500(self):
        assert error_status(EngineError(code="ODD_CODE", message="m", retryable=False)) == 500

    def test_every_known_code_has_a_status_entry(self):
        # Every entry in the registry must be documented in the KNOWN map.
        assert set(STATUS_BY_CODE) == set(self.KNOWN)

    def test_non_retryable_codes_have_stable_statuses(self):
        # Corpus of codes the server treats as unrecoverable. The engine's
        # actual error classes must be non-retryable and resolve to a stable
        # HTTP status so the queue never retries a doomed job.
        from core.errors import (
            InvalidRequestError,
            JobNotFoundError,
            MediaPipeUnavailableError,
            VideoDecodeError,
            VideoExpiredError,
            VideoNotFoundError,
        )

        actual = [
            VideoDecodeError(),
            VideoExpiredError(),
            VideoNotFoundError(),
            JobNotFoundError(),
            InvalidRequestError(),
            MediaPipeUnavailableError(),
        ]
        for err in actual:
            assert err.retryable is False, f"{err.code} must be non-retryable"
            status = error_status(err)
            assert 400 <= status < 600, err.code
            expected = STATUS_BY_CODE.get(err.code, 422 if err.retryable else 500)
            assert status == expected, err.code
