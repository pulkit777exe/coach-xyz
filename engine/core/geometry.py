"""Joint angles from pose landmarks.

Landmarks are MediaPipe's 33-point rows of (x, y, z, visibility), with x and y
normalized to the frame. Angles are always computed in pixel space: normalized
coordinates stretch with the aspect ratio and give wrong angles on 16:9 video.
"""

import math

import numpy as np

NOSE = 0
L_SHOULDER, R_SHOULDER = 11, 12
L_ELBOW, R_ELBOW = 13, 14
L_WRIST, R_WRIST = 15, 16
L_HIP, R_HIP = 23, 24
L_KNEE, R_KNEE = 25, 26
L_ANKLE, R_ANKLE = 27, 28
L_FOOT, R_FOOT = 31, 32

# name -> (point, vertex, point). The angle is measured at the vertex:
# 180 is a straight limb, smaller is more bent.
JOINTS = {
    "left_elbow_angle": (L_SHOULDER, L_ELBOW, L_WRIST),
    "right_elbow_angle": (R_SHOULDER, R_ELBOW, R_WRIST),
    "left_shoulder_angle": (L_ELBOW, L_SHOULDER, L_HIP),
    "right_shoulder_angle": (R_ELBOW, R_SHOULDER, R_HIP),
    "left_hip_angle": (L_SHOULDER, L_HIP, L_KNEE),
    "right_hip_angle": (R_SHOULDER, R_HIP, R_KNEE),
    "left_knee_angle": (L_HIP, L_KNEE, L_ANKLE),
    "right_knee_angle": (R_HIP, R_KNEE, R_ANKLE),
    "left_ankle_angle": (L_KNEE, L_ANKLE, L_FOOT),
    "right_ankle_angle": (R_KNEE, R_ANKLE, R_FOOT),
}

# Names used by older sport packs.
ALIASES = {
    "elbow_extension_angle_deg": "elbow_angle",
    "elbow_extension_angle": "elbow_angle",
    "trunk_lean": "trunk_lean_deg",
    "left_shoulder_elbow_angle": "left_elbow_angle",
    "right_shoulder_elbow_angle": "right_elbow_angle",
    "left_hip_knee_angle": "left_knee_angle",
    "right_hip_knee_angle": "right_knee_angle",
}

MIN_VISIBILITY = 0.4


def angle_at(a, b, c) -> float | None:
    v1 = (a[0] - b[0], a[1] - b[1])
    v2 = (c[0] - b[0], c[1] - b[1])
    n1, n2 = math.hypot(*v1), math.hypot(*v2)
    if n1 < 1e-6 or n2 < 1e-6:
        return None
    cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)
    return math.degrees(math.acos(max(-1.0, min(1.0, cos))))


def _joint(lm: np.ndarray, name: str, w: int, h: int) -> tuple[float, float] | None:
    ids = JOINTS[name]
    conf = float(min(lm[i, 3] for i in ids))
    if not conf >= MIN_VISIBILITY:
        return None
    pts = [(lm[i, 0] * w, lm[i, 1] * h) for i in ids]
    ang = angle_at(*pts)
    return None if ang is None else (ang, conf)


def trunk_lean(lm: np.ndarray, w: int, h: int) -> tuple[float, float] | None:
    """Trunk tilt from vertical in degrees: 0 upright, 90 horizontal."""
    ids = (L_SHOULDER, R_SHOULDER, L_HIP, R_HIP)
    conf = float(min(lm[i, 3] for i in ids))
    if not conf >= MIN_VISIBILITY:
        return None
    sx = (lm[L_SHOULDER, 0] + lm[R_SHOULDER, 0]) / 2 * w
    sy = (lm[L_SHOULDER, 1] + lm[R_SHOULDER, 1]) / 2 * h
    hx = (lm[L_HIP, 0] + lm[R_HIP, 0]) / 2 * w
    hy = (lm[L_HIP, 1] + lm[R_HIP, 1]) / 2 * h
    rise = hy - sy  # image y grows downward, so shoulders above hips gives a positive rise
    if abs(sx - hx) + abs(rise) < 1e-6:
        return None
    return (math.degrees(math.atan2(abs(sx - hx), rise)) if rise > 0 else 90.0), conf


def metric(name: str, lm: np.ndarray, w: int, h: int, side: str = "right") -> tuple[float, float] | None:
    """Value and confidence of a pack metric on one frame, or None when it can't be seen.

    Side-less names resolve like this: elbow and shoulder use the active arm,
    `active_knee_angle` the active leg, knee/hip/ankle the mean of both sides.
    """
    name = ALIASES.get(name, name)
    if name == "trunk_lean_deg":
        return trunk_lean(lm, w, h)
    if name in ("elbow_angle", "shoulder_angle"):
        name = f"{side}_{name}"
    elif name == "active_knee_angle":
        name = f"{side}_knee_angle"
    elif name in ("knee_angle", "hip_angle", "ankle_angle"):
        found = [r for r in (_joint(lm, f"{s}_{name}", w, h) for s in ("left", "right")) if r]
        if not found:
            return None
        return float(np.mean([r[0] for r in found])), float(np.mean([r[1] for r in found]))
    return _joint(lm, name, w, h) if name in JOINTS else None


def anchor(name: str, side: str = "right") -> int | None:
    """Landmark where a metric's value is drawn on screen."""
    name = ALIASES.get(name, name)
    right = side == "right"
    table = {
        "elbow_angle": R_ELBOW if right else L_ELBOW,
        "shoulder_angle": R_SHOULDER if right else L_SHOULDER,
        "active_knee_angle": R_KNEE if right else L_KNEE,
        "knee_angle": R_KNEE if right else L_KNEE,
        "hip_angle": R_HIP if right else L_HIP,
        "ankle_angle": R_ANKLE if right else L_ANKLE,
        "trunk_lean_deg": R_HIP if right else L_HIP,
    }
    if name in table:
        return table[name]
    if name in JOINTS:
        return JOINTS[name][1]
    return None


def torso_length(lm: np.ndarray, w: int, h: int) -> float:
    """Shoulder-midpoint to hip-midpoint distance in pixels (the athlete's own ruler)."""
    sx = (lm[L_SHOULDER, 0] + lm[R_SHOULDER, 0]) / 2 * w
    sy = (lm[L_SHOULDER, 1] + lm[R_SHOULDER, 1]) / 2 * h
    hx = (lm[L_HIP, 0] + lm[R_HIP, 0]) / 2 * w
    hy = (lm[L_HIP, 1] + lm[R_HIP, 1]) / 2 * h
    return math.hypot(sx - hx, sy - hy)


def classify_angle(lm: np.ndarray, w: int, h: int) -> str | None:
    """Lightweight camera-angle tag: which way the athlete's torso runs in frame.

    "front" when the torso axis is forward-dominated (athlete facing the camera),
    "side" when it is lateral-dominated (athlete's side to the camera). Returns
    None when the skeleton is too ambiguous to tag confidently, so callers fall
    back to the coach's label.
    """
    pts = {}
    for name, ids in (
        ("shoulder", (L_SHOULDER, R_SHOULDER)),
        ("hip", (L_HIP, R_HIP)),
    ):
        conf = float(min(lm[i, 3] for i in ids))
        if not conf >= MIN_VISIBILITY:
            return None
        pts[name] = ((lm[ids[0], 0] + lm[ids[1], 0]) / 2 * w, (lm[ids[0], 1] + lm[ids[1], 1]) / 2 * h)
    lateral = abs(pts["shoulder"][0] - pts["hip"][0])
    forward = abs(pts["shoulder"][1] - pts["hip"][1])
    if lateral < 1e-6 and forward < 1e-6:
        return None
    axis = math.degrees(math.atan2(lateral, forward))
    if axis < 45:
        return "front"
    if axis > 45:
        return "side"
    return None
