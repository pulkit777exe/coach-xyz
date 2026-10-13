"""Angle-math unification: tracking joints cross detection_utils.landmark_angle."""

import pytest

from core.detection_utils import landmark_angle
from core.tracking import compute_joint_angles


def _landmarks():
    pts = [{"x": 0.0, "y": 0.0} for _ in range(33)]
    # Right angle at 27 (left ankle): (25)->(27) along +x, (27)->(29) along +y.
    pts[25] = {"x": 1.0, "y": 0.0}
    pts[27] = {"x": 0.0, "y": 0.0}
    pts[29] = {"x": 0.0, "y": 1.0}
    # 45 degrees at 11 (left shoulder).
    pts[11] = {"x": 1.0, "y": 0.0}
    pts[13] = {"x": 0.0, "y": 0.0}
    pts[15] = {"x": 1.0, "y": 1.0}
    return pts


class TestJointAngles:
    def test_known_geometries(self):
        joints = compute_joint_angles(_landmarks())
        assert joints["left_knee_ankle_angle"] == pytest.approx(90.0)
        assert joints["left_shoulder_elbow_angle"] == pytest.approx(45.0)

    def test_matches_landmark_angle_per_joint(self):
        pts = _landmarks()
        joints = compute_joint_angles(pts)
        assert joints["left_knee_ankle_angle"] == pytest.approx(
            landmark_angle(pts[25], pts[27], pts[29])
        )
        assert joints["right_ankle_foot_angle"] == pytest.approx(
            landmark_angle(pts[28], pts[30], pts[32])
        )

    def test_short_input_is_empty(self):
        assert compute_joint_angles([]) == {}
        assert compute_joint_angles([{"x": 0.0, "y": 0.0}] * 10) == {}
