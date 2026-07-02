from __future__ import annotations

from typing import Any, Dict, List

import cv2
import numpy as np

from core.pose_backend import get_pose_connections


def _score_color(form_score: int) -> tuple[int, int, int]:
    if form_score > 79:
        return (60, 220, 90)
    if form_score > 59:
        return (0, 215, 255)
    return (40, 60, 235)


def _sport_label(sport: str) -> str:
    icon_map = {
        "basketball": "🏀 Basketball",
        "football": "⚽ Football",
        "cricket": "🏏 Cricket",
    }
    return icon_map.get((sport or "").lower(), "🎯 Unknown Sport")


def _draw_pose_landmarks(
    frame: np.ndarray,
    landmarks: list[dict[str, float]],
    connections: list[tuple[int, int]],
) -> None:
    if not landmarks:
        return

    h, w = frame.shape[:2]
    points: list[tuple[int, int] | None] = []
    for lm in landmarks:
        x = int(float(lm.get("x", 0.0)) * w)
        y = int(float(lm.get("y", 0.0)) * h)
        visibility = float(lm.get("visibility", 1.0))
        if visibility < 0.2:
            points.append(None)
            continue
        px = max(0, min(w - 1, x))
        py = max(0, min(h - 1, y))
        points.append((px, py))

    for start, end in connections:
        if start >= len(points) or end >= len(points):
            continue
        p1 = points[start]
        p2 = points[end]
        if p1 is None or p2 is None:
            continue
        cv2.line(frame, p1, p2, (0, 170, 255), 2, cv2.LINE_AA)

    for point in points:
        if point is None:
            continue
        cv2.circle(frame, point, 2, (0, 235, 120), -1, cv2.LINE_AA)


def _draw_player_bbox(frame: np.ndarray, bbox: dict[str, int], alpha: float = 0.3) -> None:
    x1 = int(bbox.get("x_min", 0))
    y1 = int(bbox.get("y_min", 0))
    x2 = int(bbox.get("x_max", 0))
    y2 = int(bbox.get("y_max", 0))

    x1 = max(0, min(frame.shape[1] - 1, x1))
    y1 = max(0, min(frame.shape[0] - 1, y1))
    x2 = max(x1 + 1, min(frame.shape[1] - 1, x2))
    y2 = max(y1 + 1, min(frame.shape[0] - 1, y2))

    # ROI-only overlay (memory optimization: avoid full-frame copy)
    roi = frame[y1:y2, x1:x2]
    overlay_roi = roi.copy()
    cv2.rectangle(overlay_roi, (0, 0), (x2 - x1 - 1, y2 - y1 - 1), (40, 220, 80), -1)
    cv2.addWeighted(overlay_roi, alpha, roi, 1.0 - alpha, 0, roi)
    cv2.rectangle(frame, (x1, y1), (x2, y2), (40, 220, 80), 2)


def _draw_hud(
    frame: np.ndarray,
    analysis_result: dict,
    timestamp: float,
    _hud_overlay_cache: dict | None = None,
) -> None:
    sport = str(analysis_result.get("sport", "unknown"))
    form_score = int(analysis_result.get("form_score", 0) or 0)
    tips = analysis_result.get("top_tips", []) or []

    if not isinstance(tips, list):
        tips = [str(tips)]

    tip_text = "No tip available"
    if tips:
        tip_index = int(timestamp // 3) % len(tips)
        tip_text = str(tips[tip_index])

    panel_w = int(frame.shape[1] * 0.48)
    panel_h = 170
    panel_w = max(360, min(panel_w, frame.shape[1] - 20))

    # ROI-only overlay for HUD panel (memory optimization)
    roi = frame[10:10 + panel_h, 10:10 + panel_w]
    overlay_roi = roi.copy()
    cv2.rectangle(overlay_roi, (0, 0), (panel_w - 1, panel_h - 1), (18, 18, 18), -1)
    cv2.addWeighted(overlay_roi, 0.72, roi, 0.28, 0, roi)

    cv2.putText(
        frame,
        _sport_label(sport),
        (24, 48),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.85,
        (250, 250, 250),
        2,
        cv2.LINE_AA,
    )

    cv2.putText(
        frame,
        f"Form: {form_score}/100",
        (24, 88),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.0,
        _score_color(form_score),
        2,
        cv2.LINE_AA,
    )

    cv2.rectangle(frame, (20, 114), (20 + panel_w - 20, 156), (28, 28, 28), -1)
    cv2.putText(
        frame,
        tip_text[:90],
        (28, 141),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.58,
        (220, 220, 220),
        1,
        cv2.LINE_AA,
    )


def _draw_summary_screen(frame: np.ndarray, analysis_result: dict) -> np.ndarray:
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (frame.shape[1], frame.shape[0]), (5, 5, 5), -1)
    cv2.addWeighted(overlay, 0.82, frame, 0.18, 0, frame)

    form_score = int(analysis_result.get("form_score", 0) or 0)
    overall_rating = str(analysis_result.get("overall_rating", "N/A"))
    summary = str(analysis_result.get("summary", ""))
    tips = analysis_result.get("top_tips", []) or []

    center_x = frame.shape[1] // 2
    y = frame.shape[0] // 4

    cv2.putText(
        frame,
        "Session Complete",
        (center_x - 240, y),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.45,
        (240, 240, 240),
        3,
        cv2.LINE_AA,
    )

    y += 70
    cv2.putText(
        frame,
        f"Form Score: {form_score}/100",
        (center_x - 220, y),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.0,
        _score_color(form_score),
        2,
        cv2.LINE_AA,
    )

    y += 45
    cv2.putText(
        frame,
        f"Rating: {overall_rating}",
        (center_x - 220, y),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.9,
        (220, 220, 220),
        2,
        cv2.LINE_AA,
    )

    y += 45
    cv2.putText(
        frame,
        summary[:90],
        (center_x - 320, y),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.78,
        (200, 200, 200),
        2,
        cv2.LINE_AA,
    )

    y += 60
    for idx, tip in enumerate(tips[:3], start=1):
        cv2.putText(
            frame,
            f"{idx}. {str(tip)[:80]}",
            (center_x - 340, y + (idx - 1) * 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.76,
            (230, 230, 230),
            2,
            cv2.LINE_AA,
        )

    return frame


def render_video(
    video_path: str,
    output_path: str,
    analysis_result: dict,
    active_player_landmarks_per_frame: list,
    fps: float,
) -> str:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("Failed to open video for rendering")

    in_fps = float(cap.get(cv2.CAP_PROP_FPS))
    use_fps = fps if fps > 0 else (in_fps if in_fps > 0 else 30.0)

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    writer = cv2.VideoWriter(
        output_path,
        cv2.VideoWriter_fourcc(*"avc1"),  # H.264 codec (faster, smaller files)
        use_fps,
        (width, height),
    )
    if not writer.isOpened():
        cap.release()
        raise RuntimeError("Failed to open output writer")

    connections = get_pose_connections()

    track_by_frame: Dict[int, Dict[str, Any]] = {
        int(item["frame_index"]): item for item in active_player_landmarks_per_frame
    }

    frame_index = 0
    last_frame = None

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        track = track_by_frame.get(frame_index)
        if track:
            _draw_pose_landmarks(frame, track["landmarks"], connections)
            _draw_player_bbox(frame, track["bbox"], alpha=0.3)

        timestamp = frame_index / max(1.0, use_fps)
        _draw_hud(frame, analysis_result, timestamp)

        writer.write(frame)
        # Only keep the last frame for summary screen (memory optimization)
        last_frame = frame
        frame_index += 1

    if last_frame is not None:
        hold_frames = int(round(use_fps * 3))
        summary_frame = _draw_summary_screen(last_frame.copy(), analysis_result)
        for _ in range(max(1, hold_frames)):
            writer.write(summary_frame)

    writer.release()
    cap.release()
    return output_path
