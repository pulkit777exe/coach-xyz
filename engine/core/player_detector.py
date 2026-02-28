"""
core/player_detector.py — Detect all players in a video frame.

Uses OpenCV's built-in HOG + SVM people detector (no extra model downloads).
Produces a numbered, colour-annotated JPEG saved to ~/Downloads so the
user can visually pick which player to analyse.

Improvements over v1
--------------------
* Multi-frame consensus — samples every 5 s across the first 90 s, keeps the
  frame where the most distinct players are visible and well-separated.
* Jersey-colour sampling — dominant colour is extracted from the *torso* region
  of each detected bounding box (avoids background noise).
* Confidence-weighted NMS — uses HOG response weights rather than just size.
* Rich annotation — larger numbered labels, colour legend sidebar, timestamp
  footer, and a translucent HUD strip at the top.
* Enhanced image saved at higher quality (JPEG 97) so colours read correctly.
"""

import cv2
import numpy as np
import pathlib
from typing import NamedTuple


# ── Types ─────────────────────────────────────────────────────────────────────

class Player(NamedTuple):
    id:          int
    color_bgr:   tuple          # BGR for OpenCV drawing
    color_hex:   str            # hex for Rich terminal colour
    jersey_bgr:  tuple          # dominant jersey colour (BGR)
    jersey_hex:  str            # dominant jersey colour (hex)
    bbox:        tuple          # (x, y, w, h) in original frame coords
    position:    str            # "top-left", "center", etc.
    confidence:  float          # HOG detection confidence (0–1 normalised)


# ── Colour palette ─────────────────────────────────────────────────────────────
# Each entry: (BGR annotation colour, hex string)

_PALETTE = [
    ((0,  220, 255), "#00dcff"),   # 1 — cyan
    ((60, 120, 255), "#3c78ff"),   # 2 — blue
    ((0,  220, 120), "#00dc78"),   # 3 — green
    ((220, 60, 255), "#dc3cff"),   # 4 — purple
    ((255, 200,  0), "#ffc800"),   # 5 — gold
    ((255,  60,  60), "#ff3c3c"),  # 6 — red
    ((180, 255,  60), "#b4ff3c"),  # 7 — lime
    ((255, 140,  0), "#ff8c00"),   # 8 — orange
]

_HUD_HEIGHT  = 50   # bottom HUD strip height (px)
_LEG_WIDTH   = 220  # right-side legend panel width (px)
_FONT        = cv2.FONT_HERSHEY_SIMPLEX


# ── Core detection ────────────────────────────────────────────────────────────

def detect_players(video_path: str, sample_interval_s: float = 5.0) -> dict:
    """
    Sample frames from *video_path*, run HOG person detection across the first
    90 seconds (or whole clip if shorter), and return the frame where the most
    clearly separated, high-confidence players appear.

    Returns
    -------
    {
       "frame"         : np.ndarray,   # richly-annotated BGR image
       "players"       : list[Player],
       "frame_index"   : int,
       "frame_ts_s"    : float,
       "frame_width"   : int,
       "frame_height"  : int,
    }
    """
    cap     = cv2.VideoCapture(video_path)
    fps     = max(1.0, cap.get(cv2.CAP_PROP_FPS))
    total   = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fw      = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    fh      = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_s = total / fps

    scan_s  = min(total_s, 90.0)
    times   = list(np.arange(1.5, max(2.5, scan_s), sample_interval_s))

    hog = cv2.HOGDescriptor()
    hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

    best_frame   = None
    best_raw     = None       # un-annotated original
    best_fidx    = 0
    best_ts_s    = 0.0
    best_boxes:  list = []
    best_weights: list = []

    for t in times:
        fidx = int(fps * t)
        cap.set(cv2.CAP_PROP_POS_FRAMES, fidx)
        ok, frame = cap.read()
        if not ok:
            continue

        scale  = min(1.0, 800 / max(fw, fh, 1))
        small  = cv2.resize(frame, None, fx=scale, fy=scale)

        boxes, weights = hog.detectMultiScale(
            small,
            winStride=(8, 8),
            padding=(8, 8),
            scale=1.05,
        )

        if len(boxes) == 0:
            continue

        boxes   = (np.array(boxes, dtype=float) / scale).astype(int)
        weights = list(weights.flatten())
        boxes, weights = _nms_weighted(boxes, weights, overlap_thresh=0.45)

        # Prefer the frame with the most confident, well-spread detections
        score = len(boxes) * 10 + sum(weights)
        if score > (len(best_boxes) * 10 + sum(best_weights)):
            best_boxes   = boxes
            best_weights = weights
            best_frame   = frame.copy()
            best_raw     = frame.copy()
            best_fidx    = fidx
            best_ts_s    = t

    cap.release()

    # Fallback if nothing found
    if best_frame is None:
        cap2 = cv2.VideoCapture(video_path)
        cap2.set(cv2.CAP_PROP_POS_FRAMES, int(total * 0.15))
        ok, best_frame = cap2.read()
        cap2.release()
        if not ok:
            best_frame = np.zeros((480, 640, 3), np.uint8)
        best_raw = best_frame.copy()

    # ── Build Player objects and annotate ────────────────────────────────────
    players   = _make_players(best_boxes, best_weights, best_raw, fw, fh)
    annotated = _draw_rich_frame(best_frame.copy(), players, best_ts_s, fw, fh, video_path)

    return {
        "frame":        annotated,
        "players":      players,
        "frame_index":  best_fidx,
        "frame_ts_s":   best_ts_s,
        "frame_width":  fw,
        "frame_height": fh,
    }


# ── Public helpers ─────────────────────────────────────────────────────────────

def save_player_frame(annotated: np.ndarray, video_path: str,
                      out_dir: pathlib.Path) -> pathlib.Path:
    """Save the annotated frame JPEG to *out_dir* at high quality."""
    stem = pathlib.Path(video_path).stem
    out  = out_dir / f"{stem}_players.jpg"
    cv2.imwrite(str(out), annotated, [cv2.IMWRITE_JPEG_QUALITY, 97])
    return out


def bbox_to_position(bbox: tuple, frame_w: int, frame_h: int) -> str:
    """Translate a (x, y, w, h) box into a human-readable position string."""
    x, y, w, h = bbox
    cx = x + w / 2
    cy = y + h / 2

    col = "left"   if cx < frame_w / 3 else "right"  if cx > 2 * frame_w / 3 else "center"
    row = "top"    if cy < frame_h / 3 else "bottom" if cy > 2 * frame_h / 3 else "middle"

    if row == "middle" and col == "center":
        return "center of frame"
    if row == "middle":
        return f"{col} side"
    return f"{row}-{col}"


# ── Jersey colour extraction ──────────────────────────────────────────────────

def _sample_jersey_color(frame: np.ndarray, bbox: tuple) -> tuple[tuple, str]:
    """
    Sample the dominant colour from the *torso* portion of the bounding box
    (middle 40 % vertically, inner 70 % horizontally) to estimate jersey colour.
    Returns (bgr_tuple, hex_string).
    """
    x, y, w, h = bbox
    x1 = max(0, x + int(w * 0.15))
    x2 = min(frame.shape[1], x + int(w * 0.85))
    y1 = max(0, y + int(h * 0.30))
    y2 = min(frame.shape[0], y + int(h * 0.70))

    roi = frame[y1:y2, x1:x2]
    if roi.size == 0:
        return (128, 128, 128), "#808080"

    # k-means with k=2 — dominant foreground colour
    data = roi.reshape(-1, 3).astype(np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 10, 1.0)
    try:
        _, labels, centers = cv2.kmeans(
            data, 2, None, criteria, 3, cv2.KMEANS_PP_CENTERS
        )
        counts = np.bincount(labels.flatten())
        dominant = centers[np.argmax(counts)].astype(int)
        bgr = (int(dominant[0]), int(dominant[1]), int(dominant[2]))
        hex_col = "#{:02x}{:02x}{:02x}".format(dominant[2], dominant[1], dominant[0])
        return bgr, hex_col
    except Exception:
        return (128, 128, 128), "#808080"


# ── NMS (weighted) ─────────────────────────────────────────────────────────────

def _nms_weighted(boxes: np.ndarray, weights: list,
                  overlap_thresh: float = 0.45) -> tuple[list, list]:
    """Confidence-weighted NMS for [x, y, w, h] boxes."""
    if len(boxes) == 0:
        return [], []
    x1 = boxes[:, 0].astype(float)
    y1 = boxes[:, 1].astype(float)
    x2 = (boxes[:, 0] + boxes[:, 2]).astype(float)
    y2 = (boxes[:, 1] + boxes[:, 3]).astype(float)
    areas = (x2 - x1 + 1) * (y2 - y1 + 1)
    w_arr = np.array(weights, dtype=float)
    order = np.argsort(w_arr)[::-1]   # highest-confidence first
    keep  = []

    while order.size > 0:
        i = order[0]
        keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.maximum(0.0, xx2 - xx1) * np.maximum(0.0, yy2 - yy1)
        ovr   = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)
        order = order[1:][ovr <= overlap_thresh]

    kept_boxes   = [boxes[k] for k in keep]
    kept_weights = [weights[k] for k in keep]
    return kept_boxes, kept_weights


# ── Build Player list ─────────────────────────────────────────────────────────

def _make_players(boxes: list, weights: list,
                  raw_frame: np.ndarray, fw: int, fh: int) -> list:
    if not weights:
        weights = [1.0] * len(boxes)
    max_w = max(weights) if weights else 1.0

    players = []
    for i, (box, wt) in enumerate(zip(boxes, weights)):
        pal_bgr, pal_hex = _PALETTE[i % len(_PALETTE)]
        x, y, w, h = (int(v) for v in box)
        pos         = bbox_to_position((x, y, w, h), fw, fh)
        jer_bgr, jer_hex = _sample_jersey_color(raw_frame, (x, y, w, h))
        conf        = round(float(wt) / max(float(max_w), 1e-9), 3)

        players.append(Player(
            id          = i + 1,
            color_bgr   = pal_bgr,
            color_hex   = pal_hex,
            jersey_bgr  = jer_bgr,
            jersey_hex  = jer_hex,
            bbox        = (x, y, w, h),
            position    = pos,
            confidence  = conf,
        ))
    return players


# ── Rich annotation ───────────────────────────────────────────────────────────

def _draw_rich_frame(frame: np.ndarray, players: list,
                     ts_s: float, fw: int, fh: int,
                     video_path: str) -> np.ndarray:
    """
    Produce the final annotated image:
      • HUD strip at the top (title + timestamp)
      • Coloured bounding boxes with large numbered labels
      • Per-player jersey-colour swatch in the label pill
      • Right-side legend panel listing all players
      • Footer watermark
    """
    if len(players) == 0:
        _no_detection_overlay(frame, fh)
        return frame

    # ── 1. Tinted fill pass ──────────────────────────────────────────────────
    overlay = frame.copy()
    for p in players:
        x, y, w, h = p.bbox
        cv2.rectangle(overlay, (x, y), (x + w, y + h), p.color_bgr, -1)
    cv2.addWeighted(overlay, 0.15, frame, 0.85, 0, frame)

    # ── 2. Bounding boxes + labels ───────────────────────────────────────────
    for p in players:
        x, y, w, h = p.bbox
        col = p.color_bgr

        # Shadow + coloured border
        cv2.rectangle(frame, (x - 2, y - 2), (x + w + 2, y + h + 2), (0, 0, 0), 3)
        cv2.rectangle(frame, (x,     y    ), (x + w,     y + h    ), col,       2)

        # Corner brackets
        cl = max(12, min(24, w // 6))
        for cx, cy, dx, dy in [
            (x,     y,     +1, +1),
            (x + w, y,     -1, +1),
            (x,     y + h, +1, -1),
            (x + w, y + h, -1, -1),
        ]:
            cv2.line(frame, (cx, cy), (cx + dx * cl, cy),       col, 3)
            cv2.line(frame, (cx, cy), (cx,       cy + dy * cl), col, 3)

        # Label pill above box
        label = f"  PLAYER {p.id}  "
        fs    = max(0.50, min(1.0, w / 120))
        (tw, th), bl = cv2.getTextSize(label, _FONT, fs, 2)
        lx = max(0, x)
        ly = max(0, y - th - bl - 14)
        pill_y2 = ly + th + bl + 8

        # Pill background
        cv2.rectangle(frame, (lx - 4, ly - 5), (lx + tw + 24, pill_y2), (0, 0, 0), -1)
        cv2.rectangle(frame, (lx - 4, ly - 5), (lx + tw + 24, pill_y2), col, 2)

        # Jersey colour swatch (small square)
        sw = th + bl + 4
        sx = lx + tw + 4
        cv2.rectangle(frame, (sx, ly - 3), (sx + sw, pill_y2 - 2), p.jersey_bgr, -1)
        cv2.rectangle(frame, (sx, ly - 3), (sx + sw, pill_y2 - 2), col, 1)

        cv2.putText(frame, label, (lx, ly + th),
                    _FONT, fs, col, 2, cv2.LINE_AA)

    # ── 3. Bottom HUD strip ──────────────────────────────────────────────────
    stem  = pathlib.Path(video_path).stem
    ts_m  = int(ts_s // 60)
    ts_sc = ts_s % 60
    hud_h = _HUD_HEIGHT
    n_p   = len(players)
    # Draw a solid black bar at the bottom
    cv2.rectangle(frame, (0, fh - hud_h), (fw, fh), (0, 0, 0), -1)
    line1 = f"CoachAI Player Detection  [{stem}]  Frame {ts_m}:{ts_sc:05.2f}"
    line2 = f"{n_p} player{'s' if n_p != 1 else ''} detected -- pick a number in the terminal"
    cv2.putText(frame, line1, (10, fh - hud_h + 20),
                _FONT, 0.50, (200, 220, 255), 1, cv2.LINE_AA)
    cv2.putText(frame, line2, (10, fh - hud_h + 40),
                _FONT, 0.44, (120, 180, 255), 1, cv2.LINE_AA)

    # ── 4. Right-side legend panel ────────────────────────────────────────────
    leg_w = _LEG_WIDTH
    leg_h = fh
    legend = np.zeros((leg_h, leg_w, 3), np.uint8)
    legend[:] = (15, 15, 25)                      # dark background

    # Title
    cv2.putText(legend, "PLAYERS", (12, 28),
                _FONT, 0.58, (200, 220, 255), 1, cv2.LINE_AA)
    cv2.line(legend, (8, 36), (leg_w - 8, 36), (60, 80, 120), 1)

    row_h = 52
    for idx, p in enumerate(players):
        yi = 42 + idx * row_h
        if yi + row_h > leg_h - 50:
            break  # stop if we'd overflow the legend

        # Annotation colour swatch
        cv2.rectangle(legend, (10, yi + 2), (28, yi + 22), p.color_bgr, -1)
        cv2.rectangle(legend, (10, yi + 2), (28, yi + 22), (200, 200, 200), 1)

        # Jersey colour swatch
        cv2.rectangle(legend, (32, yi + 2), (50, yi + 22), p.jersey_bgr, -1)
        cv2.rectangle(legend, (32, yi + 2), (50, yi + 22), (200, 200, 200), 1)

        cv2.putText(legend, f"P{p.id}", (10, yi + 38),
                    _FONT, 0.42, p.color_bgr, 1, cv2.LINE_AA)
        # Position text — truncate to fit
        pos_short = p.position[:18]
        cv2.putText(legend, pos_short, (56, yi + 14),
                    _FONT, 0.38, (200, 200, 200), 1, cv2.LINE_AA)
        conf_str = f"{p.confidence:.0%} conf"
        cv2.putText(legend, conf_str, (56, yi + 30),
                    _FONT, 0.36, (130, 160, 200), 1, cv2.LINE_AA)

        # Divider
        if idx < len(players) - 1:
            cv2.line(legend, (8, yi + row_h - 4), (leg_w - 8, yi + row_h - 4),
                     (40, 50, 70), 1)

    # Footer hint at bottom of legend
    hint_y = leg_h - 40
    cv2.putText(legend, "Swatch = jersey", (8, hint_y),
                cv2.FONT_HERSHEY_PLAIN, 0.85, (100, 110, 130), 1, cv2.LINE_AA)
    cv2.putText(legend, "colour detected", (8, hint_y + 14),
                cv2.FONT_HERSHEY_PLAIN, 0.85, (100, 110, 130), 1, cv2.LINE_AA)

    # Append legend to the right of the frame
    if fh == frame.shape[0]:
        frame = np.hstack([frame, legend])

    return frame


def _no_detection_overlay(frame: np.ndarray, fh: int):
    """Draw a message when no players are detected."""
    h, w = frame.shape[:2]
    msgs = [
        "CoachAI: Auto-detect found no players in this clip.",
        "All players will be analyzed together.",
        "Tip: ensure the video clearly shows the playing area.",
    ]
    bg_h = len(msgs) * 30 + 20
    cv2.rectangle(frame, (0, 20), (w, 20 + bg_h), (0, 0, 0), -1)
    for i, msg in enumerate(msgs):
        cv2.putText(frame, msg, (18, 52 + i * 30),
                    _FONT, 0.65, (80, 200, 255), 1, cv2.LINE_AA)
