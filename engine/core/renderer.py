from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Dict

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from core.pose_backend import get_pose_connections
from core.sport_config import load_sport_config


# ── Font loading ──────────────────────────────────────────────────────────────

_FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"

_FONT_CACHE: dict[int, ImageFont.FreeTypeFont | ImageFont.ImageFont] = {}


def _get_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if size in _FONT_CACHE:
        return _FONT_CACHE[size]
    for name in ("Montserrat-Bold.ttf", "Montserrat-SemiBold.ttf", "Montserrat-Regular.ttf"):
        path = _FONT_DIR / name
        if path.exists():
            font = ImageFont.truetype(str(path), size)
            _FONT_CACHE[size] = font
            return font
    font = ImageFont.load_default(size=size)
    _FONT_CACHE[size] = font
    return font


# ── Sport config ──────────────────────────────────────────────────────────────
# Loader lives in core.sport_config (single cached copy shared with analyzer).

def _load_sport_config(sport: str) -> dict:
    return load_sport_config(sport)


def _sport_colors(sport: str) -> dict:
    config = _load_sport_config(sport)
    raw = config.get("colors", {})
    return {
        "primary": tuple(raw.get("primary", [0, 165, 255])),
        "positive": tuple(raw.get("positive", [0, 255, 0])),
        "negative": tuple(raw.get("negative", [0, 0, 255])),
        "neutral": tuple(raw.get("neutral", [255, 255, 255])),
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _score_color(form_score: int, colors: dict | None = None) -> tuple[int, int, int]:
    if colors is None:
        colors = {}
    if form_score >= 8:
        return tuple(colors.get("positive", (60, 220, 90)))
    if form_score >= 5:
        return (0, 215, 255)
    return tuple(colors.get("negative", (40, 60, 235)))


def _sport_label(sport: str) -> str:
    icon_map = {
        "basketball": "Basketball",
        "football": "Football",
        "cricket": "Cricket",
        "tennis": "Tennis",
        "baseball": "Baseball",
        "hockey": "Hockey",
    }
    return icon_map.get((sport or "").lower(), "Unknown Sport")


# ── Rounded rectangle drawing ────────────────────────────────────────────────

def _draw_filled_rounded_rect(
    img: np.ndarray,
    x1: int,
    y1: int,
    x2: int,
    y2: int,
    color: tuple[int, int, int],
    radius: int,
) -> None:
    """Draw a filled rounded rectangle on an OpenCV image."""
    h, w = img.shape[:2]
    x1 = max(0, min(w - 1, x1))
    y1 = max(0, min(h - 1, y1))
    x2 = max(x1 + 1, min(w - 1, x2))
    y2 = max(y1 + 1, min(h - 1, y2))
    radius = min(radius, (x2 - x1) // 2, (y2 - y1) // 2)

    overlay = img.copy()
    cv2.rectangle(overlay, (x1 + radius, y1), (x2 - radius, y2), color, -1, cv2.LINE_AA)
    cv2.rectangle(overlay, (x1, y1 + radius), (x2, y2 - radius), color, -1, cv2.LINE_AA)
    cv2.circle(overlay, (x1 + radius, y1 + radius), radius, color, -1, cv2.LINE_AA)
    cv2.circle(overlay, (x2 - radius, y1 + radius), radius, color, -1, cv2.LINE_AA)
    cv2.circle(overlay, (x1 + radius, y2 - radius), radius, color, -1, cv2.LINE_AA)
    cv2.circle(overlay, (x2 - radius, y2 - radius), radius, color, -1, cv2.LINE_AA)

    cv2.addWeighted(overlay, 1.0, img, 0.0, 0, img)


def _draw_rounded_rect_border(
    img: np.ndarray,
    x1: int,
    y1: int,
    x2: int,
    y2: int,
    color: tuple[int, int, int],
    radius: int,
    thickness: int = 2,
) -> None:
    """Draw a rounded rectangle border on an OpenCV image."""
    h, w = img.shape[:2]
    x1 = max(0, min(w - 1, x1))
    y1 = max(0, min(h - 1, y1))
    x2 = max(x1 + 1, min(w - 1, x2))
    y2 = max(y1 + 1, min(h - 1, y2))
    radius = min(radius, (x2 - x1) // 2, (y2 - y1) // 2)

    cv2.line(img, (x1 + radius, y1), (x2 - radius, y1), color, thickness, cv2.LINE_AA)
    cv2.line(img, (x1 + radius, y2), (x2 - radius, y2), color, thickness, cv2.LINE_AA)
    cv2.line(img, (x1, y1 + radius), (x1, y2 - radius), color, thickness, cv2.LINE_AA)
    cv2.line(img, (x2, y1 + radius), (x2, y2 - radius), color, thickness, cv2.LINE_AA)
    cv2.ellipse(img, (x1 + radius, y1 + radius), (radius, radius), 0, 180, 270, color, thickness, cv2.LINE_AA)
    cv2.ellipse(img, (x2 - radius, y1 + radius), (radius, radius), 0, 270, 360, color, thickness, cv2.LINE_AA)
    cv2.ellipse(img, (x1 + radius, y2 - radius), (radius, radius), 0, 90, 180, color, thickness, cv2.LINE_AA)
    cv2.ellipse(img, (x2 - radius, y2 - radius), (radius, radius), 0, 0, 90, color, thickness, cv2.LINE_AA)


def _draw_pil_text(
    frame: np.ndarray,
    text: str,
    x: int,
    y: int,
    font_size: int,
    color: tuple[int, int, int] = (255, 255, 255),
    anchor: str = "lt",
) -> None:
    """Draw anti-aliased text on an OpenCV frame using Pillow."""
    pil_img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(pil_img)
    font = _get_font(font_size)
    draw.text((x, y), text, font=font, fill=(color[2], color[1], color[0]), anchor=anchor)
    cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR, dst=frame)


def _text_size_pil(text: str, font_size: int) -> tuple[int, int]:
    """Get text dimensions using Pillow."""
    font = _get_font(font_size)
    bbox = font.getbbox(text)
    return (bbox[2] - bbox[0], bbox[3] - bbox[1])


# ── Pose landmarks with glow ─────────────────────────────────────────────────

def _draw_pose_landmarks(
    frame: np.ndarray,
    landmarks: list[dict[str, float]],
    connections: list[tuple[int, int]],
    primary_color: tuple[int, int, int] = (0, 170, 255),
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

    # Glow layer: thick semi-transparent lines
    glow_layer = frame.copy()
    for start, end in connections:
        if start >= len(points) or end >= len(points):
            continue
        p1 = points[start]
        p2 = points[end]
        if p1 is None or p2 is None:
            continue
        cv2.line(glow_layer, p1, p2, primary_color, 8, cv2.LINE_AA)
    cv2.addWeighted(glow_layer, 0.3, frame, 0.7, 0, frame)

    # Main skeleton lines
    for start, end in connections:
        if start >= len(points) or end >= len(points):
            continue
        p1 = points[start]
        p2 = points[end]
        if p1 is None or p2 is None:
            continue
        cv2.line(frame, p1, p2, primary_color, 2, cv2.LINE_AA)

    # Landmark dots: outer ring + bright center
    for point in points:
        if point is None:
            continue
        cv2.circle(frame, point, 5, primary_color, -1, cv2.LINE_AA)
        cv2.circle(frame, point, 2, (255, 255, 255), -1, cv2.LINE_AA)


# ── Player bounding box with corner brackets ──────────────────────────────────

def _draw_player_bbox(
    frame: np.ndarray,
    bbox: dict[str, int],
    primary_color: tuple[int, int, int] = (40, 220, 80),
) -> None:
    x1 = int(bbox.get("x_min", 0))
    y1 = int(bbox.get("y_min", 0))
    x2 = int(bbox.get("x_max", 0))
    y2 = int(bbox.get("y_max", 0))

    h, w = frame.shape[:2]
    x1 = max(0, min(w - 1, x1))
    y1 = max(0, min(h - 1, y1))
    x2 = max(x1 + 1, min(w - 1, x2))
    y2 = max(y1 + 1, min(h - 1, y2))

    bracket_len = min(30, (x2 - x1) // 3, (y2 - y1) // 3)
    thickness = 3

    # Top-left
    cv2.line(frame, (x1, y1), (x1 + bracket_len, y1), primary_color, thickness, cv2.LINE_AA)
    cv2.line(frame, (x1, y1), (x1, y1 + bracket_len), primary_color, thickness, cv2.LINE_AA)
    # Top-right
    cv2.line(frame, (x2, y1), (x2 - bracket_len, y1), primary_color, thickness, cv2.LINE_AA)
    cv2.line(frame, (x2, y1), (x2, y1 + bracket_len), primary_color, thickness, cv2.LINE_AA)
    # Bottom-left
    cv2.line(frame, (x1, y2), (x1 + bracket_len, y2), primary_color, thickness, cv2.LINE_AA)
    cv2.line(frame, (x1, y2), (x1, y2 - bracket_len), primary_color, thickness, cv2.LINE_AA)
    # Bottom-right
    cv2.line(frame, (x2, y2), (x2 - bracket_len, y2), primary_color, thickness, cv2.LINE_AA)
    cv2.line(frame, (x2, y2), (x2, y2 - bracket_len), primary_color, thickness, cv2.LINE_AA)


# ── HUD panel ─────────────────────────────────────────────────────────────────

def _coerce_score(value: object) -> int:
    """Coerce a model-supplied form score to an int for display, or 0.

    The value is a Gemini output, so it arrives as a float, an int, or a numeric
    string depending on the model's mood. `quality_check` coerces with float() and
    accepts "8.5" as in-range, and `validator` checks the summary fields for
    presence but never for type, so a stringly-typed score reaches the renderer
    intact — where `int("8.5")` raised ValueError and killed the render at the
    most expensive stage of the job, after the model call had been paid for.
    NaN and +/-inf convert without raising but cannot be rendered as a score.
    """
    if value is None or isinstance(value, bool):
        return 0
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0
    if not math.isfinite(number):
        return 0
    return int(number)


def _draw_hud(
    frame: np.ndarray,
    analysis_result: dict,
    timestamp: float,
    colors: dict,
    total_frames: int,
    current_frame: int,
) -> None:
    sport = str(analysis_result.get("sport", "unknown"))
    form_score = _coerce_score(analysis_result.get("form_score"))
    tips = analysis_result.get("top_tips", []) or []

    if not isinstance(tips, list):
        tips = [str(tips)]

    tip_text = "No tip available"
    if tips:
        tip_index = int(timestamp // 3) % len(tips)
        tip_text = str(tips[tip_index])

    frame_h, frame_w = frame.shape[:2]
    panel_w = int(frame_w * 0.42)
    panel_h = 140
    panel_w = max(320, min(panel_w, frame_w - 20))
    panel_x = 12
    panel_y = 12
    radius = 12
    primary_color = tuple(colors.get("primary", (0, 165, 255)))
    score_col = _score_color(form_score, colors)

    # Semi-transparent dark background with rounded corners
    overlay = frame.copy()
    _draw_filled_rounded_rect(overlay, panel_x, panel_y, panel_x + panel_w, panel_y + panel_h, (15, 15, 15), radius)
    cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)

    # Sport color accent border (top edge only, rounded)
    _draw_rounded_rect_border(frame, panel_x, panel_y, panel_x + panel_w, panel_y + panel_h, primary_color, radius, 2)

    # Sport label
    label = f"{_sport_label(sport)}"
    _draw_pil_text(frame, label, panel_x + 16, panel_y + 18, 20, (250, 250, 250))

    # Form score — large, color-coded
    score_str = f"{form_score}"
    _draw_pil_text(frame, score_str, panel_x + 16, panel_y + 52, 42, score_col)
    tw, _ = _text_size_pil(score_str, 42)
    _draw_pil_text(frame, "/10", panel_x + 16 + tw + 4, panel_y + 66, 18, (160, 160, 160))

    # Rating badge
    rating = str(analysis_result.get("overall_rating", ""))
    if rating:
        badge_w, badge_h = _text_size_pil(rating.upper(), 12)
        badge_x = panel_x + 16
        badge_y = panel_y + 100
        badge_pad = 6
        overlay2 = frame.copy()
        cv2.rectangle(
            overlay2,
            (badge_x, badge_y),
            (badge_x + badge_w + badge_pad * 2, badge_y + badge_h + badge_pad * 2),
            primary_color,
            -1,
            cv2.LINE_AA,
        )
        cv2.addWeighted(overlay2, 0.35, frame, 0.65, 0, frame)
        _draw_pil_text(frame, rating.upper(), badge_x + badge_pad, badge_y + badge_pad - 2, 12, (255, 255, 255))

    # Rotating tip (right side of panel)
    tip_x = panel_x + panel_w // 2 + 10
    if tip_text:
        wrapped = tip_text[:80]
        _draw_pil_text(frame, wrapped, tip_x, panel_y + 50, 14, (200, 200, 200))

    # Timestamp display (top-right corner)
    ts_str = f"{timestamp:.1f}s"
    tw2, _ = _text_size_pil(ts_str, 14)
    _draw_pil_text(frame, ts_str, frame_w - tw2 - 16, 18, 14, (180, 180, 180))

    # Bottom progress bar
    bar_h = 4
    bar_y = frame_h - bar_h
    bar_bg = (40, 40, 40)
    cv2.rectangle(frame, (0, bar_y), (frame_w, frame_h), bar_bg, -1)

    if total_frames > 0:
        progress = max(0.0, min(1.0, current_frame / total_frames))
        bar_fill_w = int(frame_w * progress)
        if bar_fill_w > 0:
            cv2.rectangle(frame, (0, bar_y), (bar_fill_w, frame_h), primary_color, -1, cv2.LINE_AA)
            # Rounded end cap
            cv2.circle(frame, (bar_fill_w, bar_y + bar_h // 2), bar_h // 2, primary_color, -1, cv2.LINE_AA)


# ── Summary screen ────────────────────────────────────────────────────────────

def _draw_score_ring(
    frame: np.ndarray,
    center_x: int,
    center_y: int,
    radius: int,
    form_score: int,
    score_color: tuple[int, int, int],
) -> None:
    """Draw a circular score ring with the score in the center."""
    # Background ring
    cv2.ellipse(
        frame,
        (center_x, center_y),
        (radius, radius),
        0, 0, 360,
        (50, 50, 50),
        6,
        cv2.LINE_AA,
    )
    # Score arc (proportional to form_score/10)
    angle = int(360 * form_score / 10)
    if angle > 0:
        cv2.ellipse(
            frame,
            (center_x, center_y),
            (radius, radius),
            -90, 0, angle,
            score_color,
            6,
            cv2.LINE_AA,
        )

    # Score text
    score_str = str(form_score)
    tw, th = _text_size_pil(score_str, 52)
    _draw_pil_text(frame, score_str, center_x - tw // 2, center_y - th // 2 - 8, 52, score_color)
    label = "/10"
    lw, lh = _text_size_pil(label, 16)
    _draw_pil_text(frame, label, center_x - lw // 2, center_y + th // 2 - 6, 16, (160, 160, 160))


def _draw_summary_screen(frame: np.ndarray, analysis_result: dict, colors: dict) -> np.ndarray:
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (frame.shape[1], frame.shape[0]), (8, 8, 8), -1)
    cv2.addWeighted(overlay, 0.88, frame, 0.12, 0, frame)

    form_score = int(analysis_result.get("form_score", 0) or 0)
    overall_rating = str(analysis_result.get("overall_rating", "N/A"))
    summary = str(analysis_result.get("summary", ""))
    tips = analysis_result.get("top_tips", []) or []
    sport = str(analysis_result.get("sport", "unknown"))
    primary_color = tuple(colors.get("primary", (0, 165, 255)))
    score_color = _score_color(form_score, colors)

    frame_h, frame_w = frame.shape[:2]
    cx = frame_w // 2
    cy = frame_h // 2

    # Sport label at top
    sport_label = _sport_label(sport)
    tw, _ = _text_size_pil(sport_label, 22)
    _draw_pil_text(frame, sport_label, cx - tw // 2, 40, 22, (200, 200, 200))

    # "Session Complete" title
    title = "Session Complete"
    tw2, _ = _text_size_pil(title, 36)
    _draw_pil_text(frame, title, cx - tw2 // 2, 76, 36, (240, 240, 240))

    # Score ring (left side of center)
    ring_x = cx - 120
    ring_y = cy - 20
    _draw_score_ring(frame, ring_x, ring_y, 70, form_score, score_color)

    # Rating (right side of center)
    rating_x = cx + 20
    rating_y = ring_y - 20
    _draw_pil_text(frame, "RATING", rating_x, rating_y, 12, (140, 140, 140))
    _draw_pil_text(frame, overall_rating.upper(), rating_x, rating_y + 18, 28, (230, 230, 230))

    # Summary text
    summary_y = ring_y + 100
    summary_wrapped = summary[:120]
    _draw_pil_text(frame, summary_wrapped, cx - 300, summary_y, 16, (190, 190, 190))

    # Tips column
    tips_y = summary_y + 50
    _draw_pil_text(frame, "TOP TIPS", cx - 300, tips_y, 14, primary_color)
    tips_y += 28
    for idx, tip in enumerate(tips[:4], start=1):
        tip_line = f"{idx}.  {str(tip)[:75]}"
        _draw_pil_text(frame, tip_line, cx - 290, tips_y + (idx - 1) * 32, 14, (210, 210, 210))

    return frame


# ── Main render function ─────────────────────────────────────────────────────

def render_video(
    video_path: str,
    output_path: str,
    analysis_result: dict,
    active_player_landmarks_per_frame: list,
    fps: float,
    sport: str | None = None,
) -> str:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("Failed to open video for rendering")

    in_fps = float(cap.get(cv2.CAP_PROP_FPS))
    use_fps = fps if fps > 0 else (in_fps if in_fps > 0 else 30.0)

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Resolve sport from analysis_result if not explicitly passed
    if sport is None:
        sport = str(analysis_result.get("sport", "unknown"))
    colors = _sport_colors(sport)

    # Try H.264 first (avc1 on macOS, H264 on Linux), fallback to mp4v
    for codec in ["avc1", "H264", "mp4v"]:
        writer = cv2.VideoWriter(
            output_path,
            cv2.VideoWriter_fourcc(*codec),
            use_fps,
            (width, height),
        )
        if writer.isOpened():
            break
    else:
        cap.release()
        raise RuntimeError("Failed to open output writer with any supported codec")

    connections = get_pose_connections()

    track_by_frame: Dict[int, Dict[str, Any]] = {
        int(item["frame_index"]): item for item in active_player_landmarks_per_frame
    }

    frame_index = 0
    last_frame = None

    # `cap` and `writer` are released in a finally: an exception from the frame
    # loop (a decode error, a malformed analysis_result) used to escape with
    # both handles open and the mp4 never finalized, leaking a descriptor and a
    # partial video per failure. release() is idempotent, so the success path
    # releases here and the finally acts as the backstop.
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            track = track_by_frame.get(frame_index)
            if track:
                _draw_pose_landmarks(frame, track["landmarks"], connections, tuple(colors["primary"]))
                _draw_player_bbox(frame, track["bbox"], tuple(colors["primary"]))

            timestamp = frame_index / max(1.0, use_fps)
            _draw_hud(frame, analysis_result, timestamp, colors, total_frames, frame_index)

            writer.write(frame)
            last_frame = frame
            frame_index += 1

        if last_frame is not None:
            hold_frames = int(round(use_fps * 3))
            summary_frame = _draw_summary_screen(last_frame.copy(), analysis_result, colors)
            for _ in range(max(1, hold_frames)):
                writer.write(summary_frame)
    except BaseException:
        # A partially written video is not deliverable; drop it rather than
        # leave it for someone to find.
        try:
            Path(output_path).unlink(missing_ok=True)
        except OSError:
            pass
        raise
    finally:
        writer.release()
        cap.release()
    return output_path
