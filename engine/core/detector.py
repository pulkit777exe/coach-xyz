from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from typing import Any, List, Tuple

import cv2
import numpy as np

from core.errors import NoPlayersDetectedError, VideoDecodeError
from core.pose_backend import StaticPoseDetector, pose_backend_available


# All 33 MediaPipe pose landmarks — use the full body extent
# Head (0-10), shoulders (11,12), elbows (13,14), wrists (15,16),
# hips (23,24), knees (25,26), ankles (27,28), feet (29-32)
# Filter by visibility > 0.4 to exclude undetected landmarks
POSE_LANDMARKS_FOR_BOX = list(range(33))
POSE_LANDMARK_MIN_VISIBILITY = 0.4


@dataclass
class PoseCandidate:
    landmarks: list[dict[str, float]]
    bbox: tuple[int, int, int, int]
    visibility: float


def _detect_hog_people(frame: np.ndarray) -> list[tuple[tuple[int, int, int, int], float]]:
    frame_h, frame_w = frame.shape[:2]
    hog = cv2.HOGDescriptor()
    hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

    boxes, weights = hog.detectMultiScale(
        frame,
        winStride=(8, 8),
        padding=(8, 8),
        scale=1.05,
    )

    out: list[tuple[tuple[int, int, int, int], float]] = []
    for idx, (x, y, w, h) in enumerate(boxes):
        x1 = max(0, int(x))
        y1 = max(0, int(y))
        x2 = min(frame_w - 1, int(x + w))
        y2 = min(frame_h - 1, int(y + h))
        if x2 <= x1 or y2 <= y1:
            continue
        weight = float(weights[idx]) if idx < len(weights) else 0.6
        out.append(((x1, y1, x2, y2), weight))

    return out


def _iou(box_a: tuple[int, int, int, int], box_b: tuple[int, int, int, int]) -> float:
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b

    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)

    iw = max(0, ix2 - ix1)
    ih = max(0, iy2 - iy1)
    inter = iw * ih
    if inter == 0:
        return 0.0

    area_a = max(1, (ax2 - ax1) * (ay2 - ay1))
    area_b = max(1, (bx2 - bx1) * (by2 - by1))
    union = area_a + area_b - inter
    return inter / max(1.0, float(union))


def _bbox_from_landmarks(
    landmarks: list[dict[str, float]],
    frame_w: int,
    frame_h: int,
    padding_ratio: float = 0.35,
) -> tuple[int, int, int, int]:
    # Only use landmarks with sufficient visibility
    visible = [
        lm for lm in landmarks
        if lm.get("visibility", 1.0) > POSE_LANDMARK_MIN_VISIBILITY
    ]
    if not visible:
        visible = landmarks  # fallback: use all if none pass threshold

    xs = [lm["x"] for lm in visible]
    ys = [lm["y"] for lm in visible]

    x_min = int(min(xs) * frame_w)
    x_max = int(max(xs) * frame_w)
    y_min = int(min(ys) * frame_h)
    y_max = int(max(ys) * frame_h)

    width = max(1, x_max - x_min)
    height = max(1, y_max - y_min)

    # Asymmetric padding: more on top for head clearance
    pad_x = int(width * padding_ratio)
    pad_top = int(height * (padding_ratio + 0.15))  # extra head room
    pad_bot = int(height * padding_ratio)

    x_min = max(0, x_min - pad_x)
    y_min = max(0, y_min - pad_top)
    x_max = min(frame_w - 1, x_max + pad_x)
    y_max = min(frame_h - 1, y_max + pad_bot)

    return x_min, y_min, x_max, y_max


def _transform_landmarks_to_global(
    landmarks: list[dict[str, float]],
    crop_x1: int,
    crop_y1: int,
    crop_w: int,
    crop_h: int,
    frame_w: int,
    frame_h: int,
) -> list[dict[str, float]]:
    transformed: list[dict[str, float]] = []
    for lm in landmarks:
        gx = (crop_x1 + lm["x"] * crop_w) / max(1, frame_w)
        gy = (crop_y1 + lm["y"] * crop_h) / max(1, frame_h)
        transformed.append(
            {
                "x": float(np.clip(gx, 0.0, 1.0)),
                "y": float(np.clip(gy, 0.0, 1.0)),
                "z": lm["z"],
                "visibility": lm["visibility"],
            }
        )
    return transformed


def _detect_pose_candidates(frame: np.ndarray, pose_detector: StaticPoseDetector) -> list[PoseCandidate]:
    frame_h, frame_w = frame.shape[:2]
    hog = cv2.HOGDescriptor()
    hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

    proposals: list[tuple[int, int, int, int]] = []
    boxes, _ = hog.detectMultiScale(frame, winStride=(8, 8), padding=(8, 8), scale=1.05)
    for (x, y, w, h) in boxes:
        x1 = max(0, int(x))
        y1 = max(0, int(y))
        x2 = min(frame_w - 1, int(x + w))
        y2 = min(frame_h - 1, int(y + h))
        if x2 > x1 and y2 > y1:
            proposals.append((x1, y1, x2, y2))

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
            global_landmarks = _transform_landmarks_to_global(
                local_landmarks,
                crop_x1=x1,
                crop_y1=y1,
                crop_w=max(1, x2 - x1),
                crop_h=max(1, y2 - y1),
                frame_w=frame_w,
                frame_h=frame_h,
            )

            bbox = _bbox_from_landmarks(global_landmarks, frame_w, frame_h, padding_ratio=0.35)
            candidate = PoseCandidate(landmarks=global_landmarks, bbox=bbox, visibility=avg_visibility)

            duplicate = False
            for existing in candidates:
                if _iou(existing.bbox, candidate.bbox) > 0.35:
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

    fps = float(cap.get(cv2.CAP_PROP_FPS))
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration_seconds = frame_count / fps if fps > 0 else 0

    max_scan_seconds = min(60.0, duration_seconds if duration_seconds > 0 else 60.0)
    timestamps = np.arange(0.0, max_scan_seconds + 0.01, 2.0)

    best_frame: np.ndarray | None = None
    best_timestamp = 0.0
    best_score = -1e9
    found_visible_pose = False

    if not pose_backend_available():
        for ts in timestamps:
            if fps <= 0:
                frame_index = int(ts * 30)
            else:
                frame_index = int(ts * fps)
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            ok, frame = cap.read()
            if not ok:
                continue

            detections = _detect_hog_people(frame)
            if not detections:
                continue

            found_visible_pose = True
            num_detected = len(detections)
            avg_visibility = float(np.mean([weight for _, weight in detections]))

            overlap_penalty = 0.0
            for i in range(len(detections)):
                for j in range(i + 1, len(detections)):
                    overlap_penalty += _iou(detections[i][0], detections[j][0])

            score = (num_detected * avg_visibility) - overlap_penalty
            if score > best_score:
                best_score = score
                best_frame = frame.copy()
                best_timestamp = float(ts)
    else:
        with StaticPoseDetector(min_detection_confidence=0.5, num_poses=8) as pose:
            for ts in timestamps:
                if fps <= 0:
                    frame_index = int(ts * 30)
                else:
                    frame_index = int(ts * fps)
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
                        overlap_penalty += _iou(valid[i].bbox, valid[j].bbox)

                score = (num_detected * avg_visibility) - overlap_penalty
                if score > best_score:
                    best_score = score
                    best_frame = frame.copy()
                    best_timestamp = float(ts)

    cap.release()

    if not found_visible_pose or best_frame is None:
        raise NoPlayersDetectedError(
            "No players detected clearly in this video. Try better lighting or a less crowded frame."
        )

    return best_frame, best_timestamp


def _enhance_and_encode_crop(
    crop: np.ndarray,
    target_size: int = 320,
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
        # Use INTER_CUBIC for upscaling — better quality than linear
        new_w = max(1, int(w * scale))
        new_h = max(1, int(h * scale))
        crop = cv2.resize(crop, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
    elif scale < 1.0:
        # Downscale with INTER_AREA — avoids aliasing
        new_w = max(1, int(w * scale))
        new_h = max(1, int(h * scale))
        crop = cv2.resize(crop, (new_w, new_h), interpolation=cv2.INTER_AREA)

    # Step 2: CLAHE for contrast (helps dark/poorly lit crops)
    lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4))
    l_channel = clahe.apply(l_channel)
    lab = cv2.merge([l_channel, a_channel, b_channel])
    crop = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)

    # Step 3: Mild unsharp mask for motion blur
    gaussian = cv2.GaussianBlur(crop, (0, 0), 1.5)
    crop = cv2.addWeighted(crop, 1.4, gaussian, -0.4, 0)
    crop = np.clip(crop, 0, 255).astype(np.uint8)

    # Step 4: Encode as JPEG (better file size, good visual quality)
    encode_params = [cv2.IMWRITE_JPEG_QUALITY, 92]
    ok, buffer = cv2.imencode(".jpg", crop, encode_params)
    if not ok:
        return ""
    return base64.b64encode(buffer.tobytes()).decode("utf-8")


def extract_players(frame: np.ndarray, frame_timestamp: float = 0.0) -> list[dict]:
    if frame is None or frame.size == 0:
        raise NoPlayersDetectedError("Frame is empty")

    players: list[dict] = []

    if not pose_backend_available():
        for bbox, weight in _detect_hog_people(frame):
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
        with StaticPoseDetector(min_detection_confidence=0.5, num_poses=8) as pose:
            candidates = _detect_pose_candidates(frame, pose)

        for candidate in candidates:
            x_min, y_min, x_max, y_max = candidate.bbox
            crop_w = x_max - x_min
            crop_h = y_max - y_min

            # Skip crops that are too small to be useful
            # A real player should occupy at least 40x80 pixels
            if crop_w < 40 or crop_h < 80:
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
