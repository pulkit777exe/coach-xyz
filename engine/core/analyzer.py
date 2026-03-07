from __future__ import annotations

import json
import os
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np

try:
    from google import genai
    from google.genai import errors as genai_errors
    from google.genai import types as genai_types
except Exception:
    genai = None
    genai_errors = None
    genai_types = None

from core.detector import PoseCandidate, detect_players
from core.errors import EngineError, GeminiParseError, GeminiQuotaError, NoPlayersDetectedError, VideoDecodeError
from core.jobs import STAGES, register_job_input, update_job
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
    for ts in timestamps:
        frame_index = int(round(ts * fps))
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
        ok, frame = cap.read()
        if not ok or frame is None:
            continue
        keyframes.append(
            {
                "frame_index": frame_index,
                "timestamp": float(round(ts, 2)),
                "frame": frame,
            }
        )

    cap.release()
    if not keyframes:
        raise VideoDecodeError("Could not extract keyframes from video")

    return keyframes, fps, frame_count


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
    hog = cv2.HOGDescriptor()
    hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

    boxes, weights = hog.detectMultiScale(
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
            frame = entry["frame"]
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
                    "frame_index": int(entry["frame_index"]),
                    "timestamp": float(entry["timestamp"]),
                    "landmarks": [],
                    "visibility": float(max(0.3, min(1.0, visibility))),
                    "bbox": {
                        "x_min": int(x_min),
                        "y_min": int(y_min),
                        "x_max": int(x_max),
                        "y_max": int(y_max),
                    },
                    "frame": frame,
                }
            )
    else:
        with StaticPoseDetector(min_detection_confidence=0.5, num_poses=8) as pose:
            for entry in keyframes:
                frame = entry["frame"]
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
                        "frame_index": int(entry["frame_index"]),
                        "timestamp": float(entry["timestamp"]),
                        "landmarks": active.landmarks,
                        "visibility": float(active.visibility),
                        "bbox": {
                            "x_min": int(x_min),
                            "y_min": int(y_min),
                            "x_max": int(x_max),
                            "y_max": int(y_max),
                        },
                        "frame": frame,
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


def _call_gemini(frames_with_tracks: list[dict[str, Any]]) -> dict:
    if genai is None or genai_types is None:
        raise GeminiParseError("google-genai is not installed. Install with: pip install google-genai")

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise GeminiQuotaError("GEMINI_API_KEY is not configured")

    client = genai.Client(api_key=api_key)

    system_instruction = """
  You are an expert sports biomechanics coach. Analyze the provided 
  video frames of an athlete and return a JSON object only.
  No markdown, no explanation, no code fences. Raw JSON only.
  """.strip()

    user_prompt = """
  Analyze the athlete's technique across these video frames.

  Return this exact JSON structure with no other text:
  {
    "sport": "<detected sport: basketball | football | cricket | unknown>",
    "form_score": <integer 0-100>,
    "overall_rating": "<Beginner | Intermediate | Advanced | Elite>",
    "top_tips": [
      "<specific actionable tip 1>",
      "<specific actionable tip 2>",
      "<specific actionable tip 3>"
    ],
    "summary": "<one sentence overall assessment>",
    "strengths": ["<strength 1>", "<strength 2>"],
    "shot_events": [
      {
        "timestamp": <float seconds>,
        "event_type": "<e.g. jump_shot, drive, strike>",
        "form_score": <integer 0-100>,
        "feedback": "<one sentence specific feedback for this moment>"
      }
    ]
  }

  Rules:
  - form_score 80-100 = excellent technique
  - form_score 60-79 = good with minor issues
  - form_score 40-59 = needs work
  - form_score below 40 = significant issues
  - top_tips must be specific and actionable, never generic
  - shot_events should capture the key technical moments visible
  """.strip()

    parts: list[Any] = [f"{system_instruction}\n\n{user_prompt}"]

    for item in frames_with_tracks:
        jpeg = _frame_to_jpeg_bytes(item["frame"])
        if not jpeg:
            continue
        parts.append(f"Frame timestamp: {item['timestamp']}")
        parts.append(genai_types.Part.from_bytes(data=jpeg, mime_type="image/jpeg"))

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=parts,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
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

        update_job(job_id, stage=1, stage_name=STAGES[1], progress=10)
        preprocessed_path = _preprocess_video_ffmpeg(local_path)
        cleanup_preprocessed = preprocessed_path != local_path
        keyframes, fps, _frame_count = _extract_keyframes(preprocessed_path)

        update_job(job_id, stage=2, stage_name=STAGES[2], progress=25)
        active_tracks = _build_active_player_tracks(local_path, keyframes, player_index)

        update_job(job_id, stage=3, stage_name=STAGES[3], progress=45)
        best_for_gemini = sorted(active_tracks, key=lambda t: t["visibility"], reverse=True)[:8]
        gemini_result = _call_gemini(best_for_gemini)

        update_job(
            job_id,
            stage=4,
            stage_name=STAGES[4],
            progress=70,
            summary=gemini_result,
        )

        output_path = str(_tmp_dir() / f"{job_id}_annotated.mp4")
        update_job(job_id, stage=5, stage_name=STAGES[5], progress=85)
        render_video(
            video_path=local_path,
            output_path=output_path,
            analysis_result=gemini_result,
            active_player_landmarks_per_frame=active_tracks,
            fps=fps,
        )

        result_key = storage.upload_result_video(output_path, job_id)
        output_path = None

        update_job(
            job_id,
            stage=5,
            stage_name=STAGES[5],
            progress=100,
            complete=True,
            video_key=result_key,
            video_path=storage.get_local_file_path(result_key) if storage.is_local_backend() else None,
        )
    except EngineError as exc:
        update_job(job_id, error=exc.message, complete=True)
    except Exception:
        update_job(job_id, error="Unexpected analysis error", complete=True)
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
