"""
video_io.py — Video frame I/O utilities extracted from analyzer.py.

Handles video preprocessing, keyframe extraction, frame reading, and JPEG encoding.
No dependencies on detection, AI, or job management.
"""

from __future__ import annotations

import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from core.errors import VideoDecodeError
from core.config import FFMPEG_TIMEOUT_S


def tmp_dir() -> Path:
    """Return the system temp directory as a resolved Path."""
    return Path(tempfile.gettempdir()).resolve()


def probe_video(video_path: str) -> dict[str, Any]:
    """Validate an uploaded file is a decodable video (never trust client
    metadata). Returns duration/width/height/audio presence. Raises
    VideoDecodeError when ffprobe is missing, the file has no video stream,
    or it is corrupt."""
    import json as _json

    try:
        proc = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,codec_name,duration",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                video_path,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=60,
            check=True,
        )
        audio = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=codec_name",
                "-of",
                "json",
                video_path,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=60,
            check=False,
        )
    except FileNotFoundError as exc:
        raise VideoDecodeError("Media inspection is unavailable on the engine.") from exc
    except Exception as exc:
        raise VideoDecodeError("Could not read this video file. Try MP4, MOV, or AVI format.") from exc

    try:
        info = _json.loads(proc.stdout.decode("utf-8") or "{}")
        stream = (info.get("streams") or [{}])[0]
        width = int(stream.get("width") or 0)
        height = int(stream.get("height") or 0)
        duration = float(
            stream.get("duration") or (info.get("format") or {}).get("duration") or 0
        )
        audio_info = _json.loads(audio.stdout.decode("utf-8") or "{}")
        has_audio = bool((audio_info.get("streams") or []))
    except (ValueError, TypeError, IndexError, AttributeError) as exc:
        raise VideoDecodeError("Could not read this video file. Try MP4, MOV, or AVI format.") from exc

    if width <= 0 or height <= 0:
        raise VideoDecodeError("Could not read this video file. Try MP4, MOV, or AVI format.")
    if duration <= 0 or duration > 3600:
        raise VideoDecodeError("Video must be between 1 second and 60 minutes long.")
    return {"width": width, "height": height, "duration": duration, "has_audio": has_audio}


def preprocess_video_ffmpeg(video_path: str) -> str:
    """
    Normalize input video stream for stable OpenCV decoding.
    Uses ffmpeg only for pre-processing.
    Skips re-encode if video dimensions are already even.
    """
    # Quick check: if dimensions are already even, skip re-encode
    cap = cv2.VideoCapture(video_path)
    if cap.isOpened():
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        cap.release()
        if w > 0 and h > 0 and w % 2 == 0 and h % 2 == 0:
            return video_path

    td = tmp_dir()
    td.mkdir(parents=True, exist_ok=True)

    output_path = td / f"pre_{uuid.uuid4().hex}.mp4"
    command = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-vf",
        "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-an",
        str(output_path),
    ]

    try:
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=FFMPEG_TIMEOUT_S)
        return str(output_path)
    except Exception as e:
        # Log the ffmpeg failure but continue with original video
        import logging
        logging.warning(f"ffmpeg preprocessing failed, using original video: {e}")
        return video_path


def extract_keyframes(video_path: str) -> tuple[list[dict[str, Any]], float, int, dict[int, np.ndarray]]:
    """
    Extract keyframes at 3-second intervals (max 30).
    Returns (keyframes, fps, frame_count, frame_cache).
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise VideoDecodeError("Could not open video for frame extraction")

    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS))
        if fps <= 0:
            fps = 30.0
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        duration = frame_count / fps if frame_count > 0 else 90.0

        # Sample every 3 seconds, cap at 30 frames.
        # 3s intervals give good event coverage without overwhelming Gemini's
        # context window; 30 frames × ~50 KB ≈ 1.5 MB total payload.
        timestamps = np.arange(0.0, duration + 0.01, 3.0)
        if len(timestamps) > 30:
            timestamps = timestamps[:30]

        keyframes: list[dict[str, Any]] = []
        frame_cache: dict[int, np.ndarray] = {}
        max_cached_frames = 30
        for ts in timestamps:
            frame_index = int(round(ts * fps))
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            keyframes.append(
                {
                    "frame_index": frame_index,
                    "timestamp": float(round(ts, 2)),
                }
            )
            if len(frame_cache) < max_cached_frames:
                frame_cache[frame_index] = frame

        if not keyframes:
            raise VideoDecodeError("Could not extract keyframes from video")

        return keyframes, fps, frame_count, frame_cache
    finally:
        cap.release()


def read_frame_by_index(video_path: str, frame_index: int) -> np.ndarray | None:
    """Read a single frame from video by frame index. Memory-efficient: loads only one frame."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return None
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
    ok, frame = cap.read()
    cap.release()
    return frame if ok else None


_MAX_FRAME_DIM = 768  # px — Gemini doesn't benefit from higher resolution for pose analysis


def frame_to_jpeg_bytes(frame: np.ndarray, max_dim: int = _MAX_FRAME_DIM) -> bytes:
    """Encode a numpy frame to JPEG bytes for API transmission.

    Downscales the frame so its longest side is at most *max_dim* pixels before
    encoding.  This keeps Gemini payloads small (~30–60 KB per frame instead of
    200–400 KB) without losing the pose/form detail the model needs.
    """
    h, w = frame.shape[:2]
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        new_w = max(1, int(w * scale))
        new_h = max(1, int(h * scale))
        frame = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)

    ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    if not ok:
        return b""
    return bytes(buffer.tobytes())
