"""core/geometry.py — aspect-correct, visibility-aware pose geometry.

Replaces the angle math scattered across tracking.py / injury_risk.py /
gemini_client.py. Fixes three systemic problems in the old code:

1. Normalized MediaPipe coordinates (x in [0,1] of width, y in [0,1] of
   height) were used directly as if square. On 16:9 video every angle was
   skewed. Everything here converts to pixel space first.
2. Several landmark triplets were wrong (wrist "finger extension" used
   pinky/index, "ankle" used heel/foot-index in the wrong order, foot index
   constants were off by two). Indices below follow the MediaPipe Pose map.
3. A joint was reported even when its landmarks were barely visible.
   Every measurement now returns a confidence = min visibility of the
   landmarks it used, and low-visibility joints are omitted.

Pure functions, no I/O, no cv2/mediapipe import: unit-testable anywhere.
"""

from __future__ import annotations

import math
from typing import Any, Iterable, Sequence

Landmark = dict[str, float]


class LM:
    """MediaPipe Pose landmark indices (33-point model)."""

    NOSE = 0
    L_SHOULDER, R_SHOULDER = 11, 12
    L_ELBOW, R_ELBOW = 13, 14
    L_WRIST, R_WRIST = 15, 16
    L_PINKY, R_PINKY = 17, 18
    L_INDEX, R_INDEX = 19, 20
    L_THUMB, R_THUMB = 21, 22
    L_HIP, R_HIP = 23, 24
    L_KNEE, R_KNEE = 25, 26
    L_ANKLE, R_ANKLE = 27, 28
    L_HEEL, R_HEEL = 29, 30
    L_FOOT, R_FOOT = 31, 32


# name -> (a, vertex, c). Angle is the interior angle at the vertex, in
# degrees: 180 = fully straight limb, smaller = more bent.
JOINT_DEFS: dict[str, tuple[int, int, int]] = {
    "left_elbow_angle": (LM.L_SHOULDER, LM.L_ELBOW, LM.L_WRIST),
    "right_elbow_angle": (LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST),
    "left_shoulder_angle": (LM.L_ELBOW, LM.L_SHOULDER, LM.L_HIP),
    "right_shoulder_angle": (LM.R_ELBOW, LM.R_SHOULDER, LM.R_HIP),
    "left_hip_angle": (LM.L_SHOULDER, LM.L_HIP, LM.L_KNEE),
    "right_hip_angle": (LM.R_SHOULDER, LM.R_HIP, LM.R_KNEE),
    "left_knee_angle": (LM.L_HIP, LM.L_KNEE, LM.L_ANKLE),
    "right_knee_angle": (LM.R_HIP, LM.R_KNEE, LM.R_ANKLE),
    "left_ankle_angle": (LM.L_KNEE, LM.L_ANKLE, LM.L_FOOT),
    "right_ankle_angle": (LM.R_KNEE, LM.R_ANKLE, LM.R_FOOT),
}

# Legacy key -> new key, ONLY where the old triplet was anatomically right.
# Lets sports/*.json `metric` strings keep resolving. Old keys whose triplet
# was wrong (torso_lean_*, *_wrist_finger_ext, *_ankle_foot_angle,
# *_knee_ankle_angle) are intentionally NOT aliased: audit any sport pack
# that references them.
LEGACY_ALIASES: dict[str, str] = {
    "left_shoulder_elbow_angle": "left_elbow_angle",
    "right_shoulder_elbow_angle": "right_elbow_angle",
    "left_hip_knee_angle": "left_knee_angle",
    "right_hip_knee_angle": "right_knee_angle",
}


def _vis(lm: Landmark) -> float:
    try:
        return float(lm.get("visibility", 1.0))
    except (TypeError, ValueError):
        return 0.0


def _px(lm: Landmark, w: int, h: int) -> tuple[float, float]:
    return float(lm["x"]) * w, float(lm["y"]) * h


def angle_at(a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]) -> float | None:
    """Interior angle at b (degrees, 0..180) for points in PIXEL space."""
    v1 = (a[0] - b[0], a[1] - b[1])
    v2 = (c[0] - b[0], c[1] - b[1])
    n1, n2 = math.hypot(*v1), math.hypot(*v2)
    if n1 < 1e-6 or n2 < 1e-6:
        return None
    cos = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))
    return math.degrees(math.acos(cos))


def joint_angle(
    landmarks: Sequence[Landmark],
    name: str,
    frame_w: int,
    frame_h: int,
    min_visibility: float = 0.3,
) -> tuple[float, float] | None:
    """(angle_deg, confidence) for a named joint, or None if unusable."""
    name = LEGACY_ALIASES.get(name, name)
    triplet = JOINT_DEFS.get(name)
    if triplet is None or len(landmarks) <= max(triplet):
        return None
    pts = [landmarks[i] for i in triplet]
    conf = min(_vis(p) for p in pts)
    if conf < min_visibility:
        return None
    ang = angle_at(*(_px(p, frame_w, frame_h) for p in pts))
    return None if ang is None else (ang, conf)


def compute_joint_angles(
    landmarks: Sequence[Landmark],
    frame_w: int,
    frame_h: int,
    min_visibility: float = 0.3,
) -> dict[str, float]:
    """All reliably-visible joint angles (+ legacy alias keys), rounded."""
    out: dict[str, float] = {}
    for name in JOINT_DEFS:
        res = joint_angle(landmarks, name, frame_w, frame_h, min_visibility)
        if res is not None:
            out[name] = round(res[0], 1)
    trunk = trunk_lean_deg(landmarks, frame_w, frame_h, min_visibility)
    if trunk is not None:
        out["trunk_lean_deg"] = round(trunk[0], 1)
    for legacy, new in LEGACY_ALIASES.items():
        if new in out:
            out[legacy] = out[new]
    return out


def joint_confidence(landmarks: Sequence[Landmark], name: str) -> float:
    """Confidence (min visibility of the landmarks the joint uses)."""
    name = LEGACY_ALIASES.get(name, name)
    triplet = JOINT_DEFS.get(name)
    if triplet is None or len(landmarks) <= max(triplet):
        return 0.0
    return round(min(_vis(landmarks[i]) for i in triplet), 2)


def _mid(a: Landmark, b: Landmark, w: int, h: int) -> tuple[float, float]:
    ax, ay = _px(a, w, h)
    bx, by = _px(b, w, h)
    return (ax + bx) / 2.0, (ay + by) / 2.0


def trunk_lean_deg(
    landmarks: Sequence[Landmark],
    frame_w: int,
    frame_h: int,
    min_visibility: float = 0.3,
) -> tuple[float, float] | None:
    """Trunk inclination from vertical: 0 = upright, 90 = horizontal.

    The old `spine_flexion_angle` measured the angle between the hip LINE and
    the torso, which is ~90 degrees for anyone standing upright, so its >45
    flag fired on nearly every frame.
    """
    pts = [landmarks[i] for i in (LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP) if i < len(landmarks)]
    if len(pts) < 4:
        return None
    conf = min(_vis(p) for p in pts)
    if conf < min_visibility:
        return None
    sx, sy = _mid(landmarks[LM.L_SHOULDER], landmarks[LM.R_SHOULDER], frame_w, frame_h)
    hx, hy = _mid(landmarks[LM.L_HIP], landmarks[LM.R_HIP], frame_w, frame_h)
    dx, dy = sx - hx, hy - sy  # y grows downward: dy > 0 when shoulders are above hips
    if math.hypot(dx, dy) < 1e-6:
        return None
    lean = math.degrees(math.atan2(abs(dx), dy)) if dy > 0 else 90.0
    return lean, conf


def knee_flexion_deg(
    landmarks: Sequence[Landmark],
    side: str,
    frame_w: int,
    frame_h: int,
    min_visibility: float = 0.3,
) -> tuple[float, float] | None:
    """Flexion = 180 - interior angle (0 = straight leg, larger = deeper bend).

    The old landing check compared the INTERIOR angle to 30/15 degrees, so a
    straight leg (~175) was always "low risk" and the check could never fire.
    """
    res = joint_angle(landmarks, f"{side}_knee_angle", frame_w, frame_h, min_visibility)
    return None if res is None else (180.0 - res[0], res[1])


def frontal_knee_offset_ratio(
    landmarks: Sequence[Landmark],
    side: str,
    frame_w: int,
    frame_h: int,
    min_visibility: float = 0.3,
) -> tuple[float, float] | None:
    """Knee deviation from the hip-ankle line as a fraction of leg length.

    Positive = knee displaced toward the body midline (valgus-like).
    ONLY meaningful from a front/back camera; from a side view the old
    cross-product "valgus" was simply sagittal knee flexion. Callers must
    gate on the recorded camera angle.
    """
    hip_i, knee_i, ank_i = (
        (LM.L_HIP, LM.L_KNEE, LM.L_ANKLE) if side == "left" else (LM.R_HIP, LM.R_KNEE, LM.R_ANKLE)
    )
    if len(landmarks) <= LM.R_FOOT:
        return None
    hip, knee, ank = landmarks[hip_i], landmarks[knee_i], landmarks[ank_i]
    conf = min(_vis(hip), _vis(knee), _vis(ank))
    if conf < min_visibility:
        return None
    hx, hy = _px(hip, frame_w, frame_h)
    kx, ky = _px(knee, frame_w, frame_h)
    ax, ay = _px(ank, frame_w, frame_h)
    leg = math.hypot(ax - hx, ay - hy)
    if leg < 1e-6 or abs(ay - hy) < 1e-6:
        return None
    line_x = hx + (ky - hy) * (ax - hx) / (ay - hy)
    mid_x, _ = _mid(landmarks[LM.L_HIP], landmarks[LM.R_HIP], frame_w, frame_h)
    inward = 1.0 if mid_x >= hx else -1.0
    return ((kx - line_x) * inward) / leg, conf


def pick_shooting_side(
    tracks: Iterable[dict[str, Any]],
    frame_h: int,
) -> str:
    """Which arm is the active/shooting arm: the wrist that rises highest
    above its own shoulder across the window. Defaults to "right".

    The old elbow metric hard-coded the LEFT arm (landmarks 11/13/15).
    """
    best = {"left": 0.0, "right": 0.0}
    for t in tracks:
        lms = t.get("landmarks") or []
        if len(lms) <= LM.R_WRIST:
            continue
        for side, s_i, w_i in (("left", LM.L_SHOULDER, LM.L_WRIST), ("right", LM.R_SHOULDER, LM.R_WRIST)):
            if min(_vis(lms[s_i]), _vis(lms[w_i])) < 0.3:
                continue
            rise = (lms[s_i]["y"] - lms[w_i]["y"]) * frame_h
            best[side] = max(best[side], rise)
    if best["left"] > best["right"] * 1.1:
        return "left"
    return "right"


def elbow_extension_deg(
    landmarks: Sequence[Landmark],
    side: str,
    frame_w: int,
    frame_h: int,
) -> tuple[float, float] | None:
    """Elbow interior angle on the given side (180 = fully extended).

    NOTE: the old `elbow_extension_angle` was |dir(elbow->wrist) -
    dir(shoulder->elbow)|, i.e. the deviation from straight (0 = extended),
    with no wrap-around handling. If sports/*.json ranges were authored as
    interior angles, the old scores were inverted. Verify the pack.
    """
    return joint_angle(landmarks, f"{side}_elbow_angle", frame_w, frame_h)


def smooth_series(
    values: Sequence[float | None],
    alpha: float = 0.5,
) -> list[float | None]:
    """Causal-then-anticausal EMA (zero phase lag). None gaps stay None."""
    n = len(values)
    fwd: list[float | None] = [None] * n
    prev: float | None = None
    for i, v in enumerate(values):
        if v is None:
            prev = None
            continue
        prev = v if prev is None else alpha * v + (1 - alpha) * prev
        fwd[i] = prev
    out: list[float | None] = [None] * n
    prev = None
    for i in range(n - 1, -1, -1):
        v = fwd[i]
        if v is None:
            prev = None
            continue
        prev = v if prev is None else alpha * v + (1 - alpha) * prev
        out[i] = prev
    return out