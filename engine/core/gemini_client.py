"""
gemini_client.py — Gemini API integration extracted from analyzer.py.

Handles prompt construction, API calls, response parsing, and result normalization.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

import numpy as np

from core.config import GEMINI_MODEL, parse_timestamp
from core.detection_utils import landmark_angle
from core.errors import GeminiParseError, GeminiQuotaError
from core.gemini_common import parse_json_response
from core.validator import validate_analysis
from core.video_io import read_frame_by_index, frame_to_jpeg_bytes

try:
    from google import genai
    from google.genai import errors as genai_errors
    from google.genai import types as genai_types
except Exception:
    genai = None
    genai_errors = None
    genai_types = None

# Module-level singleton — avoids re-creating the HTTP client on every call.
# Initialised lazily on first use so import-time failures don't crash the engine.
_gemini_client: "genai.Client | None" = None  # type: ignore[name-defined]


def _get_client() -> "genai.Client":  # type: ignore[name-defined]
    """Return (or lazily create) the shared Gemini client."""
    global _gemini_client
    if _gemini_client is None:
        if genai is None:
            raise GeminiParseError("google-genai is not installed. Install with: pip install google-genai")
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise GeminiQuotaError("GEMINI_API_KEY is not configured")
        _gemini_client = genai.Client(api_key=api_key)
    return _gemini_client


def build_frame_metadata(track: dict[str, Any], sequence_index: int = 0, motion_score: float = 0.0, player_count: int = 0) -> str:
    """
    Build a text metadata string for a frame to send alongside the image.
    Includes bounding box position, key pose landmark angles, joint angles, and motion info.
    """
    parts = []

    if motion_score > 0 or player_count > 0:
        parts.append(f"Motion: {motion_score:.2f} | Players visible: {player_count}")

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
            left_knee_angle = landmark_angle(landmarks[23], landmarks[25], landmarks[27])
            right_knee_angle = landmark_angle(landmarks[24], landmarks[26], landmarks[28])
            left_elbow_angle = landmark_angle(landmarks[11], landmarks[13], landmarks[15])
            right_elbow_angle = landmark_angle(landmarks[12], landmarks[14], landmarks[16])

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

    # Add computed joint angles from tracking pipeline
    joint_angles = track.get("joint_angles", {})
    elbow_extension = track.get("elbow_extension_angle")
    if elbow_extension is not None:
        joint_angles["elbow_extension_angle"] = elbow_extension

    if joint_angles:
        angle_parts = []
        for joint_name, angle_val in joint_angles.items():
            if isinstance(angle_val, (int, float)):
                angle_parts.append(f"{joint_name}={angle_val:.1f}")
        if angle_parts:
            parts.append(f"Joint angles: {', '.join(angle_parts)}")

    timestamp = track.get("timestamp", 0.0)
    metadata_str = ". ".join(parts) if parts else "No position data"
    return f"Frame {sequence_index} at {timestamp}s — {metadata_str}"


def call_gemini(
    frames_with_tracks: list[dict[str, Any]],
    video_duration: float = 0.0,
    video_fps: float = 30.0,
    video_width: int = 0,
    video_height: int = 0,
    player_index: int | None = None,
    video_path: str | None = None,
    frame_cache: dict[int, np.ndarray] | None = None,
    max_retries: int = 3,
) -> dict:
    """
    Build a multimodal Gemini prompt with frame images + metadata text,
    send to gemini-2.5-flash, and parse the JSON response.
    Retries on transient errors (503, 429) with exponential backoff.
    """
    if genai_types is None:
        raise GeminiParseError("google-genai is not installed. Install with: pip install google-genai")

    from core.prompt import get_system_prompt

    client = _get_client()

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

    for seq_idx, item in enumerate(frames_with_tracks):
        frame = None
        # Use frame cache first (avoids redundant file opens)
        frame_idx = item["frame_index"]
        if frame_cache and frame_idx in frame_cache:
            frame = frame_cache[frame_idx]
        elif video_path:
            frame = read_frame_by_index(video_path, frame_idx)
        if frame is None:
            continue
        jpeg = frame_to_jpeg_bytes(frame)
        if not jpeg:
            continue
        motion_score = item.get("motion_score", 0.0)
        player_count = item.get("player_count", 0)
        metadata_str = build_frame_metadata(item, sequence_index=seq_idx, motion_score=motion_score, player_count=player_count)
        parts.append(metadata_str)
        parts.append(genai_types.Part.from_bytes(data=jpeg, mime_type="image/jpeg"))

    logging.info(f"[Analyzer] Sending {len(frames_with_tracks)} frames to Gemini with detailed prompt")

    response = None
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=parts,
                config=genai_types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.1,
                ),
            )
            break  # success
        except Exception as exc:
            status_code = getattr(exc, "status_code", None)
            message = str(exc)
            is_transient = (
                status_code == 503
                or status_code == 429
                or "UNAVAILABLE" in message
                or "RESOURCE_EXHAUSTED" in message
                or "quota" in message.lower()
            )
            if is_transient and attempt < max_retries - 1:
                delay = 2 ** attempt * 3  # 3s, 6s, 12s
                logging.warning(f"[Analyzer] Gemini transient error (attempt {attempt + 1}/{max_retries}): {message}. Retrying in {delay}s...")
                time.sleep(delay)
                continue
            if status_code == 429 or "RESOURCE_EXHAUSTED" in message or "quota" in message.lower():
                raise GeminiQuotaError("Gemini quota exceeded. Please retry later.") from exc
            if genai_errors is not None and isinstance(exc, getattr(genai_errors, "APIError", tuple())):
                raise GeminiParseError(f"Gemini API error: {message}") from exc
            raise GeminiParseError("Gemini request failed unexpectedly") from exc

    try:
        text = getattr(response, "text", None) or ""
        result = parse_json_response(text)
    except Exception as exc:
        raise GeminiParseError("Gemini returned malformed JSON") from exc

    errors = validate_analysis(result)
    if errors:
        raise GeminiParseError(
            f"Gemini output failed schema validation: {'; '.join(errors)}"
        )

    return result


def normalize_gemini_result(raw: dict) -> dict:
    """
    Transform raw Gemini output to match the frontend AnalysisSummary type.

    Gemini returns: { shots: [...], session_summary: {...}, sport, player_name, session_date, ... }
    Frontend expects: { shot_events: [...], form_score, overall_rating, top_tips, summary, strengths, ... }
    """
    session_summary = raw.get("session_summary") or {}
    sport = raw.get("sport", "unknown")
    player_name = raw.get("player_name", "Player")
    session_date = raw.get("session_date")

    form_score = session_summary.get("average_form_score", 0)
    overall_rating = session_summary.get("overall_rating", "N/A")
    top_tips = session_summary.get("top_issues", [])

    summary_text = raw.get("summary", "")
    if not summary_text:
        parts = []
        if overall_rating and overall_rating != "N/A":
            parts.append(f"Overall rating: {overall_rating}.")
        if top_tips:
            parts.append(f"Key areas to focus on: {'; '.join(top_tips[:3])}.")
        priority = session_summary.get("priority_drill")
        if priority:
            parts.append(f"Priority drill: {priority}")
        summary_text = " ".join(parts) if parts else "Analysis complete."

    strengths = session_summary.get("strengths", [])
    priority_drill = session_summary.get("priority_drill")

    raw_shots = raw.get("shots", [])
    shot_events = []
    for shot in raw_shots:
        event = {
            "timestamp": parse_timestamp(shot.get("timestamp_of_shot", "0:00")),
            "event_type": shot.get("shot_type", "unknown"),
            "form_score": shot.get("form_score", 0),
            "feedback": shot.get("feedback", ""),
            "result": shot.get("result"),
            "form_breakdown": shot.get("form_breakdown", {}),
            "biomechanics": shot.get("biomechanics"),
            "weighted_scoring": shot.get("weighted_scoring"),
            "injury_risk": shot.get("injury_risk"),
        }
        # Add key_observation for backward compatibility
        breakdown = shot.get("form_breakdown")
        if isinstance(breakdown, dict) and breakdown:
            for criterion, rating in breakdown.items():
                if rating in ("needs_work", "poor"):
                    event["key_observation"] = f"{criterion}: {rating}"
                    break
            if "key_observation" not in event and breakdown:
                first_key = next(iter(breakdown))
                event["key_observation"] = f"{first_key}: {breakdown[first_key]}"
        # Keep cumulative stats
        for key, value in shot.items():
            if key.endswith("_so_far"):
                event[key] = value
        shot_events.append(event)

    return {
        "sport": sport,
        "player_name": player_name,
        "session_date": session_date,
        "form_score": form_score,
        "overall_rating": overall_rating,
        "top_tips": top_tips,
        "summary": summary_text,
        "strengths": strengths,
        "priority_drill": priority_drill,
        "shot_events": shot_events,
        "success_rate_percent": session_summary.get("success_rate_percent", 0),
        "average_form_score": session_summary.get("average_form_score", form_score),
        "total_events": session_summary.get("total_events", len(shot_events)),
    }
