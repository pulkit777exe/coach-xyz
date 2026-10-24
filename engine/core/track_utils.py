"""core/track_utils.py — temporal handling for sparse pose tracks.

Two problems fixed here:

* The renderer looked up `track_by_frame[frame_index]` by exact match while
  tracks existed only on 3-second keyframes, so the skeleton and box flashed
  for 1 frame in ~90. `interpolate_tracks` produces a per-frame lookup.
* Tracking picked, in every frame, the candidate closest to ONE fixed x
  coordinate taken from the first frame, so the lock drifted onto other
  players as soon as the athlete moved. `choose_candidate` associates by
  predicted-box overlap (+ optional appearance), frame to frame.

Pure functions; no cv2 / mediapipe.
"""

from __future__ import annotations

from typing import Any, Sequence

BBox = tuple[float, float, float, float]  # x1, y1, x2, y2


def iou(a: BBox, b: BBox) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _centroid(b: BBox) -> tuple[float, float]:
    return (b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0


def predict_bbox(prev: BBox, velocity: tuple[float, float] = (0.0, 0.0), dt_frames: float = 1.0) -> BBox:
    """Shift the previous box by velocity (px/frame) * dt."""
    dx, dy = velocity[0] * dt_frames, velocity[1] * dt_frames
    return prev[0] + dx, prev[1] + dy, prev[2] + dx, prev[3] + dy


def choose_candidate(
    candidates: Sequence[BBox],
    predicted: BBox,
    appearance_sims: Sequence[float] | None = None,
    min_score: float = 0.15,
    appearance_weight: float = 0.35,
) -> int | None:
    """Index of the candidate that continues the lock, or None.

    score = (1-w) * IoU(candidate, predicted) + w * appearance (0..1).
    Distance fallback: when no box overlaps, a candidate whose centroid is
    within one predicted-box width still gets a small proximity score, so a
    fast mover is not lost but a far-away teammate is rejected.
    """
    if not candidates:
        return None
    pw = max(1.0, predicted[2] - predicted[0])
    pcx, pcy = _centroid(predicted)
    best_i, best_s = None, 0.0
    for i, box in enumerate(candidates):
        geo = iou(box, predicted)
        if geo == 0.0:
            cx, cy = _centroid(box)
            dist = ((cx - pcx) ** 2 + (cy - pcy) ** 2) ** 0.5
            geo = max(0.0, 0.1 * (1.0 - dist / pw))
        app = appearance_sims[i] if appearance_sims is not None else 0.5
        w = appearance_weight if appearance_sims is not None else 0.0
        score = (1.0 - w) * geo + w * max(0.0, min(1.0, app))
        if score > best_s:
            best_i, best_s = i, score
    return best_i if best_s >= min_score else None


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _interp_track(t0: dict[str, Any], t1: dict[str, Any], t: float, frame_index: int, fps: float) -> dict[str, Any]:
    l0, l1 = t0.get("landmarks") or [], t1.get("landmarks") or []
    landmarks: list[dict[str, float]] = []
    if len(l0) == len(l1) and l0:
        for p, q in zip(l0, l1):
            landmarks.append({
                "x": _lerp(p["x"], q["x"], t),
                "y": _lerp(p["y"], q["y"], t),
                "z": _lerp(p.get("z", 0.0), q.get("z", 0.0), t),
                # An interpolated joint is only as trustworthy as its weaker end.
                "visibility": min(p.get("visibility", 0.0), q.get("visibility", 0.0)),
            })
    b0, b1 = t0["bbox"], t1["bbox"]
    bbox = {k: int(round(_lerp(b0[k], b1[k], t))) for k in ("x_min", "y_min", "x_max", "y_max")}
    return {
        "frame_index": frame_index,
        "timestamp": round(frame_index / fps, 3) if fps > 0 else 0.0,
        "landmarks": landmarks,
        "bbox": bbox,
        "visibility": min(t0.get("visibility", 0.0), t1.get("visibility", 0.0)),
        "interpolated": True,
    }


def interpolate_tracks(
    tracks: Sequence[dict[str, Any]],
    fps: float,
    max_gap_s: float = 4.0,
) -> dict[int, dict[str, Any]]:
    """frame_index -> track, filling gaps between consecutive measured tracks.

    Gaps wider than `max_gap_s` are left empty (athlete likely off-screen);
    the default covers the 3 s keyframe spacing. Measured frames win.
    """
    ordered = sorted((t for t in tracks if t.get("bbox")), key=lambda t: t["frame_index"])
    out: dict[int, dict[str, Any]] = {}
    max_gap_frames = max_gap_s * fps if fps > 0 else 0
    for a, b in zip(ordered, ordered[1:]):
        fa, fb = int(a["frame_index"]), int(b["frame_index"])
        out[fa] = {**a, "interpolated": False}
        span = fb - fa
        if span <= 1 or span > max_gap_frames:
            continue
        for fi in range(fa + 1, fb):
            out[fi] = _interp_track(a, b, (fi - fa) / span, fi, fps)
    if ordered:
        last = ordered[-1]
        out[int(last["frame_index"])] = {**last, "interpolated": False}
    return out


def events_active_at(
    events: Sequence[dict[str, Any]],
    t: float,
    display_s: float = 2.5,
) -> list[dict[str, Any]]:
    """Events whose banner should be visible at time t (seconds).

    The old renderer received every event but drew none of them, so per-shot
    feedback never appeared in the exported video.
    """
    active = []
    for e in events:
        ts = e.get("timestamp")
        if isinstance(ts, (int, float)) and ts <= t < ts + display_s:
            active.append(e)
    return active


def snap_to_peak(
    series: Sequence[tuple[float, float]],
    t_center: float,
    half_window_s: float = 0.75,
    mode: str = "max",
) -> float:
    """Refine an LLM event timestamp to the kinematic peak nearby.

    `series` is (time_s, value), e.g. wrist height or wrist speed. Returns
    the time of the max (or min) inside [t_center-w, t_center+w], or
    `t_center` unchanged when the window has no samples. LLM timestamps from
    sparse frames are typically +/-1 s off; the release is a peak.
    """
    window = [(t, v) for t, v in series if abs(t - t_center) <= half_window_s and v is not None]
    if not window:
        return t_center
    pick = max if mode == "max" else min
    return pick(window, key=lambda tv: tv[1])[0]