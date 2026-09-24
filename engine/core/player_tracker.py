"""
player_tracker.py — Frame scoring utilities.

This module is used by multi-player analysis to pick strong keyframes from
a clip (see `score_frames`, consumed by cli/frame_selector.py).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from core.detection_utils import iou

try:
    import mediapipe as mp
except ImportError:
    mp = None

try:
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import (
        PoseLandmarker,
        PoseLandmarkerOptions,
        RunningMode,
    )
    _HAS_TASKS = True
except ImportError:
    _HAS_TASKS = False

# Use same model as pose_backend for consistent detection
_MODEL_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "pose_landmarker_full.task",
)

_POSE_WEIGHT = 0.40
_COUNT_WEIGHT = 0.25
_OCCLUSION_WEIGHT = 0.20
_BLUR_WEIGHT = 0.15


@dataclass
class ScoredFrame:
    frame_index: int
    timestamp_s: float
    total_score: float
    pose_confidence: float
    player_count_score: float
    occlusion_penalty: float
    blur_score: float
    frame_width: int
    frame_height: int
    detected_skeletons: list[dict[str, Any]]


def score_frames(video_path: str) -> list[ScoredFrame]:
    """
    Score frames and return the top 5 keyframes (highest score first).

    Score composition:
      - Pose confidence    (40%)
      - Player count       (25%)
      - Occlusion penalty  (20%)  -> converted to (1 - penalty)
      - Blur quality       (15%)  -> Laplacian variance
    """
    if not _HAS_TASKS:
        raise ImportError(
            "mediapipe-tasks is required for player tracking. "
            "Install with: pip install mediapipe"
        )
    if not os.path.exists(_MODEL_PATH):
        raise FileNotFoundError(f"Pose landmarker model not found at {_MODEL_PATH}")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Unable to open video: {video_path}")

    fps = max(1.0, cap.get(cv2.CAP_PROP_FPS))
    frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    # Scan every frame so selection quality comes from full video analysis.
    process_every_n = 1

    options = PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=_MODEL_PATH),
        running_mode=RunningMode.VIDEO,
        min_pose_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    pose = PoseLandmarker.create_from_options(options)

    scored: list[ScoredFrame] = []
    frame_index = 0

    try:
        while cap.isOpened():
            ok, frame = cap.read()
            if not ok:
                break

            if frame_index % process_every_n != 0:
                frame_index += 1
                continue

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            timestamp_ms = int((frame_index / fps) * 1000)
            result = pose.detect_for_video(mp_image, timestamp_ms)

            skeletons = _extract_skeletons(
                result.pose_landmarks,
                frame_width=frame_width,
                frame_height=frame_height,
            )
            pose_conf = _pose_confidence(skeletons)
            player_count_score = _player_count_score(len(skeletons))
            occlusion_penalty = _occlusion_penalty(skeletons)
            blur_score = _blur_score(frame)

            total = (
                _POSE_WEIGHT * pose_conf
                + _COUNT_WEIGHT * player_count_score
                + _OCCLUSION_WEIGHT * (1.0 - occlusion_penalty)
                + _BLUR_WEIGHT * blur_score
            )

            scored.append(
                ScoredFrame(
                    frame_index=frame_index,
                    timestamp_s=frame_index / fps,
                    total_score=round(total, 4),
                    pose_confidence=round(pose_conf, 4),
                    player_count_score=round(player_count_score, 4),
                    occlusion_penalty=round(occlusion_penalty, 4),
                    blur_score=round(blur_score, 4),
                    frame_width=frame_width,
                    frame_height=frame_height,
                    detected_skeletons=skeletons,
                )
            )
            frame_index += 1
    finally:
        cap.release()
        pose.close()

    scored.sort(key=lambda item: item.total_score, reverse=True)
    return scored[:5]


def _extract_skeletons(
    pose_landmarks: list[Any] | None,
    frame_width: int,
    frame_height: int,
) -> list[dict[str, Any]]:
    if not pose_landmarks:
        return []

    out: list[dict[str, Any]] = []
    for skeleton in pose_landmarks:
        valid = [lm for lm in skeleton if 0.0 <= lm.x <= 1.0 and 0.0 <= lm.y <= 1.0]
        if not valid:
            continue

        xs = [lm.x for lm in valid]
        ys = [lm.y for lm in valid]
        x_min_n, x_max_n = min(xs), max(xs)
        y_min_n, y_max_n = min(ys), max(ys)

        x_min = int(x_min_n * frame_width)
        y_min = int(y_min_n * frame_height)
        x_max = int(x_max_n * frame_width)
        y_max = int(y_max_n * frame_height)
        centroid_x = (x_min + x_max) / 2.0
        centroid_y = (y_min + y_max) / 2.0

        vis = [float(getattr(lm, "visibility", 0.5)) for lm in valid]
        conf = float(np.clip(np.mean(vis) if vis else 0.5, 0.0, 1.0))

        out.append(
            {
                "bbox": {"x_min": x_min, "y_min": y_min, "x_max": x_max, "y_max": y_max},
                "centroid": (centroid_x, centroid_y),
                "confidence": conf,
            }
        )
    return out


def _pose_confidence(skeletons: list[dict[str, Any]]) -> float:
    if not skeletons:
        return 0.0
    confs = [float(s.get("confidence", 0.0)) for s in skeletons]
    return float(np.clip(np.mean(confs), 0.0, 1.0))


def _player_count_score(count: int) -> float:
    # Full credit once we have 4+ visible players.
    return float(np.clip(count / 4.0, 0.0, 1.0))


def _occlusion_penalty(skeletons: list[dict[str, Any]]) -> float:
    if len(skeletons) < 2:
        return 0.0

    ious: list[float] = []
    for i in range(len(skeletons)):
        for j in range(i + 1, len(skeletons)):
            b1 = skeletons[i]["bbox"]
            b2 = skeletons[j]["bbox"]
            # Convert dict bbox to tuple for detection_utils.iou
            box1 = (b1["x_min"], b1["y_min"], b1["x_max"], b1["y_max"])
            box2 = (b2["x_min"], b2["y_min"], b2["x_max"], b2["y_max"])
            ious.append(iou(box1, box2))
    return float(np.clip(np.mean(ious) if ious else 0.0, 0.0, 1.0))


def _blur_score(frame: np.ndarray) -> float:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    # Saturate around 300 variance.
    return float(np.clip(variance / 300.0, 0.0, 1.0))
