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


def preprocess_video_ffmpeg(video_path: str) -> str:
    """
    Normalize input video stream for stable OpenCV decoding.
    Uses ffmpeg only for pre-processing.
    """
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

        timestamps = np.arange(0.0, duration + 0.01, 2.0)
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


def frame_to_jpeg_bytes(frame: np.ndarray) -> bytes:
    """Encode a numpy frame to JPEG bytes for API transmission."""
    ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
    if not ok:
        return b""
    return bytes(buffer.tobytes())
