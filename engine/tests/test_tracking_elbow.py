"""Elbow extension is an *extension*, not a fold.

Every sport pack scores `elbow_extension_angle_deg` against an ideal range of
[140, 175] (baseball hand_path), [150, 170] (cricket, hockey) or [160, 175]
(basketball elbow_alignment, the highest-weighted criterion in that pack). Those
ranges only make sense for 180° = a straight arm.

The computation used to difference the two bone *directions*:

    abs(arctan2(elbow->wrist) - arctan2(shoulder->elbow))

For a straight arm those two vectors point the same way, so the difference is
0 — the exact complement of what is being scored. A player with a textbook
release measured 0.0°, fell outside the acceptable range, and was handed the
rationale "Needs work on Elbow alignment: Outside acceptable range (ideal:
160-175°, measured: 0.0°)". Differencing arctan2 results is additionally wrong
across the ±pi branch cut, reporting ~335° where the true value is ~17°.

These tests pin the convention against synthetic poses with a known answer, so
a future "simplification" back to a direction difference fails here rather than
in a coach's feedback.
"""

from __future__ import annotations

import math

import pytest

from core.tracking import _compute_elbow_extension


def _pose(shoulder: tuple[float, float], elbow: tuple[float, float], wrist: tuple[float, float]) -> list[dict]:
    """A 17-landmark pose carrying only the three indices the metric reads."""
    landmarks: list[dict] = [{"x": 0.0, "y": 0.0, "visibility": 0.0} for _ in range(33)]
    landmarks[11] = {"x": shoulder[0], "y": shoulder[1], "visibility": 1.0}
    landmarks[13] = {"x": elbow[0], "y": elbow[1], "visibility": 1.0}
    landmarks[15] = {"x": wrist[0], "y": wrist[1], "visibility": 1.0}
    return landmarks


def _extension_at_bend(extension: float) -> float:
    """Build an arm with the given interior angle at the elbow; return the metric.

    `bend_deg` is the extension the metric is supposed to report: 180 is a
    straight arm (wrist on the far side of the elbow from the shoulder), 0 is
    fully doubled back (wrist on top of the shoulder).
    """
    shoulder = (0.0, 0.0)
    elbow = (1.0, 0.0)
    # E->S points at 180°; put E->W at 180° - bend so the interior angle is bend.
    theta = math.radians(180.0 - extension)
    wrist = (elbow[0] + math.cos(theta), elbow[1] + math.sin(theta))
    return _compute_elbow_extension(_pose(shoulder, elbow, wrist))


class TestElbowExtensionConvention:
    def test_a_straight_arm_measures_180(self) -> None:
        # Shoulder, elbow and wrist collinear with the elbow between them.
        assert _extension_at_bend(180.0) == pytest.approx(180.0, abs=1e-3)

    def test_a_ninety_degree_bend_measures_ninety(self) -> None:
        assert _extension_at_bend(90.0) == pytest.approx(90.0, abs=1e-3)

    def test_a_fully_folded_arm_measures_zero(self) -> None:
        # Wrist doubled back onto the shoulder: the arm is folded, not extended.
        assert _extension_at_bend(0.0) == pytest.approx(0.0, abs=1e-3)

    def test_extension_decreases_monotonically_as_the_arm_folds(self) -> None:
        # The old implementation increased as the arm folded, which is the
        # inversion in one assertion.
        readings = [_extension_at_bend(e) for e in (180.0, 150.0, 120.0, 90.0, 60.0, 30.0, 0.0)]
        assert readings == sorted(readings, reverse=True), readings

    def test_a_shooting_form_lands_inside_the_basketball_ideal_range(self) -> None:
        # The regression that mattered: basketball scores elbow_alignment against
        # ideal [160, 175] with weight 0.20, the highest in the pack.
        for extension in (160.0, 165.0, 170.0, 175.0):
            measured = _extension_at_bend(extension)
            assert 160.0 <= measured <= 175.0, (
                f"a {extension}° extension measured {measured:.1f}°, outside basketball's "
                f"ideal [160, 175] — the sign of this metric has been inverted again"
            )

    @pytest.mark.parametrize("extension", [0.0, 1.0, 7.5, 22.0, 45.0, 88.0, 135.0, 179.0, 180.0])
    def test_extension_is_always_in_range(self, extension: float) -> None:
        # The old direction-difference form could emit 335° for a nearly-straight
        # arm crossing the arctan2 branch cut, which no pack's range can accept.
        measured = _extension_at_bend(extension)
        assert 0.0 <= measured <= 180.0

    def test_no_branch_cut_discontinuity(self) -> None:
        # Walk a straight arm through a full rotation. Every orientation of the
        # same straight arm must read 180°; a direction difference jumps to ~360°
        # at the seam.
        for degrees in range(0, 360, 5):
            theta = math.radians(degrees)
            landmarks = _pose(
                (0.0, 0.0),
                (math.cos(theta), math.sin(theta)),
                (2 * math.cos(theta), 2 * math.sin(theta)),
            )
            assert _compute_elbow_extension(landmarks) == pytest.approx(180.0, abs=1e-3), (
                f"straight arm rotated to {degrees}° read "
                f"{_compute_elbow_extension(landmarks):.1f}°"
            )

    def test_a_zero_length_bone_is_nan_rather_than_a_number(self) -> None:
        # shoulder == elbow collapses a vector, so the angle is undefined. The
        # caller omits the key entirely, which is more honest than the sibling
        # compute_joint_angles, whose `+ 1e-6` denominator guard turns this into
        # a real-looking number biased by ~0.08°.
        landmarks = _pose((1.0, 1.0), (1.0, 1.0), (2.0, 1.0))
        assert math.isnan(_compute_elbow_extension(landmarks))

    def test_a_missing_landmark_yields_nan_rather_than_an_exception(self) -> None:
        short = [{"x": 0.0, "y": 0.0} for _ in range(10)]
        assert math.isnan(_compute_elbow_extension(short))
