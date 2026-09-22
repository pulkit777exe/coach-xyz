"""Tests for probe_video — server-side media validation (§8)."""

from core.errors import VideoDecodeError
from core.video_io import probe_video


class TestProbeVideo:
    def test_non_video_file_rejected(self, tmp_path):
        bogus = tmp_path / "fake.mp4"
        bogus.write_bytes(b"this is not a video")
        try:
            probe_video(str(bogus))
        except VideoDecodeError as exc:
            assert exc.code == "VIDEO_DECODE_FAILED"
            return
        raise AssertionError("expected VideoDecodeError")

    def test_missing_file_rejected(self, tmp_path):
        try:
            probe_video(str(tmp_path / "nope.mp4"))
        except VideoDecodeError as exc:
            assert exc.code == "VIDEO_DECODE_FAILED"
            return
        raise AssertionError("expected VideoDecodeError")
