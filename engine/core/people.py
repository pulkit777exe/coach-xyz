"""Finding people in a frame and telling them apart.

`scan` picks the frame where the players are easiest to tell apart, so the
coach can choose one. The chosen player is remembered as a box plus a colour
signature of their torso, which the tracker later uses to find them again.
"""

import base64
from dataclasses import dataclass

import cv2
import numpy as np

from .errors import EngineError

CORE = [11, 12, 23, 24, 25, 26]
MAX_SIDE = 1280


@dataclass
class Person:
    lm: np.ndarray  # (33, 4), normalized to the full frame
    box: np.ndarray  # x1, y1, x2, y2 in pixels
    conf: float


def iou(a, b) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def box_from(lm: np.ndarray, w: int, h: int) -> np.ndarray:
    pts = lm[lm[:, 3] > 0.3]
    if len(pts) < 4:
        pts = lm
    x1, y1 = pts[:, 0].min() * w, pts[:, 1].min() * h
    x2, y2 = pts[:, 0].max() * w, pts[:, 1].max() * h
    px, py = (x2 - x1) * 0.1, (y2 - y1) * 0.1
    return np.array([max(0, x1 - px), max(0, y1 - py * 1.5), min(w - 1, x2 + px), min(h - 1, y2 + py)], dtype=float)


def _person(lm: np.ndarray, w: int, h: int) -> Person | None:
    box = box_from(lm, w, h)
    if box[3] - box[1] < max(40, 0.06 * h) or box[2] - box[0] < 12:
        return None
    return Person(lm=lm, box=box, conf=float(lm[CORE, 3].mean()))


def _detect(detector, crop, x0, y0, w, h, max_people) -> list[Person]:
    ch, cw = crop.shape[:2]
    k = min(1.0, MAX_SIDE / max(ch, cw))
    small = cv2.resize(crop, None, fx=k, fy=k, interpolation=cv2.INTER_AREA) if k < 1 else crop
    found = []
    for lm in detector.detect(small, max_people):
        lm = lm.copy()
        lm[:, 0] = (x0 + lm[:, 0] * cw) / w
        lm[:, 1] = (y0 + lm[:, 1] * ch) / h
        person = _person(lm, w, h)
        if person:
            found.append(person)
    return found


def find_people(detector, frame: np.ndarray, max_people: int = 8) -> list[Person]:
    """Everyone clearly visible. Wide frames with few results are retried in overlapping tiles."""
    h, w = frame.shape[:2]
    people = _detect(detector, frame, 0, 0, w, h, max_people)
    if len(people) < 2 and w >= 1280:
        cut = int(w * 0.55)
        for x0, x1 in ((0, cut), (w - cut, w)):
            people += _detect(detector, frame[:, x0:x1], x0, 0, w, h, max_people)
        kept: list[Person] = []
        for p in sorted(people, key=lambda p: -p.conf):
            if all(iou(p.box, q.box) <= 0.5 for q in kept):
                kept.append(p)
        people = kept
    return people


def signature(frame: np.ndarray, box) -> np.ndarray | None:
    """Colour histogram of the torso (hue, saturation, value)."""
    x1, y1, x2, y2 = box
    bw, bh = x2 - x1, y2 - y1
    roi = frame[max(0, int(y1 + bh * 0.22)):int(y1 + bh * 0.58), max(0, int(x1 + bw * 0.2)):int(x2 - bw * 0.2)]
    if roi.size == 0 or min(roi.shape[:2]) < 4:
        return None
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1, 2], None, [12, 3, 3], [0, 180, 0, 256, 0, 256]).flatten()
    total = hist.sum()
    return (hist / total).astype(np.float32) if total > 0 else None


def similarity(a, b) -> float:
    if a is None or b is None:
        return 0.0
    return float(np.minimum(a, b).sum())


def _crop_b64(frame: np.ndarray, box) -> str:
    h, w = frame.shape[:2]
    pad_x, pad_y = (box[2] - box[0]) * 0.1, (box[3] - box[1]) * 0.1
    crop = frame[max(0, int(box[1] - pad_y)):min(h, int(box[3] + pad_y)),
                 max(0, int(box[0] - pad_x)):min(w, int(box[2] + pad_x))]
    k = 256 / max(crop.shape[:2])
    crop = cv2.resize(crop, None, fx=k, fy=k, interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_CUBIC)
    ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return base64.b64encode(buf.tobytes()).decode() if ok else ""


def scan(path: str, detector, progress=lambda done, total: None, samples: int = 20, require_players: bool = True, whole_frame_analysis: bool = False) -> dict:
    """Sample the video and describe the people in the clearest frame, left to right."""
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise EngineError("VIDEO_DECODE_FAILED", "Could not read this video.")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    duration = cap.get(cv2.CAP_PROP_FRAME_COUNT) / fps
    times = np.linspace(0.0, max(0.0, duration - 0.3), max(1, min(samples, int(duration * 2) or 1)))
    best, best_score = None, -1.0
    try:
        for n, t in enumerate(times):
            cap.set(cv2.CAP_PROP_POS_MSEC, float(t) * 1000)
            ok, frame = cap.read()
            progress(n + 1, len(times))
            if not ok:
                continue
            people = find_people(detector, frame)
            if not people:
                continue
            overlap = sum(iou(a.box, b.box) for i, a in enumerate(people) for b in people[i + 1:])
            score = len(people) * float(np.mean([p.conf for p in people])) - overlap
            if score > best_score:
                best, best_score = (frame.copy(), people, float(t)), score
    finally:
        cap.release()
    if best is None:
        raise EngineError("NO_PLAYERS_DETECTED", "No players detected clearly in this video. "
                          "Try better lighting or a less crowded frame.", retryable=True)
    frame, people, t = best
    out = []
    for k, p in enumerate(sorted(people, key=lambda p: p.box[0] + p.box[2]), start=1):
        sig = signature(frame, p.box)
        out.append({
            "player_index": k,
            "confidence": round(p.conf, 2),
            "crop_base64": _crop_b64(frame, p.box),
            "bbox": {"x_min": int(p.box[0]), "y_min": int(p.box[1]), "x_max": int(p.box[2]), "y_max": int(p.box[3])},
            "frame_timestamp": round(t, 2),
            "signature": sig.tolist() if sig is not None else None,
        })
    return out
