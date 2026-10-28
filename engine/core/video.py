"""ffmpeg / OpenCV helpers: probing, encoding, and the proxy video sent to the model."""

import json
import shutil
import subprocess
import tempfile
from dataclasses import dataclass

import cv2

from .errors import EngineError

BAD_VIDEO = "Could not read this video. Try an MP4, MOV or WebM file."


@dataclass
class Media:
    duration: float
    fps: float
    has_audio: bool


def looks_like_video(head: bytes) -> bool:
    """Cheap container check on the first bytes, before a whole upload is written to disk."""
    window = head[:64]
    return (
        b"ftyp" in window
        or (window.startswith(b"RIFF") and b"AVI" in window[:16])
        or window.startswith(b"\x1a\x45\xdf\xa3")
    )


def _ffprobe(path: str, *args: str) -> dict:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-of", "json", *args, path],
            capture_output=True, timeout=60, check=True,
        )
        return json.loads(out.stdout or b"{}")
    except FileNotFoundError as exc:
        raise EngineError("ENGINE_UNAVAILABLE", "ffprobe is not installed on the engine.", status=503) from exc
    except Exception as exc:
        raise EngineError("VIDEO_DECODE_FAILED", BAD_VIDEO) from exc


def probe(path: str, max_seconds: float = 3600) -> Media:
    info = _ffprobe(path, "-show_entries", "stream=codec_type,avg_frame_rate,duration:format=duration")
    streams = info.get("streams") or []
    stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    if not stream:
        raise EngineError("VIDEO_DECODE_FAILED", BAD_VIDEO)
    try:
        num, _, den = (stream.get("avg_frame_rate") or "0/1").partition("/")
        fps = float(num) / float(den or 1)
        duration = float(stream.get("duration") or info.get("format", {}).get("duration") or 0)
    except (ValueError, ZeroDivisionError) as exc:
        raise EngineError("VIDEO_DECODE_FAILED", BAD_VIDEO) from exc
    if fps <= 0 or duration <= 0 or duration > max_seconds:
        raise EngineError("VIDEO_DECODE_FAILED", "Video must be between 1 second and 60 minutes long.")
    # One ffprobe answers both questions: the audio stream is in the same listing.
    return Media(duration=duration, fps=fps,
                 has_audio=any(s.get("codec_type") == "audio" for s in streams))


class FFmpegWriter:
    """Pipes BGR frames to ffmpeg: H.264, yuv420p, faststart, optional audio from the source."""

    def __init__(self, out: str, width: int, height: int, fps: float,
                 audio_from: str | None = None, crf: int = 21, has_audio: bool | None = None):
        if shutil.which("ffmpeg") is None:
            raise EngineError("ENGINE_UNAVAILABLE", "ffmpeg is not installed on the engine.", status=503)
        self.size = (width, height)
        self.frames = 0
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24",
               "-s", f"{width}x{height}", "-r", f"{fps:.4f}", "-i", "-"]
        # `has_audio` lets a caller that already probed the source skip a second
        # ffprobe; with no answer, ask once here.
        audio = bool(audio_from) and (has_audio if has_audio is not None else bool(
            _ffprobe(audio_from, "-select_streams", "a:0", "-show_entries", "stream=codec_type").get("streams")))
        if audio:
            cmd += ["-i", audio_from]
        cmd += ["-map", "0:v:0"]
        if audio:
            cmd += ["-map", "1:a:0", "-c:a", "aac", "-b:a", "128k"]
        cmd += ["-vf", "crop=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-preset", "veryfast",
                "-crf", str(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]
        self.log = tempfile.TemporaryFile()
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=self.log)

    def write(self, frame) -> None:
        if frame.shape[1] != self.size[0] or frame.shape[0] != self.size[1]:
            raise ValueError(f"frame is {frame.shape[1]}x{frame.shape[0]}, writer expects {self.size[0]}x{self.size[1]}")
        try:
            self.proc.stdin.write(frame.tobytes())
        except BrokenPipeError as exc:
            raise EngineError("RENDER_FAILED", f"ffmpeg stopped early: {self._tail()}", retryable=True) from exc
        self.frames += 1

    def _tail(self) -> str:
        self.log.seek(0)
        return self.log.read().decode("utf-8", "replace")[-400:]

    def close(self) -> None:
        try:
            self.proc.stdin.close()
        except BrokenPipeError:
            pass
        code = self.proc.wait()
        tail = self._tail()
        self.log.close()
        if code != 0 or self.frames == 0:
            raise EngineError("RENDER_FAILED", f"ffmpeg failed ({code}): {tail}", retryable=True)

    def abort(self) -> None:
        self.proc.kill()
        self.proc.wait()
        self.log.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, *_):
        self.abort() if exc_type else self.close()


@dataclass
class Segment:
    src_start: float
    reel_start: float
    duration: float = 0.0


def to_reel(segments: list[Segment], t: float) -> float | None:
    for s in segments:
        if s.src_start - 0.01 <= t <= s.src_start + s.duration + 0.01:
            return s.reel_start + max(0.0, t - s.src_start)
    return None


def build_proxy(path: str, dst: str, *, box_at, marks, windows=None, fps: float = 5,
                max_side: int = 640, cancelled=lambda: None) -> list[Segment]:
    """Low-res copy for the model with the target boxed and candidate moments numbered.

    `windows` restricts the copy to the given (start, end) spans of the source;
    the returned segments map source time to proxy time.
    """
    cap = cv2.VideoCapture(path)
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step, next_t = 1.0 / fps, 0.0
    segments: list[Segment] = []
    writer = None
    kept = -1
    pos = 0
    win = 0
    try:
        while True:
            if windows:
                # Skip the stretches the proxy does not keep. Grabbing through a
                # 10-minute gap decodes every frame in it; seeking past it decodes
                # one — the windowed path used to cost a full-video decode.
                while win < len(windows) and windows[win][1] < pos / src_fps:
                    win += 1
                if win >= len(windows):
                    break
                start = windows[win][0]
                if pos / src_fps < start - 0.5 / fps:
                    target = max(0, int(start * src_fps))
                    if target > pos:
                        cap.set(cv2.CAP_PROP_POS_FRAMES, target)
                        pos = int(cap.get(cv2.CAP_PROP_POS_FRAMES))
            if not cap.grab():
                break
            t = pos / src_fps
            pos += 1
            window = _window_index(windows, t)
            if window is None or t + 1e-6 < next_t:
                continue
            ok, frame = cap.retrieve()
            if not ok:
                continue
            if writer is None:
                h, w = frame.shape[:2]
                k = min(1.0, max_side / max(h, w))
                size = (max(2, int(w * k) // 2 * 2), max(2, int(h * k) // 2 * 2))
                writer = FFmpegWriter(dst, size[0], size[1], fps, crf=28)
                next_t = t
            if kept < 0 or window != _window_index(windows, segments[-1].src_start):
                segments.append(Segment(src_start=t, reel_start=writer.frames / fps))
            kept += 1
            next_t += step
            small = cv2.resize(frame, writer.size, interpolation=cv2.INTER_AREA)
            _annotate(small, frame.shape, t, box_at(t), marks)
            writer.write(small)
            segments[-1].duration = t - segments[-1].src_start
            if kept % 50 == 0:
                cancelled()
    except BaseException:
        if writer:
            writer.abort()
        raise
    finally:
        cap.release()
    if writer is None:
        raise EngineError("VIDEO_DECODE_FAILED", BAD_VIDEO)
    writer.close()
    return segments


def _window_index(windows, t: float) -> int | None:
    if not windows:
        return 0
    for n, (a, b) in enumerate(windows):
        if a <= t <= b:
            return n
    return None


def _annotate(img, src_shape, t: float, box, marks) -> None:
    sh, sw = src_shape[:2]
    kx, ky = img.shape[1] / sw, img.shape[0] / sh
    if box is not None:
        x1, y1, x2, y2 = (int(v) for v in (box[0] * kx, box[1] * ky, box[2] * kx, box[3] * ky))
        cv2.rectangle(img, (x1, y1), (x2, y2), (255, 0, 255), 2)
        cv2.putText(img, "TARGET", (x1, max(12, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 0, 255), 1, cv2.LINE_AA)
    for a, b, label in marks:
        if a <= t <= b:
            cv2.rectangle(img, (4, 4), (62, 30), (0, 0, 0), -1)
            cv2.putText(img, label, (8, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2, cv2.LINE_AA)
            break
