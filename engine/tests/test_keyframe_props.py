"""Tests for extract_keyframes' capture properties — core/video_io.py.

extract_keyframes already holds an open cv2.VideoCapture and reads fps and
frame_count off it. Width/height used to be re-read in analyzer.py by opening
the same file a third time, purely for two properties. These tests pin that the
dimensions now come from the capture that was already open, and that the
shape/values are what the analyzer stage consumes.

A real encode is used rather than a fake VideoCapture so the properties come
from an actual demuxed file — the point is that the values are right, not that
a stub was called.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from core.errors import VideoDecodeError
from core.video_io import KeyframeExtraction, extract_keyframes


def _make_video(path, frames: int = 60, size=(320, 240), fps: float = 30.0) -> str:
    """Write a short clip. cv2.VideoWriter keeps this hermetic (no ffmpeg binary)."""
    width, height = size
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    if not writer.isOpened():
        pytest.skip("no usable cv2.VideoWriter codec in this environment")
    for i in range(frames):
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        frame[:, :, 1] = (i * 4) % 255
        writer.write(frame)
    writer.release()
    return str(path)


class TestExtractKeyframesCaptureProperties:
    def test_returns_dimensions_alongside_the_frame_properties(self, tmp_path):
        video = _make_video(tmp_path / "clip.mp4", size=(320, 240), fps=30.0)

        extracted = extract_keyframes(video)

        assert isinstance(extracted, KeyframeExtraction)
        assert extracted.width == 320
        assert extracted.height == 240
        assert extracted.fps > 0
        assert extracted.frame_count > 0
        assert extracted.keyframes, "expected at least one sampled frame"
        assert extracted.frame_cache

    def test_dimensions_match_a_directly_probed_capture(self, tmp_path):
        """The contract the analyzer stage relies on: same file, same numbers
        from the capture extract_keyframes held open."""
        video = _make_video(tmp_path / "clip.mp4", size=(640, 360), fps=25.0)

        extracted = extract_keyframes(video)

        cap = cv2.VideoCapture(video)
        try:
            assert cap.isOpened()
            expected_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            expected_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            expected_fps = float(cap.get(cv2.CAP_PROP_FPS))
        finally:
            cap.release()

        assert (extracted.width, extracted.height) == (expected_width, expected_height)
        assert extracted.width == 640 and extracted.height == 360
        assert extracted.fps == pytest.approx(expected_fps, rel=0.01)

    def test_duration_still_derives_from_frame_count_and_fps(self, tmp_path):
        """_stage_tracking computes video_duration from these two fields; the
        new fields must not disturb that arithmetic."""
        video = _make_video(tmp_path / "clip.mp4", frames=90, size=(320, 240), fps=30.0)

        extracted = extract_keyframes(video)
        duration = (
            extracted.frame_count / extracted.fps
            if extracted.frame_count > 0 and extracted.fps > 0
            else 90.0
        )

        assert duration == pytest.approx(3.0, rel=0.1)
        assert duration > 0

    def test_result_unpacks_positionally_for_legacy_callers(self, tmp_path):
        """The return is a tuple, so positional destructuring still compiles —
        now with width/height between frame_count and frame_cache."""
        video = _make_video(tmp_path / "clip.mp4")

        keyframes, fps, frame_count, width, height, frame_cache = extract_keyframes(video)

        assert keyframes and isinstance(keyframes, list)
        assert fps > 0 and frame_count > 0
        assert (width, height) == (320, 240)
        assert isinstance(frame_cache, dict)

    def test_undecodable_file_still_raises_before_reading_properties(self, tmp_path):
        bogus = tmp_path / "fake.mp4"
        bogus.write_bytes(b"this is not a video")

        with pytest.raises(VideoDecodeError):
            extract_keyframes(str(bogus))

    def test_keyframe_sampling_is_unchanged(self, tmp_path):
        """Sampling logic must be untouched by the added property reads: one
        frame per 3s of duration, capped at 30."""
        video = _make_video(tmp_path / "clip.mp4", frames=300, size=(320, 240), fps=30.0)

        extracted = extract_keyframes(video)

        assert len(extracted.keyframes) <= 30
        timestamps = [kf["timestamp"] for kf in extracted.keyframes]
        assert timestamps == sorted(timestamps)
        assert all(0 <= ts <= 30 for ts in timestamps)
