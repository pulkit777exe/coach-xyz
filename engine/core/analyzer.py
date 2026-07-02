from __future__ import annotations

import asyncio
import json
import os
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np

# Cached HOG descriptor (avoids re-creation per frame)
_HOG_DESCRIPTOR = cv2.HOGDescriptor()
_HOG_DESCRIPTOR.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

try:
    from google import genai
    from google.genai import errors as genai_errors
    from google.genai import types as genai_types
except Exception:
    genai = None
    genai_errors = None
    genai_types = None

from core.cache import compute_video_hash, get_cached_analysis, set_cached_analysis
from core.dedup import deduplicator
from core.detector import PoseCandidate, detect_players
from core.errors import EngineError, GeminiParseError, GeminiQuotaError, NoPlayersDetectedError, VideoDecodeError, VideoExpiredError
from core.jobs import STAGES, register_job_input, update_job, transition_job, fail_job
from core.pose_backend import StaticPoseDetector, pose_backend_available
from core.renderer import render_video
from core import storage


def _tmp_dir() -> Path:
    return Path(tempfile.gettempdir()).resolve()


def _preprocess_video_ffmpeg(video_path: str) -> str:
    """
    Normalize input video stream for stable OpenCV decoding.
    Uses ffmpeg only for pre-processing.
    """
    tmp_dir = _tmp_dir()
    tmp_dir.mkdir(parents=True, exist_ok=True)

    output_path = tmp_dir / f"pre_{uuid.uuid4().hex}.mp4"
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
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return str(output_path)
    except Exception:
        return video_path


def _extract_keyframes(video_path: str) -> tuple[list[dict[str, Any]], float, int]:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise VideoDecodeError("Could not open video for frame extraction")

    fps = float(cap.get(cv2.CAP_PROP_FPS))
    if fps <= 0:
        fps = 30.0
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    if frame_count > 0:
        duration = frame_count / fps
    else:
        duration = 90.0

    timestamps = np.arange(0.0, duration + 0.01, 3.0)
    if len(timestamps) > 30:
        timestamps = timestamps[:30]

    keyframes: list[dict[str, Any]] = []
    frame_cache: dict[int, np.ndarray] = {}  # Cache decoded frames
    for ts in timestamps:
        frame_index = int(round(ts * fps))
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
        ok, frame = cap.read()
        if not ok or frame is None:
            continue
        # Store metadata and cache decoded frame (avoid redundant decoding)
        keyframes.append(
            {
                "frame_index": frame_index,
                "timestamp": float(round(ts, 2)),
            }
        )
        frame_cache[frame_index] = frame

    cap.release()
    if not keyframes:
        raise VideoDecodeError("Could not extract keyframes from video")

    return keyframes, fps, frame_count, frame_cache


def _read_frame_by_index(video_path: str, frame_index: int) -> np.ndarray | None:
    """Read a single frame from video by frame index. Memory-efficient: loads only one frame."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return None
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
    ok, frame = cap.read()
    cap.release()
    return frame if ok else None


def _compute_motion_scores(
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
        # Use cached frame if available, otherwise read from disk
        if frame_cache and frame_idx in frame_cache:
            frame = frame_cache[frame_idx]
        else:
            frame = _read_frame_by_index(video_path, frame_idx)
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


def _build_frame_metadata(track: dict[str, Any], fps: float) -> str:
    """
    Build a text metadata string for a frame to send alongside the image.
    Includes bounding box position and key pose landmark angles.
    """
    parts = []

    bbox = track.get("bbox")
    if bbox:
        x_min = bbox.get("x_min", 0)
        x_max = bbox.get("x_max", 0)
        y_min = bbox.get("y_min", 0)
        y_max = bbox.get("y_max", 0)
        cx = (x_min + x_max) / 2.0
        parts.append(f"Player at x={x_min}-{x_max}, y={y_min}-{y_max} (center_x={cx:.0f})")

    landmarks = track.get("landmarks")
    if landmarks and len(landmarks) >= 25:
        try:
            def angle(a, b, c):
                ba = np.array([a["x"] - b["x"], a["y"] - b["y"]])
                bc = np.array([c["x"] - b["x"], c["y"] - b["y"]])
                cos_angle = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-6)
                return float(np.degrees(np.arccos(np.clip(cos_angle, -1.0, 1.0))))

            left_knee_angle = angle(landmarks[23], landmarks[25], landmarks[27])
            right_knee_angle = angle(landmarks[24], landmarks[26], landmarks[28])
            left_elbow_angle = angle(landmarks[11], landmarks[13], landmarks[15])
            right_elbow_angle = angle(landmarks[12], landmarks[14], landmarks[16])

            hip = ((landmarks[23]["x"] + landmarks[24]["x"]) / 2,
                   (landmarks[23]["y"] + landmarks[24]["y"]) / 2)
            shoulder = ((landmarks[11]["x"] + landmarks[12]["x"]) / 2,
                        (landmarks[11]["y"] + landmarks[12]["y"]) / 2)
            torso_lean = abs(hip[0] - shoulder[0]) * 100

            parts.append(
                f"Pose: L-knee={left_knee_angle:.0f}° R-knee={right_knee_angle:.0f}° "
                f"L-elbow={left_elbow_angle:.0f}° R-elbow={right_elbow_angle:.0f}° "
                f"torso_lean={torso_lean:.0f}%"
            )
        except (KeyError, IndexError, ZeroDivisionError):
            pass

    return ". ".join(parts) if parts else "No position data"


def _bbox_from_landmarks(
    landmarks: list[dict[str, float]],
    width: int,
    height: int,
) -> tuple[int, int, int, int]:
    indices = [11, 12, 23, 24, 27, 28]
    points = [landmarks[i] for i in indices if i < len(landmarks)]
    if not points:
        points = landmarks

    xs = [p["x"] for p in points]
    ys = [p["y"] for p in points]

    x_min = max(0, int(min(xs) * width))
    x_max = min(width - 1, int(max(xs) * width))
    y_min = max(0, int(min(ys) * height))
    y_max = min(height - 1, int(max(ys) * height))

    if x_max <= x_min:
        x_max = min(width - 1, x_min + 1)
    if y_max <= y_min:
        y_max = min(height - 1, y_min + 1)

    return x_min, y_min, x_max, y_max


def _candidate_centroid_x(candidate: PoseCandidate) -> float:
    x_min, _, x_max, _ = candidate.bbox
    return (x_min + x_max) / 2.0


def _detect_hog_boxes(frame: np.ndarray) -> list[tuple[tuple[int, int, int, int], float]]:
    frame_h, frame_w = frame.shape[:2]

    boxes, weights = _HOG_DESCRIPTOR.detectMultiScale(
        frame,
        winStride=(8, 8),
        padding=(8, 8),
        scale=1.05,
    )

    detections: list[tuple[tuple[int, int, int, int], float]] = []
    for idx, (x, y, w, h) in enumerate(boxes):
        x1 = max(0, int(x))
        y1 = max(0, int(y))
        x2 = min(frame_w - 1, int(x + w))
        y2 = min(frame_h - 1, int(y + h))
        if x2 <= x1 or y2 <= y1:
            continue
        confidence = float(weights[idx]) if idx < len(weights) else 0.6
        detections.append(((x1, y1, x2, y2), confidence))

    return detections


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
            transformed: list[dict[str, float]] = []
            for lm in local_landmarks:
                gx = (x1 + lm["x"] * max(1, x2 - x1)) / max(1, frame_w)
                gy = (y1 + lm["y"] * max(1, y2 - y1)) / max(1, frame_h)
                transformed.append(
                    {
                        "x": float(np.clip(gx, 0.0, 1.0)),
                        "y": float(np.clip(gy, 0.0, 1.0)),
                        "z": lm["z"],
                        "visibility": lm["visibility"],
                    }
                )

            visibility = float(np.mean([lm["visibility"] for lm in transformed]))
            bbox = _bbox_from_landmarks(transformed, frame_w, frame_h)
            candidates.append(PoseCandidate(landmarks=transformed, bbox=bbox, visibility=visibility))

    if not candidates:
        detections = pose_detector.detect(frame)
        for landmarks in detections:
            visibility = float(np.mean([lm["visibility"] for lm in landmarks]))
            bbox = _bbox_from_landmarks(landmarks, frame_w, frame_h)
            candidates.append(PoseCandidate(landmarks=landmarks, bbox=bbox, visibility=visibility))

    deduped: list[PoseCandidate] = []
    for cand in sorted(candidates, key=lambda c: c.visibility, reverse=True):
        skip = False
        for prev in deduped:
            px1, py1, px2, py2 = prev.bbox
            cx1, cy1, cx2, cy2 = cand.bbox
            ix1 = max(px1, cx1)
            iy1 = max(py1, cy1)
            ix2 = min(px2, cx2)
            iy2 = min(py2, cy2)
            iw = max(0, ix2 - ix1)
            ih = max(0, iy2 - iy1)
            inter = iw * ih
            prev_area = max(1, (px2 - px1) * (py2 - py1))
            cand_area = max(1, (cx2 - cx1) * (cy2 - cy1))
            iou = inter / max(1.0, float(prev_area + cand_area - inter))
            if iou > 0.6:
                skip = True
                break
        if not skip:
            deduped.append(cand)

    return deduped


def _build_active_player_tracks(
    video_path: str,
    keyframes: list[dict[str, Any]],
    player_index: Optional[int],
    frame_cache: dict[int, np.ndarray] | None = None,
) -> list[dict[str, Any]]:
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
            # Use cached frame if available, otherwise read from disk
            if frame_cache and frame_idx in frame_cache:
                frame = frame_cache[frame_idx]
            else:
                frame = _read_frame_by_index(video_path, frame_idx)
            if frame is None:
                continue
            detections = _detect_hog_boxes(frame)
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
        with StaticPoseDetector(min_detection_confidence=0.5, num_poses=4) as pose:
            for entry in keyframes:
                frame_idx = entry["frame_index"]
                # Use cached frame if available, otherwise read from disk
                if frame_cache and frame_idx in frame_cache:
                    frame = frame_cache[frame_idx]
                else:
                    frame = _read_frame_by_index(video_path, frame_idx)
                if frame is None:
                    continue
                candidates = _detect_pose_candidates(frame, pose)
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


def _frame_to_jpeg_bytes(frame: np.ndarray) -> bytes:
    ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
    if not ok:
        return b""
    return bytes(buffer.tobytes())


def _call_gemini(
    frames_with_tracks: list[dict[str, Any]],
    video_duration: float = 0.0,
    video_fps: float = 30.0,
    video_width: int = 0,
    video_height: int = 0,
    player_index: int | None = None,
    video_path: str | None = None,
) -> dict:
    if genai is None or genai_types is None:
        raise GeminiParseError("google-genai is not installed. Install with: pip install google-genai")

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise GeminiQuotaError("GEMINI_API_KEY is not configured")

    from core.prompt import get_system_prompt

    client = genai.Client(api_key=api_key)

    player_focus = None
    if player_index is not None:
        player_focus = {"id": player_index, "position": "center frame"}

    system_prompt = get_system_prompt(player_focus=player_focus)

    video_meta = (
        f"## Video Context\n"
        f"- Duration: {video_duration:.1f}s\n"
        f"- FPS: {video_fps:.1f}\n"
        f"- Resolution: {video_width}x{video_height}\n"
        f"- Frames analyzed: {len(frames_with_tracks)}\n\n"
        f"Analyze the athlete's technique across these video frames. "
        f"Each frame includes position and pose data as text alongside the image.\n"
    )

    parts: list[Any] = [f"{system_prompt}\n\n{video_meta}"]

    for item in frames_with_tracks:
        # Read frame from disk when needed (memory optimization)
        frame = None
        if video_path:
            frame = _read_frame_by_index(video_path, item["frame_index"])
        if frame is None:
            continue
        jpeg = _frame_to_jpeg_bytes(frame)
        if not jpeg:
            continue
        metadata_str = _build_frame_metadata(item, video_fps)
        parts.append(f"Frame at {item['timestamp']}s — {metadata_str}")
        parts.append(genai_types.Part.from_bytes(data=jpeg, mime_type="image/jpeg"))

    print(f"[Analyzer] Sending {len(frames_with_tracks)} frames to Gemini with detailed prompt")

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=parts,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1,
            ),
        )
    except Exception as exc:
        status_code = getattr(exc, "status_code", None)
        message = str(exc)
        is_quota = (
            status_code == 429
            or "RESOURCE_EXHAUSTED" in message
            or "quota" in message.lower()
        )
        if is_quota:
            raise GeminiQuotaError("Gemini quota exceeded. Please retry later.") from exc
        if genai_errors is not None and isinstance(exc, getattr(genai_errors, "APIError", tuple())):
            raise GeminiParseError(f"Gemini API error: {message}") from exc
        raise GeminiParseError("Gemini request failed unexpectedly") from exc

    try:
        text = getattr(response, "text", None) or ""
        return json.loads(text)
    except Exception as exc:
        raise GeminiParseError("Gemini returned malformed JSON") from exc


def run_analysis(job_id: str, video_key: str, player_index: int | None) -> None:
    local_path: str | None = None
    preprocessed_path = ""
    output_path: str | None = None
    cleanup_preprocessed = False
    try:
        local_path = storage.download_video_to_tmp(video_key)
        preprocessed_path = local_path
        register_job_input(job_id, local_path)

        # Check cache first
        video_hash = compute_video_hash(local_path)
        cached_result = get_cached_analysis(video_hash, player_index)
        if cached_result is not None:
            logging.info(json.dumps({
                "type": "cache_hit",
                "video_hash": video_hash,
                "player_index": player_index,
                "job_id": job_id,
            }))
            transition_job(job_id, "analyzing")
            update_job(job_id, summary=cached_result)
            transition_job(job_id, "completed")
            return

        logging.info(json.dumps({
            "type": "cache_miss",
            "video_hash": video_hash,
            "player_index": player_index,
            "job_id": job_id,
        }))

        # Deduplication: check if same video is being analyzed
        dedup_key = f"{video_hash}:{player_index}"
        if dedup_key in deduplicator.pending:
            print(f"[Analyzer] Deduplication: waiting for existing analysis of {video_hash}")
            # Wait for the existing analysis to complete
            try:
                existing_result = asyncio.run(deduplicator.get_or_create(
                    dedup_key,
                    lambda: asyncio.sleep(0)  # No-op, just wait
                ))
                if existing_result is not None:
                    # Analysis completed while we were waiting
                    cached_result = get_cached_analysis(video_hash, player_index)
                    if cached_result is not None:
                        transition_job(job_id, "analyzing")
                        update_job(job_id, summary=cached_result)
                        transition_job(job_id, "completed")
                        return
            except Exception:
                pass  # Continue with new analysis if dedup fails

        # State: scanning (extracting frames and detecting players)
        transition_job(job_id, "scanning")
        preprocessed_path = _preprocess_video_ffmpeg(local_path)
        cleanup_preprocessed = preprocessed_path != local_path

        # Run keyframe extraction (CPU-bound) - returns frame cache
        loop = asyncio.new_event_loop()
        keyframes, fps, _frame_count, frame_cache = loop.run_until_complete(
            asyncio.to_thread(_extract_keyframes, preprocessed_path)
        )

        cap = cv2.VideoCapture(local_path)
        video_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        video_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        video_duration = _frame_count / fps if _frame_count > 0 and fps > 0 else 90.0
        cap.release()

        # Run detection and motion scoring in parallel (both use frame cache)
        active_tracks, motion_scores = loop.run_until_complete(
            asyncio.gather(
                asyncio.to_thread(_build_active_player_tracks, local_path, keyframes, player_index, frame_cache),
                asyncio.to_thread(_compute_motion_scores, local_path, keyframes, frame_cache)
            )
        )
        loop.close()

        # Combine motion scores with tracks
        for track in active_tracks:
            fi = track["frame_index"]
            motion = motion_scores.get(fi, 0.5)
            visibility = track.get("visibility", 0.5)
            track["motion_score"] = motion
            track["composite_score"] = 0.4 * visibility + 0.6 * motion

        # State: analyzing (calling Gemini)
        transition_job(job_id, "analyzing")
        frame_budget = min(20, len(active_tracks))
        best_for_gemini = sorted(active_tracks, key=lambda t: t["composite_score"], reverse=True)[:frame_budget]
        print(f"[Analyzer] Selected {len(best_for_gemini)}/{len(active_tracks)} frames (budget={frame_budget})")
        for i, t in enumerate(best_for_gemini[:5]):
            print(f"  Frame {i}: ts={t['timestamp']}s visibility={t.get('visibility', 0):.2f} motion={t.get('motion_score', 0):.2f} composite={t.get('composite_score', 0):.2f}")

        gemini_result = _call_gemini(
            best_for_gemini,
            video_duration=video_duration,
            video_fps=fps,
            video_width=video_width,
            video_height=video_height,
            player_index=player_index,
            video_path=preprocessed_path,
        )

        # Cache the result
        set_cached_analysis(video_hash, gemini_result, player_index)

        logging.info(json.dumps({
            "type": "analysis_complete",
            "video_hash": video_hash,
            "player_index": player_index,
            "job_id": job_id,
            "form_score": gemini_result.get("form_score"),
            "frames_analyzed": len(best_for_gemini),
        }))

        # Store analysis result
        update_job(job_id, summary=gemini_result)

        # State: rendering (annotating video)
        transition_job(job_id, "rendering")
        output_path = str(_tmp_dir() / f"{job_id}_annotated.mp4")
        render_video(
            video_path=local_path,
            output_path=output_path,
            analysis_result=gemini_result,
            active_player_landmarks_per_frame=active_tracks,
            fps=fps,
        )

        result_key = storage.upload_result_video(output_path, job_id)
        output_path = None

        # State: completed
        transition_job(
            job_id,
            "completed",
            video_key=result_key,
            video_path=storage.get_local_file_path(result_key) if storage.is_local_backend() else None,
        )
    except EngineError as exc:
        fail_job(job_id, exc)
    except FileNotFoundError:
        fail_job(job_id, VideoExpiredError())
    except Exception:
        fail_job(job_id, EngineError(
            code="INTERNAL_ERROR",
            message="Unexpected analysis error.",
            retryable=True,
        ))
    finally:
        if cleanup_preprocessed:
            try:
                Path(preprocessed_path).unlink(missing_ok=True)
            except Exception:
                pass
        if local_path and os.path.exists(local_path):
            try:
                os.unlink(local_path)
            except Exception:
                pass
        if output_path and os.path.exists(output_path):
            try:
                os.unlink(output_path)
            except Exception:
                pass
