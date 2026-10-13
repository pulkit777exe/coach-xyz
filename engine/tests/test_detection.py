"""Tests for the unified detection seam in core.detector."""

import numpy as np
import pytest

from core import detector
from core.detector import (
    SCAN_DETECTION_OPTIONS,
    TRACKING_DETECTION_OPTIONS,
    detect_pose_candidates,
)
from core.tracking import detect_pose_candidates as tracking_detect_pose_candidates


def _landmarks(visibility=0.9, n=33):
    # Vary x AND y so derived boxes have nonzero area (IoU is meaningful).
    return [
        {"x": 0.1 + 0.01 * i, "y": 0.2 + 0.005 * i, "visibility": visibility}
        for i in range(n)
    ]


class FakePose:
    """pose_detector.detect returns landmarks, or [] for small crops when asked."""

    def __init__(self, landmarks=None, empty_crops=False, frame_h=100):
        self._landmarks = landmarks if landmarks is not None else _landmarks()
        self._empty_crops = empty_crops
        self._frame_h = frame_h

    def detect(self, crop):
        if self._empty_crops and crop.shape[0] < self._frame_h:
            return []
        return [self._landmarks]


@pytest.fixture
def frame():
    return np.zeros((100, 120, 3), dtype=np.uint8)


def _stub_hog(monkeypatch, boxes):
    monkeypatch.setattr(
        "core.detector.detect_hog_people",
        lambda _frame: [(box, 0.9) for box in boxes],
    )


class TestDetectPoseCandidates:
    def test_scan_returns_candidate_with_mean_visibility(self, monkeypatch, frame):
        _stub_hog(monkeypatch, [(10, 10, 60, 90)])
        fake = FakePose(landmarks=_landmarks(visibility=0.8))

        out = detect_pose_candidates(frame, fake, SCAN_DETECTION_OPTIONS)

        assert len(out) == 1
        assert out[0].visibility == pytest.approx(0.8)
        assert len(out[0].bbox) == 4

    def test_default_opts_are_scan_tuning(self, monkeypatch, frame):
        _stub_hog(monkeypatch, [(10, 10, 60, 90)])
        fake = FakePose()

        def _shape(out):
            return [(c.visibility, c.bbox) for c in out]

        assert _shape(detect_pose_candidates(frame, fake)) == _shape(
            detect_pose_candidates(frame, fake, SCAN_DETECTION_OPTIONS)
        )

    def test_merge_dedup_replaces_weaker_duplicate(self, monkeypatch, frame):
        _stub_hog(monkeypatch, [(10, 10, 60, 90), (12, 12, 62, 92)])

        seen = {"calls": 0}

        class RisingPose(FakePose):
            def detect(self, crop):
                seen["calls"] += 1
                return [_landmarks(visibility=0.5 + 0.1 * seen["calls"])]

        out = detect_pose_candidates(frame, RisingPose(), SCAN_DETECTION_OPTIONS)

        assert len(out) == 1
        assert out[0].visibility == pytest.approx(0.7)

    def test_skip_dedup_keeps_strongest(self, monkeypatch, frame):
        _stub_hog(monkeypatch, [(10, 10, 60, 90), (12, 12, 62, 92)])

        seen = {"calls": 0}

        class RisingPose(FakePose):
            def detect(self, crop):
                seen["calls"] += 1
                return [_landmarks(visibility=0.5 + 0.1 * seen["calls"])]

        out = detect_pose_candidates(frame, RisingPose(), TRACKING_DETECTION_OPTIONS)

        assert len(out) == 1
        assert out[0].visibility == pytest.approx(0.7)

    def test_no_fallback_on_scan_path(self, monkeypatch, frame):
        # HOG finds a box but pose sees nothing: scan returns [] (no retry).
        _stub_hog(monkeypatch, [(10, 10, 60, 90)])

        class BlindPose:
            def detect(self, crop):
                return []

        assert detect_pose_candidates(frame, BlindPose(), SCAN_DETECTION_OPTIONS) == []

    def test_fallback_full_frame_on_tracking_path(self, monkeypatch, frame):
        # HOG finds a small box, pose sees nothing in crops but sees the frame.
        _stub_hog(monkeypatch, [(10, 10, 20, 20)])
        fake = FakePose(empty_crops=True, frame_h=100)

        out = detect_pose_candidates(frame, fake, TRACKING_DETECTION_OPTIONS)

        assert len(out) == 1

    def test_tracking_wrapper_uses_tracking_tuning(self, monkeypatch, frame):
        _stub_hog(monkeypatch, [(10, 10, 60, 90)])
        fake = FakePose()

        def _shape(out):
            return [(c.visibility, c.bbox) for c in out]

        assert _shape(tracking_detect_pose_candidates(frame, fake)) == _shape(
            detect_pose_candidates(frame, fake, TRACKING_DETECTION_OPTIONS)
        )

    def test_empty_frame_proposal_still_runs(self, monkeypatch, frame):
        # No HOG boxes at all: full-frame proposal path (no crash, maybe empty).
        _stub_hog(monkeypatch, [])

        class BlindPose:
            def detect(self, crop):
                return []

        assert detect_pose_candidates(frame, BlindPose(), SCAN_DETECTION_OPTIONS) == []
