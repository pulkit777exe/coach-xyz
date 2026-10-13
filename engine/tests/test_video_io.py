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


class TestLooksLikeVideoContainer:
    def test_mp4_ftyp_accepted(self):
        from core.video_io import looks_like_video_container

        assert looks_like_video_container(b"\x00\x00\x00\x20ftypisom\x00\x00\x00\x00")

    def test_avi_accepted(self):
        from core.video_io import looks_like_video_container

        assert looks_like_video_container(b"RIFF\x00\x01\x02\x03AVI LIST")

    def test_mkv_webm_accepted(self):
        from core.video_io import looks_like_video_container

        assert looks_like_video_container(b"\x1a\x45\xdf\xa3\x93\x42\x82\x88matroska")

    def test_random_bytes_rejected_before_disk(self):
        from core.video_io import looks_like_video_container

        assert not looks_like_video_container(bytes(range(256)))
        assert not looks_like_video_container(b"")
        assert not looks_like_video_container(b"<html><body>not a video</body></html>")
