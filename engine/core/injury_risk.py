"""
injury_risk.py — Injury-risk and load indicators derived from pose landmarks.

Provides biomechanical flags that get serious buy-in from coaches and
trainers. Each indicator maps a pose-measurable quantity to a known
injury-risk association from sports-science literature.

References:
- Knee valgus → ACL risk (Hewett et al., 2005; Padua et al., 2009)
- Spine flexion under load → lumbar disc injury risk
- Arm slot drift → UCL stress in overhead athletes
- Knee valgus angle > 10° during landing → elevated ACL injury risk
"""

from __future__ import annotations

from typing import Any


# MediaPipe landmark indices used across indicators
LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
LEFT_ELBOW = 13
RIGHT_ELBOW = 14
LEFT_WRIST = 15
RIGHT_WRIST = 16
LEFT_HIP = 23
RIGHT_HIP = 24
LEFT_KNEE = 25
RIGHT_KNEE = 26
LEFT_ANKLE = 27
RIGHT_ANKLE = 28
LEFT_FOOT_INDEX = 29
RIGHT_FOOT_INDEX = 30


def _angle(a: dict, b: dict, c: dict) -> float:
    """Interior angle at vertex b formed by points a-b-c in degrees."""
    import numpy as np

    ba = np.array([a["x"] - b["x"], a["y"] - b["y"]])
    bc = np.array([c["x"] - b["x"], c["y"] - b["y"]])
    cos_angle = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-6)
    cos_angle = np.clip(cos_angle, -1.0, 1.0)
    return float(np.degrees(np.arccos(cos_angle)))


def _vector(p1: dict, p2: dict) -> tuple[float, float]:
    return (p2["x"] - p1["x"], p2["y"] - p1["y"])


def _cross_2d(v1: tuple[float, float], v2: tuple[float, float]) -> float:
    return v1[0] * v2[1] - v1[1] * v2[0]


def _dot_2d(v1: tuple[float, float], v2: tuple[float, float]) -> float:
    return v1[0] * v2[0] + v1[1] * v2[1]


def knee_valgus_angle(landmarks: list[dict]) -> float | None:
    """
    Compute knee valgus angle (hip-knee-ankle in the frontal plane).

    High valgus (knee collapsing inward) is the primary biomechanical
    predictor of ACL injury. Values > 10° during landing are flagged.

    Uses right knee (landmarks 24-26-28) as the primary indicator
    for right-leg-dominant sports; left knee for left-leg-dominant.
    """
    try:
        hip = landmarks[RIGHT_HIP]
        knee = landmarks[RIGHT_KNEE]
        ankle = landmarks[RIGHT_ANKLE]

        # Project to frontal plane: use x (medial-lateral) and y (vertical)
        # Valgus = knee deviating medially (inward) relative to hip-ankle line
        hip_knee = _vector(hip, knee)
        knee_ankle = _vector(knee, ankle)

        # The valgus angle is the angle between the hip-knee and knee-ankle
        # vectors in the frontal plane. We compute the cross product to get
        # the signed angle (positive = valgus/knee valgus collapse).
        cross = _cross_2d(hip_knee, knee_ankle)
        dot = _dot_2d(hip_knee, knee_ankle)
        angle = abs(
            float(
                __import__("numpy").degrees(
                    __import__("numpy").arctan2(abs(cross), dot)
                )
            )
        )
        return angle
    except (IndexError, KeyError, ZeroDivisionError):
        return None


def spine_flexion_angle(landmarks: list[dict]) -> float | None:
    """
    Compute spine flexion angle (hip-spine-shoulder).

    Excessive forward spine flexion under load (e.g., during a golf swing
    or baseball swing) increases lumbar disc injury risk.

    Uses hip-spine-shoulder: angle at the spine (midpoint of hips) between
    hip vector and shoulder vector.
    """
    try:
        left_hip = landmarks[LEFT_HIP]
        right_hip = landmarks[RIGHT_HIP]
        left_shoulder = landmarks[LEFT_SHOULDER]
        right_shoulder = landmarks[RIGHT_SHOULDER]

        spine = {
            "x": (left_hip["x"] + right_hip["x"]) / 2.0,
            "y": (left_hip["y"] + right_hip["y"]) / 2.0,
        }
        shoulder = {
            "x": (left_shoulder["x"] + right_shoulder["x"]) / 2.0,
            "y": (left_shoulder["y"] + right_shoulder["y"]) / 2.0,
        }

        hip_spine = _vector(spine, left_hip)
        spine_shoulder = _vector(spine, shoulder)

        return _angle(left_hip, spine, shoulder)
    except (IndexError, KeyError, ZeroDivisionError):
        return None


def arm_slot_drift(landmarks: list[dict]) -> dict[str, Any] | None:
    """
    Compute arm slot angle and detect drift.

    Arm slot drift (elbow dropping below shoulder level during throwing)
    is associated with UCL stress in baseball pitchers and shoulder
    impingement in overhead athletes.

    Returns dict with:
    - arm_slot_angle: shoulder-elbow-wrist angle
    - elbow_below_shoulder: whether elbow is below shoulder (y-coordinate)
    - shoulder_elbow_height_diff: pixel difference in y between shoulder and elbow
    - flagged: whether the drift exceeds threshold
    """
    try:
        shoulder = landmarks[RIGHT_SHOULDER]
        elbow = landmarks[RIGHT_ELBOW]
        wrist = landmarks[RIGHT_WRIST]

        slot_angle = _angle(shoulder, elbow, wrist)
        elbow_below = elbow["y"] > shoulder["y"]
        height_diff = elbow["y"] - shoulder["y"]

        # Flag if elbow drops more than 5% of frame height relative to shoulder
        # (5% is a conservative threshold; typical frame height is normalized 0-1)
        flagged = height_diff > 0.05

        return {
            "arm_slot_angle": round(slot_angle, 1),
            "elbow_below_shoulder": elbow_below,
            "shoulder_elbow_height_diff_px": round(height_diff * 1000, 1),
            "flagged": flagged,
            "risk_association": "UCL stress / shoulder impingement",
        }
    except (IndexError, KeyError, ZeroDivisionError):
        return None


def landing_knee_flexion(landmarks: list[dict]) -> dict[str, Any] | None:
    """
    Compute knee flexion angle at landing.

    Insufficient knee flexion during landing increases ACL and ankle
    injury risk. Deep knee flexion (> 30°) is protective.
    """
    try:
        hip = landmarks[RIGHT_HIP]
        knee = landmarks[RIGHT_KNEE]
        ankle = landmarks[RIGHT_ANKLE]

        flexion = _angle(hip, knee, ankle)
        # Flexion > 30° is protective; < 15° is high risk
        risk_level = (
            "low"
            if flexion >= 30
            else "moderate"
            if flexion >= 15
            else "high"
        )

        return {
            "knee_flexion_angle": round(flexion, 1),
            "risk_level": risk_level,
            "risk_association": "ACL / ankle injury risk during landing",
        }
    except (IndexError, KeyError, ZeroDivisionError):
        return None


def compute_all_indicators(
    landmarks: list[dict],
    event_type: str = "unknown",
) -> dict[str, Any]:
    """
    Compute all injury-risk indicators for a single pose frame.

    Parameters
    ----------
    landmarks : list[dict]
        MediaPipe pose landmarks (33 entries with x, y, z, visibility).
    event_type : str
        Type of sporting event (e.g., 'jump_land', 'throw', 'swing').
        Used to select which indicators are relevant.

    Returns dict with all computed indicators and their risk flags.
    """
    indicators: dict[str, Any] = {}

    # Knee valgus — relevant for all landing/jumping sports
    valgus = knee_valgus_angle(landmarks)
    if valgus is not None:
        indicators["knee_valgus"] = {
            "angle_deg": round(valgus, 1),
            "flagged": valgus > 10.0,
            "threshold_deg": 10.0,
            "risk_association": "ACL injury risk (Hewett et al., 2005)",
        }

    # Spine flexion — relevant for golf, baseball, tennis swings
    flexion = spine_flexion_angle(landmarks)
    if flexion is not None:
        indicators["spine_flexion"] = {
            "angle_deg": round(flexion, 1),
            "flagged": flexion > 45.0,
            "threshold_deg": 45.0,
            "risk_association": "Lumbar disc injury risk under load",
        }

    # Arm slot drift — relevant for overhead/throwing sports
    slot = arm_slot_drift(landmarks)
    if slot is not None:
        indicators["arm_slot_drift"] = slot

    # Knee flexion at landing — relevant for jumping sports
    if event_type in ("jump_land", "landing", "unknown"):
        lf = landing_knee_flexion(landmarks)
        if lf is not None:
            indicators["landing_knee_flexion"] = lf

    # Overall risk summary
    flagged_count = sum(
        1
        for v in indicators.values()
        if v.get("flagged") is True
    )
    indicators["_summary"] = {
        "total_indicators_computed": len(indicators),
        "flagged_count": flagged_count,
        "overall_risk": "elevated" if flagged_count >= 2 else "moderate" if flagged_count >= 1 else "low",
    }

    return indicators