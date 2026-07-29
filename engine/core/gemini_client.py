"""
gemini_client.py — Gemini API integration extracted from analyzer.py.

Handles prompt construction, API calls, response parsing, and result normalization.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import numpy as np

from core.config import GEMINI_MODEL, parse_timestamp
from core.errors import GeminiParseError, GeminiQuotaError
from core.video_io import read_frame_by_index, frame_to_jpeg_bytes

try:
    from google import genai
    from google.genai import errors as genai_errors
    from google.genai import types as genai_types
except Exception:
    genai = None
    genai_errors = None
    genai_types = None


def build_frame_metadata(track: dict[str, Any], fps: float) -> str:
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


def call_gemini(
    frames_with_tracks: list[dict[str, Any]],
    video_duration: float = 0.0,
    video_fps: float = 30.0,
    video_width: int = 0,
    video_height: int = 0,
    player_index: int | None = None,
    video_path: str | None = None,
) -> dict:
    """
    Build a multimodal Gemini prompt with frame images + metadata text,
    send to gemini-2.5-flash, and parse the JSON response.
    """
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
        frame = None
        if video_path:
            frame = read_frame_by_index(video_path, item["frame_index"])
        if frame is None:
            continue
        jpeg = frame_to_jpeg_bytes(frame)
        if not jpeg:
            continue
        metadata_str = build_frame_metadata(item, video_fps)
        parts.append(f"Frame at {item['timestamp']}s — {metadata_str}")
        parts.append(genai_types.Part.from_bytes(data=jpeg, mime_type="image/jpeg"))

    logging.info(f"[Analyzer] Sending {len(frames_with_tracks)} frames to Gemini with detailed prompt")

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
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


def normalize_gemini_result(raw: dict) -> dict:
    """
    Transform raw Gemini output to match the frontend AnalysisSummary type.

    Gemini returns: { shots: [...], session_summary: {...}, sport, ... }
    Frontend expects: { shot_events: [...], form_score, overall_rating, top_tips, summary, strengths, ... }
    """
    session_summary = raw.get("session_summary") or {}
    sport = raw.get("sport", "unknown")

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
        }
        breakdown = shot.get("form_breakdown")
        if isinstance(breakdown, dict) and breakdown:
            for criterion, rating in breakdown.items():
                if rating in ("needs_work", "poor"):
                    event["key_observation"] = f"{criterion}: {rating}"
                    break
            if "key_observation" not in event and breakdown:
                first_key = next(iter(breakdown))
                event["key_observation"] = f"{first_key}: {breakdown[first_key]}"
        shot_events.append(event)

    return {
        "sport": sport,
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
