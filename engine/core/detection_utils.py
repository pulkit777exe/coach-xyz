"""
detection_utils.py — Shared detection primitives for player detection and analysis.

Extracts duplicated HOG, IoU, landmark transform, and bbox logic from
detector.py and analyzer.py into a single configurable module.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np


@dataclass
class PoseCandidate:
    landmarks: list[dict[str, float]]
    bbox: tuple[int, int, int, int]
    visibility: float


# Module-level HOG descriptor (shared by all callers)
_HOG_DESCRIPTOR = cv2.HOGDescriptor(
    _winSize=(48, 96),
    _blockSize=(16, 16),
    _blockStride=(8, 8),
    _cellSize=(8, 8),
    _nbins=9,
)

# Default landmark indices for bounding box computation
# Used by analyzer.py for tighter tracking boxes
BODY_LANDMARK_INDICES = [11, 12, 23, 24, 27, 28]

# All 33 MediaPipe pose landmarks
ALL_LANDMARK_INDICES = list(range(33))


def detect_hog_people(
    frame: np.ndarray,
    min_weight: float = 0.3,
) -> list[tuple[tuple[int, int, int, int], float]]:
    """
    Run HOG people detection on a frame.
    Returns list of (bbox, confidence) pairs.
    """
    boxes, weights = _HOG_DESCRIPTOR.detectMultiScale(
        frame, winStride=(8, 8), padding=(8, 8), scale=1.05
    )
    h, w = frame.shape[:2]
    results = []
    for i, (x1, y1, bw, bh) in enumerate(boxes):
        x1, y1 = int(x1), int(y1)
        x2, y2 = min(x1 + int(bw), w - 1), min(y1 + int(bh), h - 1)
        weight = float(weights[i]) if i < len(weights) else 0.6
        if weight >= min_weight:
            results.append(((x1, y1, x2, y2), weight))
    return results


def iou(box_a: tuple[int, int, int, int], box_b: tuple[int, int, int, int]) -> float:
    """Intersection-over-union between two (x1, y1, x2, y2) boxes."""
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    area_a = max(1, (ax2 - ax1) * (ay2 - ay1))
    area_b = max(1, (bx2 - bx1) * (by2 - by1))
    union = area_a + area_b - inter
    return inter / max(1.0, union)


def transform_landmarks_to_global(
    landmarks: list[dict[str, Any]],
    crop_x1: int,
    crop_y1: int,
    crop_w: int,
    crop_h: int,
    frame_w: int,
    frame_h: int,
) -> list[dict[str, Any]]:
    """Transform crop-local landmarks to frame-global normalized coordinates."""
    return [
        {
            "x": (crop_x1 + lm["x"] * crop_w) / frame_w,
            "y": (crop_y1 + lm["y"] * crop_h) / frame_h,
            "visibility": lm.get("visibility", 0.0),
        }
        for lm in landmarks
    ]


def bbox_from_landmarks(
    landmarks: list[dict[str, Any]],
    frame_w: int,
    frame_h: int,
    landmark_indices: list[int] | None = None,
    min_visibility: float = 0.0,
    padding_ratio: float = 0.0,
) -> tuple[int, int, int, int]:
    """
    Compute a bounding box from pose landmarks.

    Args:
        landmarks: List of landmark dicts with x, y, visibility (normalized 0-1).
        frame_w: Frame width in pixels.
        frame_h: Frame height in pixels.
        landmark_indices: Which landmarks to use. None = all visible.
        min_visibility: Minimum visibility to include a landmark.
        padding_ratio: Padding as fraction of bbox dimensions (0 = no padding).
                       Asymmetric: top gets extra 0.15 * frame_h for head room.
    """
    if landmark_indices is not None:
        filtered = [landmarks[i] for i in landmark_indices if i < len(landmarks)]
    else:
        filtered = [lm for lm in landmarks if lm.get("visibility", 0) > min_visibility]

    if not filtered:
        filtered = landmarks

    xs = [lm["x"] * frame_w for lm in filtered]
    ys = [lm["y"] * frame_h for lm in filtered]

    x1, x2 = min(xs), max(xs)
    y1, y2 = min(ys), max(ys)

    if padding_ratio > 0:
        pw = (x2 - x1) * padding_ratio
        ph = (y2 - y1) * padding_ratio
        x1 -= pw
        x2 += pw
        y1 -= ph + (frame_h * 0.15)  # Extra head room
        y2 += ph

    return (
        max(0, int(x1)),
        max(0, int(y1)),
        min(frame_w - 1, int(x2)),
        min(frame_h - 1, int(y2)),
    )


def landmark_angle(a: dict, b: dict, c: dict) -> float:
    """Interior angle at vertex b formed by points a-b-c in degrees."""
    v1 = (a["x"] - b["x"], a["y"] - b["y"])
    v2 = (c["x"] - b["x"], c["y"] - b["y"])
    dot = v1[0] * v2[0] + v1[1] * v2[1]
    norm = np.sqrt(v1[0] ** 2 + v1[1] ** 2) * np.sqrt(v2[0] ** 2 + v2[1] ** 2) + 1e-6
    cos_angle = np.clip(dot / norm, -1.0, 1.0)
    return float(np.degrees(np.arccos(cos_angle)))
