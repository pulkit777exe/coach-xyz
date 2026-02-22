"""
core/player_detector.py — Detect all players in a video frame.

Uses OpenCV's built-in HOG + SVM people detector (no extra model downloads).
Produces a numbered, coloured annotated JPEG that is saved to ~/Downloads so
the user can pick which player to analyse.
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
    bbox:        tuple          # (x, y, w, h) in original frame coords
    position:    str            # "top-left", "center", etc.


# ── Colour palette ────────────────────────────────────────────────────────────

_PALETTE = [
    ((0,  220, 255), "#00dcff"),   # cyan
    ((60, 120, 255), "#3c78ff"),   # blue
    ((0,  220, 120), "#00dc78"),   # green
    ((220, 60, 255), "#dc3cff"),   # purple
    ((255, 200,  0), "#ffc800"),   # gold
    ((255,  60,  60), "#ff3c3c"),  # red
    ((180, 255,  60), "#b4ff3c"),  # lime
    ((255, 140,  0), "#ff8c00"),   # orange
]


# ── Core detection ────────────────────────────────────────────────────────────

def detect_players(video_path: str, sample_count: int = 14) -> dict:
    """
    Sample frames from *video_path*, run HOG person detection, pick the
    frame with the most clearly separated detections, annotate it with
    numbered bounding boxes, and return a result dict.

    Returns
    -------
    {
       "frame"         : np.ndarray,   # annotated BGR image
       "players"       : list[Player],
       "frame_index"   : int,
       "frame_width"   : int,
       "frame_height"  : int,
    }
    """
    cap        = cv2.VideoCapture(video_path)
    fps        = max(1.0, cap.get(cv2.CAP_PROP_FPS))
    total      = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fw         = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    fh         = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_s    = total / fps

    # Sample candidate frames spread across the first 60 s (or whole clip)
    scan_s     = min(total_s, 60)
    idxs       = [
        int(fps * t)
        for t in np.linspace(1.5, max(2, scan_s - 1.5), sample_count)
    ]

    hog = cv2.HOGDescriptor()
    hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

    best_frame  = None
    best_fidx   = 0
    best_boxes: list = []

    for fidx in idxs:
        cap.set(cv2.CAP_PROP_POS_FRAMES, fidx)
        ok, frame = cap.read()
        if not ok:
            continue

        # Scale down for speed; HOG needs min 64×128 window
        scale = min(1.0, 800 / max(fw, fh, 1))
        small = cv2.resize(frame, None, fx=scale, fy=scale)

        boxes, weights = hog.detectMultiScale(
            small,
            winStride=(8, 8),
            padding=(8, 8),
            scale=1.05,
        )

        if len(boxes) == 0:
            continue

        # Scale boxes back to full resolution
        boxes = (np.array(boxes) / scale).astype(int)
        boxes = _nms(boxes, overlap_thresh=0.45)

        if len(boxes) > len(best_boxes):
            best_boxes = boxes
            best_frame = frame.copy()
            best_fidx  = fidx

    cap.release()

    # Fallback: grab frame at 15 % of video if nothing found
    if best_frame is None:
        cap2 = cv2.VideoCapture(video_path)
        cap2.set(cv2.CAP_PROP_POS_FRAMES, int(total * 0.15))
        ok, best_frame = cap2.read()
        cap2.release()
        if not ok:
            best_frame = np.zeros((480, 640, 3), np.uint8)

    # ── Annotate ──────────────────────────────────────────────────────────
    annotated = _draw_players(best_frame.copy(), best_boxes, fw, fh)
    players   = _make_players(best_boxes, fw, fh)

    return {
        "frame":        annotated,
        "players":      players,
        "frame_index":  best_fidx,
        "frame_width":  fw,
        "frame_height": fh,
    }


# ── Public helpers ─────────────────────────────────────────────────────────────

def save_player_frame(annotated: np.ndarray, video_path: str,
                      out_dir: pathlib.Path) -> pathlib.Path:
    """Save the annotated frame JPEG to *out_dir*."""
    stem = pathlib.Path(video_path).stem
    out  = out_dir / f"{stem}_players.jpg"
    cv2.imwrite(str(out), annotated, [cv2.IMWRITE_JPEG_QUALITY, 94])
    return out


def bbox_to_position(bbox: tuple, frame_w: int, frame_h: int) -> str:
    """Translate a (x,y,w,h) box into a human-readable position string."""
    x, y, w, h = bbox
    cx = x + w / 2
    cy = y + h / 2

    col = "left" if cx < frame_w / 3 else "right" if cx > 2 * frame_w / 3 else "center"
    row = "top"  if cy < frame_h / 3 else "bottom" if cy > 2 * frame_h / 3 else "middle"

    if row == "middle" and col == "center":
        return "center of the frame"
    if row == "middle":
        return f"{col} side of the frame"
    return f"{row}-{col} area of the frame"


# ── Private helpers ───────────────────────────────────────────────────────────

def _nms(boxes: np.ndarray, overlap_thresh: float = 0.45) -> list:
    """Non-maximum suppression for [x, y, w, h] boxes (keep larger ones)."""
    if len(boxes) == 0:
        return []
    x1 = boxes[:, 0].astype(float)
    y1 = boxes[:, 1].astype(float)
    x2 = (boxes[:, 0] + boxes[:, 2]).astype(float)
    y2 = (boxes[:, 1] + boxes[:, 3]).astype(float)
    areas = (x2 - x1 + 1) * (y2 - y1 + 1)
    order = np.argsort(areas)[::-1]  # largest first
    keep  = []

    while order.size > 0:
        i = order[0]
        keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
        ovr   = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)
        order = order[1:][ovr <= overlap_thresh]

    return [boxes[k] for k in keep]


def _make_players(boxes: list, fw: int, fh: int) -> list:
    players = []
    for i, box in enumerate(boxes):
        bgr, hex_ = _PALETTE[i % len(_PALETTE)]
        x, y, w, h = (int(v) for v in box)
        pos = bbox_to_position((x, y, w, h), fw, fh)
        players.append(Player(
            id        = i + 1,
            color_bgr = bgr,
            color_hex = hex_,
            bbox      = (x, y, w, h),
            position  = pos,
        ))
    return players


def _draw_players(frame: np.ndarray, boxes: list, fw: int, fh: int) -> np.ndarray:
    """Annotate the frame with coloured, numbered bounding boxes."""
    if len(boxes) == 0:
        _no_detection_overlay(frame)
        return frame

    overlay = frame.copy()
    for i, box in enumerate(boxes):
        bgr = _PALETTE[i % len(_PALETTE)][0]
        x, y, w, h = (int(v) for v in box)
        pid = i + 1

        # Tinted fill
        cv2.rectangle(overlay, (x, y), (x + w, y + h), bgr, -1)

    cv2.addWeighted(overlay, 0.18, frame, 0.82, 0, frame)

    for i, box in enumerate(boxes):
        bgr = _PALETTE[i % len(_PALETTE)][0]
        x, y, w, h = (int(v) for v in box)
        pid = i + 1

        # Bold border (2 px dark shadow + colour)
        cv2.rectangle(frame, (x - 1, y - 1), (x + w + 1, y + h + 1), (0, 0, 0), 3)
        cv2.rectangle(frame, (x,     y),     (x + w,     y + h),     bgr,       2)

        # Corner accents
        corner_len = max(10, min(20, w // 5))
        for cx, cy, dx, dy in [
            (x, y, 1, 1), (x + w, y, -1, 1), (x, y + h, 1, -1), (x + w, y + h, -1, -1),
        ]:
            cv2.line(frame, (cx, cy), (cx + dx * corner_len, cy), bgr, 3)
            cv2.line(frame, (cx, cy), (cx, cy + dy * corner_len), bgr, 3)

        # Label pill — "PLAYER 1"
        label    = f"  PLAYER {pid}  "
        fs       = max(0.45, min(0.85, w / 100))
        (tw, th), bl = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, fs, 2)
        lx = max(0, x)
        ly = max(0, y - th - bl - 10)
        # Pill background
        cv2.rectangle(frame, (lx - 2, ly - 4), (lx + tw + 4, ly + th + bl + 6), (0, 0, 0), -1)
        cv2.rectangle(frame, (lx - 2, ly - 4), (lx + tw + 4, ly + th + bl + 6), bgr, 2)
        cv2.putText(frame, label, (lx, ly + th),
                    cv2.FONT_HERSHEY_SIMPLEX, fs, bgr, 2, cv2.LINE_AA)

    # Watermark
    watermark = " CoachAI — Player Detection "
    cv2.putText(frame, watermark, (10, fh - 14),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1, cv2.LINE_AA)
    return frame


def _no_detection_overlay(frame: np.ndarray):
    """Draw a message when no players are detected."""
    h, w = frame.shape[:2]
    msg1 = "Auto-detect found no players."
    msg2 = "All players will be analyzed together."
    for i, msg in enumerate([msg1, msg2]):
        cv2.putText(frame, msg, (20, 44 + i * 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (80, 200, 255), 2, cv2.LINE_AA)
