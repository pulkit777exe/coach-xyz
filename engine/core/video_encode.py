"""core/video_encode.py — browser-playable output video.

`cv2.VideoWriter` in pip OpenCV builds usually has no H.264 encoder, so the
old renderer silently fell back to `mp4v` (MPEG-4 Part 2), which most
browsers will not play inline; it also dropped the audio (preprocess uses
`-an`, VideoWriter has no audio). This writer pipes raw BGR frames to ffmpeg
and produces H.264 / yuv420p / faststart MP4, optionally muxing the source
audio.

Usage:
    with FFmpegWriter(out, w, h, fps, audio_from=src) as writer:
        for frame in frames:
            writer.write(frame)
        # hold a final frame:
        writer.write_repeated(summary_frame, int(fps * 3))
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from typing import Any


class EncodeError(RuntimeError):
    pass


def has_audio(path: str) -> bool:
    try:
        p = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
             "stream=codec_type", "-of", "csv=p=0", path],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30, check=False,
        )
        return bool(p.stdout.strip())
    except Exception:
        return False


class FFmpegWriter:
    def __init__(
        self,
        output_path: str,
        width: int,
        height: int,
        fps: float,
        audio_from: str | None = None,
        crf: int = 20,
        preset: str = "veryfast",
    ) -> None:
        if shutil.which("ffmpeg") is None:
            raise EncodeError("ffmpeg is not installed")
        # yuv420p needs even dimensions.
        self.width = width - (width % 2)
        self.height = height - (height % 2)
        self.output_path = output_path
        self._frames = 0
        cmd = ["ffmpeg", "-y", "-loglevel", "error",
               "-f", "rawvideo", "-pix_fmt", "bgr24",
               "-s", f"{width}x{height}", "-r", f"{fps:.4f}", "-i", "-"]
        use_audio = bool(audio_from) and has_audio(audio_from)  # type: ignore[arg-type]
        if use_audio:
            cmd += ["-i", audio_from]  # type: ignore[list-item]
        cmd += ["-map", "0:v:0"]
        if use_audio:
            cmd += ["-map", "1:a:0", "-c:a", "aac", "-b:a", "128k"]
        cmd += ["-vf", f"crop={self.width}:{self.height}:0:0",
                "-c:v", "libx264", "-preset", preset, "-crf", str(crf),
                "-pix_fmt", "yuv420p", "-movflags", "+faststart", output_path]
        self._width_in, self._height_in = width, height
        self._err = tempfile.TemporaryFile()
        self._proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=self._err)

    def write(self, frame: Any) -> None:
        h, w = frame.shape[:2]
        if (w, h) != (self._width_in, self._height_in):
            raise EncodeError(f"frame is {w}x{h}, writer expects {self._width_in}x{self._height_in}")
        try:
            self._proc.stdin.write(frame.tobytes())  # type: ignore[union-attr]
        except BrokenPipeError as exc:
            raise EncodeError(self._stderr_tail() or "ffmpeg exited early") from exc
        self._frames += 1

    def write_repeated(self, frame: Any, count: int) -> None:
        for _ in range(max(0, count)):
            self.write(frame)

    def _stderr_tail(self) -> str:
        try:
            self._err.seek(0)
            return self._err.read().decode("utf-8", "replace")[-600:]
        except Exception:
            return ""

    def close(self) -> None:
        if self._proc.stdin and not self._proc.stdin.closed:
            try:
                self._proc.stdin.close()
            except BrokenPipeError:
                pass
        code = self._proc.wait()
        tail = self._stderr_tail()
        self._err.close()
        if code != 0:
            raise EncodeError(f"ffmpeg failed ({code}): {tail}")
        if self._frames == 0:
            raise EncodeError("no frames written")

    def __enter__(self) -> "FFmpegWriter":
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        if exc_type is not None:
            try:
                self._proc.kill()
            finally:
                self._err.close()
            return
        self.close()