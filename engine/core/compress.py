from __future__ import annotations

import subprocess
from pathlib import Path

# Cached NVENC detection (avoids subprocess per call)
_nvenc_checked = False
_has_nvenc = False


def compress_for_analysis(video_path: str) -> str:
    """
    Compress video for Gemini upload without degrading analysis quality.

    Strategy:
    - Target: 720p, 24fps, H.264 CRF 28 (visually lossless for analysis)
    - Strips audio (not needed for sport analysis)
    - Uses FFmpeg with hardware acceleration if available
    """
    output_path = Path(video_path).with_suffix(".compressed.mp4")

    # Check for hardware acceleration
    has_nvenc = _check_nvenc()
    codec = "h264_nvenc" if has_nvenc else "libx264"

    cmd = [
        "ffmpeg", "-i", video_path,
        "-vf", "scale='min(1280,iw)':'-2'",  # max 720p, preserve AR
        "-r", "24",                             # cap at 24fps
        "-c:v", codec,
        "-crf", "28" if not has_nvenc else "0",
        "-preset", "fast",
        "-an",                                  # strip audio
        "-y",
        str(output_path)
    ]

    result = subprocess.run(cmd, capture_output=True, timeout=120)

    if result.returncode != 0:
        # Compression failed — fall back to original
        return video_path

    original_size = Path(video_path).stat().st_size
    compressed_size = output_path.stat().st_size

    # If compression didn't help (e.g., already small), use original
    if compressed_size >= original_size * 0.9:
        output_path.unlink(missing_ok=True)
        return video_path

    return str(output_path)


def _check_nvenc() -> bool:
    global _nvenc_checked, _has_nvenc
    if not _nvenc_checked:
        result = subprocess.run(
            ["ffmpeg", "-encoders"], capture_output=True, text=True
        )
        _has_nvenc = "h264_nvenc" in result.stdout
        _nvenc_checked = True
    return _has_nvenc
