"""
tracking.py — Player detection and tracking extracted from analyzer.py.

Handles motion scoring, pose detection, and building active player tracks.
Depends on video_io for frame reading, and on detection_utils/detector/pose_backend for CV.
"""

from __future__ import annotations

from typing import Any, Optional

import cv2
import numpy as np

from core.detection_utils import (
    BODY_LANDMARK_INDICES,
    detect_hog_people,
    iou,
    bbox_from_landmarks,
    transform_landmarks_to_global,
)
from core.detector import PoseCandidate, detect_players
from core.errors import NoPlayersDetectedError
from core.pose_backend import StaticPoseDetector, pose_backend_available
from core.video_io import read_frame_by_index


def compute_motion_scores(
    video_path: str,
    keyframes: list[dict[str, Any]],
    frame_cache: dict[int, np.ndarray] | None = None,
) -> dict[int, float]:
    """
    Compute frame-differencing motion scores between consecutive keyframes.
    Returns {frame_index: motion_score} where higher = more motion.
    First frame gets a moderate score (no previous frame to compare).
    Uses frame_cache to avoid redundant decoding.
    """
    if len(keyframes) <= 1:
        return {kf["frame_index"]: 0.5 for kf in keyframes}

    scores: dict[int, float] = {}
    prev_gray = None

    for i, kf in enumerate(keyframes):
        frame_idx = kf["frame_index"]
        if frame_cache and frame_idx in frame_cache:
            frame = frame_cache[frame_idx]
        else:
            frame = read_frame_by_index(video_path, frame_idx)
        if frame is None:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (21, 21), 0)

        if prev_gray is None:
            scores[frame_idx] = 0.5
        else:
            diff = cv2.absdiff(prev_gray, gray)
            _, thresh = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
            motion = float(cv2.countNonZero(thresh)) / float(thresh.shape[0] * thresh.shape[1])
            scores[frame_idx] = min(1.0, motion * 5.0)

        prev_gray = gray

    return scores


def _candidate_centroid_x(candidate: PoseCandidate) -> float:
    """Return the horizontal center of a PoseCandidate's bounding box."""
    x_min, _, x_max, _ = candidate.bbox
    return (x_min + x_max) / 2.0


def detect_pose_candidates(frame: np.ndarray, pose_detector: StaticPoseDetector) -> list[PoseCandidate]:
    """Detect pose candidates using analyzer-specific strategy (tighter boxes, IoU=0.6)."""
    frame_h, frame_w = frame.shape[:2]

    # Get HOG proposals
    hog_detections = detect_hog_people(frame)
    proposals = [bbox for bbox, _ in hog_detections]

    if not proposals:
        proposals = [(0, 0, frame_w - 1, frame_h - 1)]

    candidates: list[PoseCandidate] = []
    for x1, y1, x2, y2 in proposals:
        crop = frame[y1:y2, x1:x2]
        if crop.size == 0:
            continue

        detections = pose_detector.detect(crop)
        if not detections:
            continue

        for local_landmarks in detections:
            global_landmarks = transform_landmarks_to_global(
                local_landmarks,
                crop_x1=x1,
                crop_y1=y1,
                crop_w=max(1, x2 - x1),
                crop_h=max(1, y2 - y1),
                frame_w=frame_w,
                frame_h=frame_h,
            )

            visibility = float(np.mean([lm["visibility"] for lm in global_landmarks]))
            # Analyzer uses body-only landmarks, no padding (tighter tracking boxes)
            bbox = bbox_from_landmarks(
                global_landmarks, frame_w, frame_h,
                landmark_indices=BODY_LANDMARK_INDICES,
            )
            candidates.append(PoseCandidate(landmarks=global_landmarks, bbox=bbox, visibility=visibility))

    # Fallback: try full frame if no HOG-crop candidates
    if not candidates:
        detections = pose_detector.detect(frame)
        for landmarks in detections:
            visibility = float(np.mean([lm["visibility"] for lm in landmarks]))
            bbox = bbox_from_landmarks(landmarks, frame_w, frame_h, landmark_indices=BODY_LANDMARK_INDICES)
            candidates.append(PoseCandidate(landmarks=landmarks, bbox=bbox, visibility=visibility))

    # Dedup: analyzer uses tighter IoU=0.6 (vs detector's 0.35)
    deduped: list[PoseCandidate] = []
    for cand in sorted(candidates, key=lambda c: c.visibility, reverse=True):
        skip = False
        for prev in deduped:
            if iou(prev.bbox, cand.bbox) > 0.6:
                skip = True
                break
        if not skip:
            deduped.append(cand)

    return deduped


def build_active_player_tracks(
    video_path: str,
    keyframes: list[dict[str, Any]],
    player_index: Optional[int],
    frame_cache: dict[int, np.ndarray] | None = None,
) -> list[dict[str, Any]]:
    """
    For each keyframe, detect and select the active player.
    Returns list of track dicts with landmarks, bbox, and visibility.
    """
    selected_centroid_x: Optional[float] = None
    if player_index is not None:
        detected_players = detect_players(video_path)
        target = next((p for p in detected_players if p["player_index"] == player_index), None)
        if target is None:
            raise NoPlayersDetectedError("Selected player index not found in this video")
        bbox = target["bbox"]
        selected_centroid_x = (bbox["x_min"] + bbox["x_max"]) / 2.0

    active_tracks: list[dict[str, Any]] = []

    if not pose_backend_available():
        for entry in keyframes:
            frame_idx = entry["frame_index"]
            if frame_cache and frame_idx in frame_cache:
                frame = frame_cache[frame_idx]
            else:
                frame = read_frame_by_index(video_path, frame_idx)
            if frame is None:
                continue
            detections = detect_hog_people(frame)
            if not detections:
                continue

            if selected_centroid_x is not None:
                (x_min, y_min, x_max, y_max), visibility = min(
                    detections,
                    key=lambda item: abs((((item[0][0] + item[0][2]) / 2.0) - selected_centroid_x)),
                )
            else:
                (x_min, y_min, x_max, y_max), visibility = max(
                    detections,
                    key=lambda item: (item[0][2] - item[0][0]) * (item[0][3] - item[0][1]) * item[1],
                )
            active_tracks.append(
                {
                    "frame_index": int(frame_idx),
                    "timestamp": float(entry["timestamp"]),
                    "landmarks": [],
                    "visibility": float(max(0.3, min(1.0, visibility))),
                    "bbox": {
                        "x_min": int(x_min),
                        "y_min": int(y_min),
                        "x_max": int(x_max),
                        "y_max": int(y_max),
                    },
                }
            )
    else:
        with StaticPoseDetector(min_detection_confidence=0.5, num_poses=8) as pose:
            for entry in keyframes:
                frame_idx = entry["frame_index"]
                if frame_cache and frame_idx in frame_cache:
                    frame = frame_cache[frame_idx]
                else:
                    frame = read_frame_by_index(video_path, frame_idx)
                if frame is None:
                    continue
                candidates = detect_pose_candidates(frame, pose)
                if not candidates:
                    continue

                if selected_centroid_x is not None:
                    active = min(candidates, key=lambda c: abs(_candidate_centroid_x(c) - selected_centroid_x))
                else:
                    active = max(candidates, key=lambda c: c.visibility)

                x_min, y_min, x_max, y_max = active.bbox
                active_tracks.append(
                    {
                        "frame_index": int(frame_idx),
                        "timestamp": float(entry["timestamp"]),
                        "landmarks": active.landmarks,
                        "visibility": float(active.visibility),
                        "bbox": {
                            "x_min": int(x_min),
                            "y_min": int(y_min),
                            "x_max": int(x_max),
                            "y_max": int(y_max),
                        },
                    }
                )

    if not active_tracks:
        raise NoPlayersDetectedError(
            "No players detected clearly in this video. Try better lighting or a less crowded frame."
        )

    return active_tracks
