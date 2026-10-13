from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from typing import Callable, Literal

import cv2
import numpy as np

from core.detection_utils import (
    ALL_LANDMARK_INDICES,
    BODY_LANDMARK_INDICES,
    detect_hog_people,
    iou,
    bbox_from_landmarks,
    transform_landmarks_to_global,
    PoseCandidate,
)
from core.config import MAX_SCAN_SAMPLES
from core.errors import NoPlayersDetectedError, VideoDecodeError
from core.pose_backend import StaticPoseDetector, pose_backend_available


@dataclass(frozen=True)
class PoseDetectionOptions:
    """Tuning knobs for pose-candidate detection (one seam, two tunings).

    The scan path wants wide boxes with merge-replace dedup; the tracking
    stage wants tight body-only boxes with skip dedup plus a full-frame
    fallback. Both cross `detect_pose_candidates` with their preset below.
    """

    landmark_indices: tuple[int, ...] | None = None
    min_visibility: float = 0.0
    padding_ratio: float = 0.0
    iou_threshold: float = 0.35
    dedup: Literal["merge", "skip"] = "merge"
    fallback_full_frame: bool = False


SCAN_DETECTION_OPTIONS = PoseDetectionOptions(
    landmark_indices=tuple(ALL_LANDMARK_INDICES),
    min_visibility=0.4,
    padding_ratio=0.35,
    iou_threshold=0.35,
    dedup="merge",
    fallback_full_frame=False,
)

TRACKING_DETECTION_OPTIONS = PoseDetectionOptions(
    landmark_indices=tuple(BODY_LANDMARK_INDICES),
    min_visibility=0.0,
    padding_ratio=0.0,
    iou_threshold=0.6,
    dedup="skip",
    fallback_full_frame=True,
)


def _candidates_from_proposals(
    frame: np.ndarray,
    proposals: list[tuple[int, int, int, int]],
    pose_detector: StaticPoseDetector,
    opts: PoseDetectionOptions,
    candidates: list[PoseCandidate],
) -> None:
    """Run pose detection over HOG proposals, appending (dedup: merge) or collecting."""
    frame_h, frame_w = frame.shape[:2]
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
            # transform_landmarks_to_global preserves visibility verbatim, so
            # the global mean equals the old local mean on both paths.
            visibility = float(np.mean([lm["visibility"] for lm in global_landmarks]))

            bbox = bbox_from_landmarks(
                global_landmarks, frame_w, frame_h,
                landmark_indices=list(opts.landmark_indices) if opts.landmark_indices is not None else None,
                min_visibility=opts.min_visibility,
                padding_ratio=opts.padding_ratio,
            )
            candidate = PoseCandidate(landmarks=global_landmarks, bbox=bbox, visibility=visibility)

            if opts.dedup == "merge":
                duplicate = False
                for existing in candidates:
                    if iou(existing.bbox, candidate.bbox) > opts.iou_threshold:
                        duplicate = True
                        if candidate.visibility > existing.visibility:
                            existing.landmarks = candidate.landmarks
                            existing.bbox = candidate.bbox
                            existing.visibility = candidate.visibility
                        break
                if not duplicate:
                    candidates.append(candidate)
            else:
                candidates.append(candidate)


def detect_pose_candidates(
    frame: np.ndarray,
    pose_detector: StaticPoseDetector,
    opts: PoseDetectionOptions | None = None,
) -> list[PoseCandidate]:
    """Detect pose candidates using HOG proposals + pose detection.

    The single detection seam: scan and tracking cross it with their own
    tuning (see SCAN_DETECTION_OPTIONS / TRACKING_DETECTION_OPTIONS).
    """
    options = opts or SCAN_DETECTION_OPTIONS
    frame_h, frame_w = frame.shape[:2]

    # Get HOG proposals
    hog_detections = detect_hog_people(frame)
    proposals = [bbox for bbox, _ in hog_detections]

    if not proposals:
        proposals = [(0, 0, frame_w - 1, frame_h - 1)]

    candidates: list[PoseCandidate] = []
    _candidates_from_proposals(frame, proposals, pose_detector, options, candidates)

    # Fallback: try full frame if no HOG-crop candidates (tracking path).
    if not candidates and options.fallback_full_frame:
        detections = pose_detector.detect(frame)
        for landmarks in detections:
            visibility = float(np.mean([lm["visibility"] for lm in landmarks]))
            bbox = bbox_from_landmarks(
                landmarks, frame_w, frame_h,
                landmark_indices=list(options.landmark_indices) if options.landmark_indices is not None else None,
                min_visibility=options.min_visibility,
                padding_ratio=options.padding_ratio,
            )
            candidates.append(PoseCandidate(landmarks=landmarks, bbox=bbox, visibility=visibility))

    if options.dedup == "skip":
        # Tighter dedup: visibility-ordered, first box wins.
        deduped: list[PoseCandidate] = []
        for cand in sorted(candidates, key=lambda c: c.visibility, reverse=True):
            skip = False
            for prev in deduped:
                if iou(prev.bbox, cand.bbox) > options.iou_threshold:
                    skip = True
                    break
            if not skip:
                deduped.append(cand)
        return deduped

    return candidates


def scan_timestamps(duration_seconds: float) -> np.ndarray:
    """Sample times for the best-frame scan: 1 Hz up to MAX_SCAN_SAMPLES,
    then a coarser stride spanning the full window (never more samples)."""
    window = duration_seconds if duration_seconds > 0 else 60.0
    dense = np.arange(0.0, window + 0.01, 1.0)
    if len(dense) <= MAX_SCAN_SAMPLES:
        return dense
    return np.linspace(0.0, window, MAX_SCAN_SAMPLES)


def score_and_select_best_frame(
    video_path: str,
    on_progress: "Callable[[int, int], None] | None" = None,
) -> tuple[np.ndarray, float]:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise VideoDecodeError("Could not open video for frame extraction")

    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS))
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration_seconds = frame_count / fps if fps > 0 else 0

        timestamps = scan_timestamps(duration_seconds)
        total_frames = len(timestamps)

        best_frame: np.ndarray | None = None
        best_timestamp = 0.0
        best_score = -1e9
        found_visible_pose = False

        if not pose_backend_available():
            for frame_idx, ts in enumerate(timestamps):
                if on_progress:
                    on_progress(frame_idx + 1, total_frames)

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
                for frame_idx, ts in enumerate(timestamps):
                    if on_progress:
                        on_progress(frame_idx + 1, total_frames)

                    frame_index = int(ts * fps) if fps > 0 else int(ts * 30)
                    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
                    ok, frame = cap.read()
                    if not ok:
                        continue

                    candidates = detect_pose_candidates(frame, pose)
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
            candidates = detect_pose_candidates(frame, pose)

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


def detect_players(
    video_path: str,
    on_progress: "Callable[[int, int], None] | None" = None,
) -> list[dict]:
    try:
        frame, timestamp = score_and_select_best_frame(video_path, on_progress=on_progress)
        return extract_players(frame, frame_timestamp=timestamp)
    except (NoPlayersDetectedError, VideoDecodeError):
        raise
    except cv2.error as exc:
        logging.error(f"OpenCV error in detect_players: {exc}")
        raise VideoDecodeError("Could not read this video file. Try MP4, MOV, or AVI format.") from exc
    except Exception as exc:
        logging.error(f"Unexpected error in detect_players: {type(exc).__name__}: {exc}")
        raise VideoDecodeError("Could not read this video file. Try MP4, MOV, or AVI format.") from exc
