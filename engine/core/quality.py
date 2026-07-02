# UNUSED — see ARCHITECTURE.md §10 (Known Gaps, Tech Debt, and Contradictions)
# This module is dead code. It provides frame quality filtering but is never called from the API pipeline.
from __future__ import annotations

import cv2
import numpy as np
from dataclasses import dataclass


@dataclass
class FrameQualityResult:
    frame_index: int
    sharpness_score: float   # Laplacian variance — higher = sharper
    brightness: float         # mean pixel value
    usable: bool
    rejection_reason: str | None = None


def assess_frame_quality(frame: np.ndarray, frame_index: int) -> FrameQualityResult:
    """
    Fast quality check using Laplacian variance (sharpness detector).
    Runs in <5ms per frame.
    """
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    # Sharpness: Laplacian variance (blurry frames have low variance)
    sharpness = cv2.Laplacian(gray, cv2.CV_64F).var()

    # Brightness
    brightness = gray.mean()

    # Quality thresholds
    if sharpness < 50:
        return FrameQualityResult(frame_index, sharpness, brightness, False,
                                   f"Blurry frame (sharpness={sharpness:.1f} < 50)")

    if brightness < 30:
        return FrameQualityResult(frame_index, sharpness, brightness, False,
                                   f"Too dark (brightness={brightness:.1f} < 30)")

    if brightness > 240:
        return FrameQualityResult(frame_index, sharpness, brightness, False,
                                   f"Overexposed (brightness={brightness:.1f} > 240)")

    return FrameQualityResult(frame_index, sharpness, brightness, True)


def filter_quality_frames(frames: list[dict]) -> list[dict]:
    """Filter out low-quality frames before passing to MediaPipe."""
    good_frames = []
    rejected_count = 0

    for frame_data in frames:
        frame = frame_data["frame"]  # np.ndarray
        quality = assess_frame_quality(frame, frame_data["index"])

        if quality.usable:
            good_frames.append({**frame_data, "quality": quality.sharpness_score})
        else:
            rejected_count += 1

    # If we rejected too many frames, something is wrong with the video
    rejection_rate = rejected_count / len(frames) if frames else 0
    if rejection_rate > 0.5:
        raise ValueError(
            f"Too many low-quality frames: {rejection_rate:.0%} rejected. "
            f"Video may be corrupted or filmed in poor conditions."
        )

    return good_frames
