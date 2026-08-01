from __future__ import annotations

import base64
import logging
from dataclasses import dataclass

import cv2
import numpy as np

from core.detection_utils import (
    ALL_LANDMARK_INDICES,
    detect_hog_people,
    iou,
    bbox_from_landmarks,
    transform_landmarks_to_global,
)
from core.errors import NoPlayersDetectedError, VideoDecodeError
from core.pose_backend import StaticPoseDetector, pose_backend_available


@dataclass
class PoseCandidate:
    landmarks: list[dict[str, float]]
    bbox: tuple[int, int, int, int]
    visibility: float


def _detect_pose_candidates(frame: np.ndarray, pose_detector: StaticPoseDetector) -> list[PoseCandidate]:
    """Detect pose candidates using HOG proposals + pose detection."""
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
            avg_visibility = float(np.mean([lm["visibility"] for lm in local_landmarks]))
            global_landmarks = transform_landmarks_to_global(
                local_landmarks,
                crop_x1=x1,
                crop_y1=y1,
                crop_w=max(1, x2 - x1),
                crop_h=max(1, y2 - y1),
                frame_w=frame_w,
                frame_h=frame_h,
            )

            bbox = bbox_from_landmarks(
                global_landmarks, frame_w, frame_h,
                landmark_indices=ALL_LANDMARK_INDICES,
                min_visibility=0.4,
                padding_ratio=0.35,
            )
            candidate = PoseCandidate(landmarks=global_landmarks, bbox=bbox, visibility=avg_visibility)

            # Dedup with IoU threshold 0.35 (detector uses wider boxes)
            duplicate = False
            for existing in candidates:
                if iou(existing.bbox, candidate.bbox) > 0.35:
                    duplicate = True
                    if candidate.visibility > existing.visibility:
                        existing.landmarks = candidate.landmarks
                        existing.bbox = candidate.bbox
                        existing.visibility = candidate.visibility
                    break
            if not duplicate:
                candidates.append(candidate)

    return candidates


def score_and_select_best_frame(video_path: str) -> tuple[np.ndarray, float]:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise VideoDecodeError("Could not open video for frame extraction")

    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS))
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration_seconds = frame_count / fps if fps > 0 else 0

        max_scan_seconds = duration_seconds if duration_seconds > 0 else 60.0
        timestamps = np.arange(0.0, max_scan_seconds + 0.01, 1.0)

        best_frame: np.ndarray | None = None
        best_timestamp = 0.0
        best_score = -1e9
        found_visible_pose = False

        if not pose_backend_available():
            for ts in timestamps:
                frame_index = int(ts * fps) if fps > 0 else int(ts * 30)
                cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
                ok, frame = cap.read()
                if not ok:
                    continue

                detections = detect_hog_people(frame)
                if not detections:
                    continue

                found_visible_pose = True
                num_detected = len(detections)
                avg_visibility = float(np.mean([weight for _, weight in detections]))

                overlap_penalty = 0.0
                for i in range(len(detections)):
                    for j in range(i + 1, len(detections)):
                        overlap_penalty += iou(detections[i][0], detections[j][0])

                score = (num_detected * avg_visibility) - overlap_penalty
                if score > best_score:
                    best_score = score
                    best_frame = frame.copy()
                    best_timestamp = float(ts)
        else:
            with StaticPoseDetector(min_detection_confidence=0.5, num_poses=12) as pose:
                for ts in timestamps:
                    frame_index = int(ts * fps) if fps > 0 else int(ts * 30)
                    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
                    ok, frame = cap.read()
                    if not ok:
                        continue

                    candidates = _detect_pose_candidates(frame, pose)
                    valid = [c for c in candidates if c.visibility > 0.5]
                    if not valid:
                        continue

                    found_visible_pose = True
                    num_detected = len(valid)
                    avg_visibility = float(np.mean([c.visibility for c in valid]))

                    overlap_penalty = 0.0
                    for i in range(len(valid)):
                        for j in range(i + 1, len(valid)):
                            overlap_penalty += iou(valid[i].bbox, valid[j].bbox)

                    score = (num_detected * avg_visibility) - overlap_penalty
                    if score > best_score:
                        best_score = score
                        best_frame = frame.copy()
                        best_timestamp = float(ts)
    finally:
        cap.release()

    if not found_visible_pose or best_frame is None:
        raise NoPlayersDetectedError(
            "No players detected clearly in this video. Try better lighting or a less crowded frame."
        )

    return best_frame, best_timestamp


def _enhance_and_encode_crop(
    crop: np.ndarray,
    target_size: int = 480,
) -> str:
    """
    Enhance a player crop for display quality:
    1. Upscale to consistent size (320px on the longer side)
    2. Apply CLAHE for contrast enhancement in dark/flat crops
    3. Mild unsharp mask for sharpening motion-blurred frames
    4. Encode as JPEG at quality 92 (smaller than PNG, looks better on screen)
    """
    if crop is None or crop.size == 0:
        return ""

    h, w = crop.shape[:2]
    if h == 0 or w == 0:
        return ""

    # Step 1: Upscale to consistent display size
    scale = target_size / max(h, w)
    if scale > 1.0:
        new_w = max(1, int(w * scale))
        new_h = max(1, int(h * scale))
        crop = cv2.resize(crop, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
    elif scale < 1.0:
        new_w = max(1, int(w * scale))
        new_h = max(1, int(h * scale))
        crop = cv2.resize(crop, (new_w, new_h), interpolation=cv2.INTER_AREA)

    # Step 2: CLAHE for contrast (helps dark/poorly lit crops)
    lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(4, 4))
    l_channel = clahe.apply(l_channel)
    lab = cv2.merge([l_channel, a_channel, b_channel])
    crop = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)

    # Step 3: Mild unsharp mask for motion blur
    gaussian = cv2.GaussianBlur(crop, (0, 0), 1.2)
    crop = cv2.addWeighted(crop, 1.3, gaussian, -0.3, 0)
    crop = np.clip(crop, 0, 255).astype(np.uint8)

    # Step 4: Encode as JPEG (better file size, good visual quality)
    encode_params = [cv2.IMWRITE_JPEG_QUALITY, 92]
    ok, buffer = cv2.imencode(".jpg", crop, encode_params)
    if not ok:
        logging.warning(f"[SCAN] cv2.imencode failed for crop of shape {crop.shape}")
        return ""
    result = base64.b64encode(buffer.tobytes()).decode("utf-8")
    logging.info(f"[SCAN] crop encoded: shape={crop.shape}, jpeg_bytes={len(buffer)}, base64_len={len(result)}")
    return result


def extract_players(frame: np.ndarray, frame_timestamp: float = 0.0) -> list[dict]:
    if frame is None or frame.size == 0:
        raise NoPlayersDetectedError("Frame is empty")

    players: list[dict] = []

    if not pose_backend_available():
        for bbox, weight in detect_hog_people(frame):
            x_min, y_min, x_max, y_max = bbox
            crop = frame[y_min:y_max, x_min:x_max]
            if crop.size == 0:
                continue
            players.append(
                {
                    "confidence": round(float(max(0.3, min(1.0, weight))), 2),
                    "bbox": {
                        "x_min": int(x_min),
                        "y_min": int(y_min),
                        "x_max": int(x_max),
                        "y_max": int(y_max),
                    },
                    "crop_base64": _enhance_and_encode_crop(crop),
                    "frame_timestamp": float(round(frame_timestamp, 2)),
                }
            )
    else:
        with StaticPoseDetector(min_detection_confidence=0.5, num_poses=12) as pose:
            candidates = _detect_pose_candidates(frame, pose)

        for candidate in candidates:
            x_min, y_min, x_max, y_max = candidate.bbox
            crop_w = x_max - x_min
            crop_h = y_max - y_min

            # Skip crops that are too small to be useful
            # A real player should occupy at least 40x80 pixels
            if crop_w < 24 or crop_h < 48:
                continue

            crop = frame[y_min:y_max, x_min:x_max]
            if crop.size == 0:
                continue

            players.append(
                {
                    "confidence": round(float(candidate.visibility), 2),
                    "bbox": {
                        "x_min": int(x_min),
                        "y_min": int(y_min),
                        "x_max": int(x_max),
                        "y_max": int(y_max),
                    },
                    "crop_base64": _enhance_and_encode_crop(crop),
                    "frame_timestamp": float(round(frame_timestamp, 2)),
                }
            )

    players = [p for p in players if p["confidence"] > 0.5]
    if not players:
        raise NoPlayersDetectedError(
            "No players detected clearly in this video. Try better lighting or a less crowded frame."
        )

    players.sort(key=lambda p: p["bbox"]["x_min"])
    for idx, player in enumerate(players, start=1):
        player["player_index"] = idx

    return players


def detect_players(video_path: str) -> list[dict]:
    try:
        frame, timestamp = score_and_select_best_frame(video_path)
        return extract_players(frame, frame_timestamp=timestamp)
    except (NoPlayersDetectedError, VideoDecodeError):
        raise
    except cv2.error as exc:
        logging.error(f"OpenCV error in detect_players: {exc}")
        raise VideoDecodeError("Could not read this video file. Try MP4, MOV, or AVI format.") from exc
    except Exception as exc:
        logging.error(f"Unexpected error in detect_players: {type(exc).__name__}: {exc}")
        raise VideoDecodeError("Could not read this video file. Try MP4, MOV, or AVI format.") from exc
