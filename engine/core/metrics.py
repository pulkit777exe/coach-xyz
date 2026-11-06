"""Sport-specific performance numbers derived from the pose track.

Criteria (see `measure.py`) answer "is this joint inside the target range".
Key metrics answer "how fast, how high and how balanced was the athlete".
They are shown on the rendered video and summarised per session, and they are
all normalised by the athlete's torso length so camera distance does not change
the reading.

The metric names live in the sport packs (`key_metrics`), so adding a new one
means adding a JSON entry and a function in `DERIVED` - not touching the
pipeline.
"""

import math

import numpy as np

from . import geometry as g, measure, motion
from .sports import MetricDef, Pack
from .track import Track

WINDOW_S = 0.7
PRE_S = 1.2


def _xy(lm: np.ndarray, idx: int, w: int, h: int) -> tuple[float, float] | None:
    if not np.isfinite(lm[idx, :2]).all() or lm[idx, 3] < g.MIN_VISIBILITY:
        return None
    return float(lm[idx, 0] * w), float(lm[idx, 1] * h)


def _mid(lm: np.ndarray, a: int, b: int, w: int, h: int) -> tuple[float, float] | None:
    pa, pb = _xy(lm, a, w, h), _xy(lm, b, w, h)
    if pa is None or pb is None:
        return None
    return (pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2


def _window(track: Track, i: int, before: float, after: float) -> np.ndarray:
    return np.flatnonzero((track.t >= track.t[i] - before) & (track.t <= track.t[i] + after))


def _mean_y(track: Track, idx: int, i: int, before: float, after: float) -> float | None:
    vals = []
    for j in _window(track, i, before, after):
        p = _xy(track.lm[j], idx, track.width, track.height)
        if p is not None:
            vals.append(p[1])
    return float(np.median(vals)) if vals else None


def wrist_above_shoulder(track: Track, i: int, side: str) -> float | None:
    """How far the active wrist is above its shoulder, in torso lengths."""
    right = side == "right"
    wrist = g.R_WRIST if right else g.L_WRIST
    shoulder = g.R_SHOULDER if right else g.L_SHOULDER
    lm = track.lm[i]
    w, h = track.width, track.height
    pw, ps = _xy(lm, wrist, w, h), _xy(lm, shoulder, w, h)
    if pw is None or ps is None:
        return None
    torso = motion.torso_px(track)
    return (ps[1] - pw[1]) / torso


def hip_rise(track: Track, i: int, side: str) -> float | None:
    """Peak hip lift over the pre-action baseline, in torso lengths."""
    torso = motion.torso_px(track)
    baseline = []
    for j in _window(track, i, PRE_S, 0.1):
        hip = _mid(track.lm[j], g.L_HIP, g.R_HIP, track.width, track.height)
        if hip is not None:
            baseline.append(hip[1])
    peak = []
    for j in _window(track, i, 0.05, 0.5):
        hip = _mid(track.lm[j], g.L_HIP, g.R_HIP, track.width, track.height)
        if hip is not None:
            peak.append(hip[1])
    if not baseline or not peak:
        return None
    return (float(np.median(baseline)) - min(peak)) / torso


def _line_angle(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))


def shoulder_hip_angle(track: Track, i: int, side: str) -> float | None:
    """Rotation between the shoulder line and the hip line (0 = square)."""
    lm, w, h = track.lm[i], track.width, track.height
    sl, sr = _xy(lm, g.L_SHOULDER, w, h), _xy(lm, g.R_SHOULDER, w, h)
    hl, hr = _xy(lm, g.L_HIP, w, h), _xy(lm, g.R_HIP, w, h)
    if sl is None or sr is None or hl is None or hr is None:
        return None
    diff = abs(_line_angle(sl, sr) - _line_angle(hl, hr)) % 180.0
    return min(diff, 180.0 - diff)


def stance_width(track: Track, i: int, side: str) -> float | None:
    """Distance between the ankles in torso lengths."""
    lm, w, h = track.lm[i], track.width, track.height
    left, right = _xy(lm, g.L_ANKLE, w, h), _xy(lm, g.R_ANKLE, w, h)
    if left is None or right is None:
        return None
    return math.hypot(left[0] - right[0], left[1] - right[1]) / motion.torso_px(track)


def head_movement(track: Track, i: int, side: str) -> float | None:
    """Nose travel through the action window, in torso lengths (lower = stiller)."""
    pts = []
    for j in _window(track, i, 0.25, 0.35):
        p = _xy(track.lm[j], g.NOSE, track.width, track.height)
        if p is not None:
            pts.append(p)
    if len(pts) < 2:
        return None
    arr = np.asarray(pts)
    return float(np.linalg.norm(arr - np.median(arr, axis=0), axis=1).mean()) / motion.torso_px(track)


def trunk_lean(track: Track, i: int, side: str) -> float | None:
    found = g.trunk_lean(track.lm[i], track.width, track.height)
    return found[0] if found else None


def action_speed(track: Track, i: int, side: str) -> float | None:
    idx = g.R_WRIST if side == "right" else g.L_WRIST
    return motion.peak_speed(track, idx, i, WINDOW_S)


def kick_speed(track: Track, i: int, side: str) -> float | None:
    idx = g.R_ANKLE if side == "right" else g.L_ANKLE
    return motion.peak_speed(track, idx, i, WINDOW_S)


# Derived metric name -> function(track, sample index, active side).
DERIVED = {
    "wrist_above_shoulder": wrist_above_shoulder,
    "hip_rise": hip_rise,
    "shoulder_hip_angle": shoulder_hip_angle,
    "stance_width": stance_width,
    "head_movement": head_movement,
    "trunk_lean": trunk_lean,
    "wrist_speed_peak": action_speed,
    "ankle_speed_peak": kick_speed,
}


def derive(name: str, track: Track, i: int, side: str) -> float | None:
    fn = DERIVED.get(name)
    if fn is None:
        return None
    try:
        value = fn(track, i, side)
    except (IndexError, ValueError):
        return None
    return None if value is None or not np.isfinite(value) else float(value)


def event_metrics(track: Track, i: int, side: str, pack: Pack) -> list[dict]:
    """The sport's key numbers at one event, ready for the result and the video."""
    rows = []
    for d in pack.key_metrics:
        value = derive(d.metric, track, i, side)
        row = {"key": d.key, "label": d.label, "metric": d.metric, "unit": d.unit,
               "value": round(value, 1) if value is not None else None,
               "ideal": list(d.ideal) if d.ideal else None,
               "score": None, "note": "not visible"}
        if value is not None:
            if d.ideal is not None:
                row["score"], row["note"] = measure.score_value(value, d)
                row["score"] = None if row["score"] is None else round(row["score"], 2)
            else:
                row["note"] = "measured"
        rows.append(row)
    return rows


def _best(values: list[float], d: MetricDef) -> tuple[float, float]:
    """Best and worst value, using the target range when the metric has one."""
    if d.ideal is None:
        return max(values), min(values)

    def score(v: float) -> float:
        found, _ = measure.score_value(v, d)
        return found if found is not None else 0.0

    ordered = sorted(values, key=score)
    return ordered[-1], ordered[0]


def session_metrics(track: Track, events: list[dict], pack: Pack) -> list[dict]:
    """Per-session aggregate of the sport's key metrics plus tempo and coverage."""
    grouped: dict[str, list[float]] = {}
    for event in events:
        for row in event.get("metrics") or []:
            if row.get("value") is not None:
                grouped.setdefault(row["key"], []).append(float(row["value"]))

    rows = []
    for d in pack.key_metrics:
        values = grouped.get(d.key, [])
        if not values:
            continue
        best, worst = _best(values, d)
        rows.append({
            "key": d.key, "label": d.label, "unit": d.unit, "kind": "metric", "n": len(values),
            "value": round(float(np.mean(values)), 1), "best": round(best, 1), "worst": round(worst, 1),
            "source": "measured",
            "ideal": list(d.ideal) if d.ideal else None,
            "acceptable": list(d.acceptable) if d.acceptable else None,
        })

    times = sorted(float(e["t"]) for e in events)
    if len(times) >= 2:
        gaps = np.diff(times)
        rows.append({"key": "tempo", "label": "Tempo", "unit": "s", "kind": "session", "n": len(gaps),
                     "source": "counted",
                     "value": round(float(np.mean(gaps)), 1), "best": round(float(np.min(gaps)), 1),
                     "worst": round(float(np.max(gaps)), 1)})
    duration = float(track.t[-1] - track.t[0]) if len(track.t) else 0.0
    if duration > 0:
        rows.append({"key": "events_per_min", "label": "Action rate", "unit": "/min", "kind": "session",
                     "n": len(times), "source": "counted",
                     "value": round(len(times) / duration * 60, 1), "best": None, "worst": None})
    rows.append({"key": "tracking_coverage", "label": "Pose coverage", "unit": "%", "kind": "session",
                 "n": len(track.t), "source": "measured",
                 "value": round(track.coverage * 100, 1), "best": None, "worst": None})
    return rows


def matchup_metrics(events: list[dict], pack: Pack) -> list[dict]:
    """How the action player and the nearest opponent related across the session."""
    blocks = [e.get("matchup") for e in events if e.get("matchup")]
    if not blocks:
        return []
    distances = [b["separation"]["distance"] for b in blocks
                 if b.get("separation") and b["separation"].get("distance") is not None]
    if not distances:
        return []
    return [{"key": "opponent_distance", "label": f"{pack.opponent_role} distance",
             "unit": "torso", "kind": "matchup", "n": len(distances),
             "value": round(float(np.mean(distances)), 1),
             "best": round(float(np.min(distances)), 1),
             "worst": round(float(np.max(distances)), 1)}]

