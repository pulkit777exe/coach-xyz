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
    PoseCandidate,
)
from core.detector import detect_players
from core.errors import NoPlayersDetectedError
from core.pose_backend import StaticPoseDetector, pose_backend_available
from core.video_io import read_frame_by_index


def compute_joint_angles(landmarks: list[dict[str, float]]) -> dict[str, float]:
    """
    Compute 2D joint angles from pose landmarks using geometric math.
    Returns dictionary of joint names to angles in degrees.

    Landmarks should contain all 33 MediaPipe pose landmarks with x, y, z coordinates.
    Joint angles are calculated using vector cross product and dot product.
    """
    if not landmarks or len(landmarks) < 33:
        return {}

    def angle_between(v1: np.ndarray, v2: np.ndarray) -> float:
        """Calculate angle between two vectors in degrees."""
        dot = np.dot(v1, v2)
        norm_v1 = np.linalg.norm(v1)
        norm_v2 = np.linalg.norm(v2)
        cos_angle = dot / (norm_v1 * norm_v2 + 1e-6)
        cos_angle = np.clip(cos_angle, -1.0, 1.0)
        angle = np.degrees(np.arccos(cos_angle))
        return angle

    def vector(p1: dict, p2: dict) -> np.ndarray:
        return np.array([p2["x"] - p1["x"], p2["y"] - p1["y"]])

    def calculate_angle(a: int, b: int, c: int) -> float:
        """Calculate angle between points a-b-c (b is vertex)."""
        a_landmark = landmarks[a]
        b_landmark = landmarks[b]
        c_landmark = landmarks[c]

        v1 = vector(a_landmark, b_landmark)
        v2 = vector(c_landmark, b_landmark)
        return angle_between(v1, v2)

    # Key joint angle calculations using standard anatomical landmarks
    # MediaPipe pose landmark indices:
    # 11: left_shoulder, 12: right_shoulder
    # 23: left_hip, 24: right_hip
    # 13: left_elbow, 14: right_elbow
    # 15: left_wrist, 16: right_wrist
    # 25: left_pinky, 26: right_pinky
    # 27: left_index, 28: right_index
    # 19: left_thumb, 20: right_thumb
    # 23: left_hip, 24: right_hip
    # 25: left_knee, 26: right_knee
    # 27: left_ankle, 28: right_ankle
    # 31: left_heel, 32: right_heel
    # 29: left_foot_index, 30: right_foot_index

    joints = {}

    # Upper body
    joints["left_shoulder_elbow_angle"] = calculate_angle(11, 13, 15)
    joints["right_shoulder_elbow_angle"] = calculate_angle(12, 14, 16)
    joints["left_elbow_wrist_angle"] = calculate_angle(13, 15, 17)
    joints["right_elbow_wrist_angle"] = calculate_angle(14, 16, 18)

    # Lower body - typically measured from knee to hip
    joints["left_hip_knee_angle"] = calculate_angle(23, 25, 27)
    joints["right_hip_knee_angle"] = calculate_angle(24, 26, 28)
    joints["left_knee_ankle_angle"] = calculate_angle(25, 27, 29)
    joints["right_knee_ankle_angle"] = calculate_angle(26, 28, 30)

    # Torso - shoulder to hip angle (important for posture)
    joints["torso_lean_left"] = calculate_angle(11, 23, 24)
    joints["torso_lean_right"] = calculate_angle(12, 23, 24)

    # Wrist/hand - finger extension
    joints["left_wrist_finger_ext"] = calculate_angle(15, 17, 19)
    joints["right_wrist_finger_ext"] = calculate_angle(16, 18, 20)

    # Ankle - knee to ankle to foot angle
    joints["left_ankle_foot_angle"] = calculate_angle(27, 29, 31)
    joints["right_ankle_foot_angle"] = calculate_angle(28, 30, 32)

    return joints


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


def select_detection_by_index(
    detections: list[tuple[tuple[float, float, float, float], float]],
    player_index: int,
) -> tuple[float, float, float, float]:
    """Pick the target bbox for a 1-based player_index.

    Sorts left-to-right by x_min to match detector.extract_players (the scan
    pipeline assigns player_index in x_min order). Raises
    NoPlayersDetectedError when the index is out of range instead of silently
    clamping to a different athlete.
    """
    ordered = sorted(detections, key=lambda d: d[0][0])
    if player_index < 1 or player_index - 1 >= len(ordered):
        raise NoPlayersDetectedError("Selected player was not found in the opening frames")
    return ordered[player_index - 1][0]


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
    # Resolve the target player's horizontal centroid so we can pick the
    # closest candidate in each frame.  We derive it from the first keyframe
    # that has a detectable player rather than re-running detect_players()
    # (which would open the video a second time and repeat HOG scanning).
    selected_centroid_x: Optional[float] = None
    if player_index is not None:
        # Try to infer centroid from the first available keyframe
        _first_frame: Optional[np.ndarray] = None
        for _kf in keyframes[:3]:  # check up to the first 3 frames
            _fi = _kf["frame_index"]
            if frame_cache and _fi in frame_cache:
                _first_frame = frame_cache[_fi]
            else:
                _first_frame = read_frame_by_index(video_path, _fi)
            if _first_frame is not None:
                break

        if _first_frame is not None:
            _detections = detect_hog_people(_first_frame)
            if _detections:
                try:
                    _bbox = select_detection_by_index(_detections, player_index)
                except NoPlayersDetectedError:
                    _bbox = None
                if _bbox is not None:
                    selected_centroid_x = (_bbox[0] + _bbox[2]) / 2.0

        # Fall back to full detect_players() only if HOG gave nothing
        if selected_centroid_x is None:
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

    # Compute joint angles for each track (biomechanical metrics)
    for track in active_tracks:
        landmarks = track.get("landmarks", [])
        if landmarks:
            # Compute joint angles using deterministic geometry
            angles = compute_joint_angles(landmarks)
            track["joint_angles"] = angles

        # Add elbow extension angle (key metric for shooting sports)
        landmarks = track.get("landmarks", [])
        if landmarks and len(landmarks) > 16:
            # Elbow extension angle using left shoulder (11), left elbow (13), left wrist (15)
            def vector_angle(p1: dict, p2: dict) -> float:
                return np.arctan2(p2["y"] - p1["y"], p2["x"] - p1["x"])

            try:
                shoulder = landmarks[11]
                elbow = landmarks[13]
                wrist = landmarks[15]

                # Vector from shoulder to elbow
                v_shoulder_elbow = vector_angle(shoulder, elbow)
                # Vector from elbow to wrist
                v_elbow_wrist = vector_angle(elbow, wrist)

                # Angle difference (larger = more extended)
                elbow_extension = abs(v_elbow_wrist - v_shoulder_elbow)
                track["elbow_extension_angle"] = float(np.degrees(elbow_extension))
            except (IndexError, KeyError):
                pass

    return active_tracks
