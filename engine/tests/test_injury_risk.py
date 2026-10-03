"""core/injury_risk.py — the module that decides whether a movement is flagged
as a medical risk.

This is the only place in the engine that turns pose geometry into a
medical/safety verdict (`ACL injury risk`, `lumbar disc injury risk`,
`UCL stress`), and it ships into every analysis result via
`analyzer._compute_injury_risk` -> `event["injury_risk"]` (analyzer.py:290).
Until now no test had executed a single line of it.

## Two thresholds are inverted relative to the quantity they measure

`spine_flexion_angle` and `landing_knee_flexion` both read
`detection_utils.landmark_angle(...)`, which is an **interior** angle at the
vertex: 180 deg = straight, 0 deg = fully folded. Their docstrings and
thresholds are written in the opposite space ("excessive forward spine flexion
> 45 deg", "deep knee flexion > 30 deg is protective"), so the comparison runs
the wrong way:

- `landing_knee_flexion` — an **extended** leg measures 179.8 and is scored
  `risk_level: "low"`; a **fully folded** knee measures 2.0 and is scored
  `"high"`. Per the module's own docstring ("insufficient knee flexion during
  landing increases ACL and ankle injury risk, deep flexion is protective")
  that is backwards: the straight-leg landing is the high-risk one.
- `spine_flexion_angle` — the reading is exactly `90 - flexion_deg`, so an
  **upright, square** stance measures 90.0 and is flagged (`> 45.0`), while a
  torso **folded 90 deg forward** measures 0.7 and is NOT flagged. The gate
  selects the most neutral posture there is and passes the maximally flexed one.

Both are pinned below as *characterisation* tests, because the current
behaviour is what ships and a silent change would be worse than a documented
one. Each is paired with a `strict=True` xfail encoding the biomechanically
correct reading: when someone fixes the metric the xfail turns into XPASS and
**fails the suite**, forcing the characterisation assertions to be re-read
rather than quietly re-baselined.

Two further findings are pinned as behaviour rather than asserted away:
`knee_valgus_angle` takes `abs()` of the *whole* signed angle, so a medial
(valgus) and a lateral (varus) collapse are indistinguishable despite the
docstring's "positive = valgus"; and `landmark_angle`'s absolute `1e-6`
denominator guard plus a zero-length bone makes a collapsed pose report a
confident-looking number (`arm_slot_angle: 90.0` when shoulder == elbow)
instead of the `None` its sibling `_compute_elbow_extension` returns.
"""

from __future__ import annotations

import math

import pytest

from core.injury_risk import (
    LEFT_HIP,
    LEFT_KNEE,
    LEFT_SHOULDER,
    RIGHT_ANKLE,
    RIGHT_ELBOW,
    RIGHT_HIP,
    RIGHT_KNEE,
    RIGHT_SHOULDER,
    RIGHT_WRIST,
    arm_slot_drift,
    compute_all_indicators,
    knee_valgus_angle,
    landing_knee_flexion,
    spine_flexion_angle,
)

# ── Pose construction ────────────────────────────────────────────────────────


def _pose() -> list[dict]:
    """33-landmark pose, every point parked at (0.5, 0.5)."""
    return [{"x": 0.5, "y": 0.5, "z": 0.0, "visibility": 1.0} for _ in range(33)]


def _put(pose: list[dict], index: int, x: float, y: float) -> list[dict]:
    """Park one landmark at an exact coordinate (no coercion — `_put` is for
    building well-formed poses; the untyped-input tests write raw dicts)."""
    pose[index] = {"x": x, "y": y, "z": 0.0, "visibility": 1.0}
    return pose


def _straight_leg_pose() -> list[dict]:
    """Hip, knee and ankle on one vertical line (a locked-out knee)."""
    pose = _pose()
    _put(pose, RIGHT_HIP, 0.5, 0.5)
    _put(pose, RIGHT_KNEE, 0.5, 0.7)
    _put(pose, RIGHT_ANKLE, 0.5, 0.9)
    return pose


def _knee_pose(interior_deg: float) -> list[dict]:
    """Right leg whose interior knee angle measures exactly `interior_deg`.

    Thigh points straight up from the knee (hip 0.2 above it), so the ankle is
    placed on the ray that makes the required angle. Valid for 2..178; the
    ankle stays inside [0,1] because the thigh and shin are both short.
    """
    pose = _pose()
    knee = (0.5, 0.7)
    _put(pose, RIGHT_HIP, knee[0], knee[1] - 0.2)
    _put(pose, RIGHT_KNEE, *knee)
    # v1 = hip - knee points at -90 deg; rotate the shin so the interior angle
    # between (hip - knee) and (ankle - knee) is `interior_deg`.
    theta = math.radians(-90.0 + interior_deg)
    _put(pose, RIGHT_ANKLE, knee[0] + math.cos(theta), knee[1] + math.sin(theta))
    return pose


def _spine_pose(flexion_deg: float) -> list[dict]:
    """Torso rotated `flexion_deg` forward from vertical, hips level at y=0.6.

    flexion 0 -> upright square stance (shoulders directly above the hips).
    flexion 90 -> torso horizontal, shoulders level with the hips.
    """
    theta = math.radians(flexion_deg)
    pose = _pose()
    _put(pose, LEFT_HIP, 0.45, 0.6)
    _put(pose, RIGHT_HIP, 0.55, 0.6)
    cx, cy = 0.5, 0.6
    _put(pose, LEFT_SHOULDER, cx - 0.3 * math.sin(theta) - 0.05, cy - 0.3 * math.cos(theta))
    _put(pose, RIGHT_SHOULDER, cx - 0.3 * math.sin(theta) + 0.05, cy - 0.3 * math.cos(theta))
    return pose


def _slot_pose(elbow_drop: float) -> list[dict]:
    """Collinear right arm hanging down; `elbow_drop` is the elbow's drop below
    the shoulder in normalized units."""
    pose = _pose()
    _put(pose, RIGHT_SHOULDER, 0.5, 0.40)
    _put(pose, RIGHT_ELBOW, 0.5, 0.40 + elbow_drop)
    _put(pose, RIGHT_WRIST, 0.5, 0.40 + elbow_drop + 0.12)
    return pose


# ── knee_valgus_angle ────────────────────────────────────────────────────────


class TestKneeValgusAngle:
    def test_a_straight_leg_measures_zero(self):
        # hip->knee and knee->ankle point the same way, so cross == 0.
        assert knee_valgus_angle(_straight_leg_pose()) == pytest.approx(0.0, abs=1e-6)

    def test_a_collapsed_knee_measures_the_expected_angle(self):
        # hip x=0.60 -> knee x=0.50 -> ankle x=0.60: the knee tracks medially.
        pose = _pose()
        _put(pose, RIGHT_HIP, 0.60, 0.5)
        _put(pose, RIGHT_KNEE, 0.50, 0.7)
        _put(pose, RIGHT_ANKLE, 0.60, 0.9)
        # atan2(|cross|, dot) with cross=0.04, dot=0.03 -> 53.130102 deg
        assert knee_valgus_angle(pose) == pytest.approx(53.130102, abs=1e-4)

    def test_the_measurement_is_monotonic_in_how_far_the_knee_drifts(self):
        readings = []
        for drift in (0.00, 0.02, 0.05, 0.10, 0.20):
            pose = _pose()
            _put(pose, RIGHT_HIP, 0.5 + drift, 0.5)
            _put(pose, RIGHT_KNEE, 0.5, 0.7)
            _put(pose, RIGHT_ANKLE, 0.5 + drift, 0.9)
            readings.append(knee_valgus_angle(pose))
        assert readings == sorted(readings), readings

    @pytest.mark.parametrize("drift", [0.01, 0.05, 0.15, 0.30, 0.45])
    def test_every_reading_is_bounded(self, drift):
        pose = _pose()
        _put(pose, RIGHT_HIP, 0.5 + drift, 0.5)
        _put(pose, RIGHT_KNEE, 0.5, 0.7)
        _put(pose, RIGHT_ANKLE, 0.5 + drift, 0.9)
        assert 0.0 <= knee_valgus_angle(pose) <= 180.0

    def test_the_ten_degree_flag_boundary_is_inclusive_on_far(self):
        """`valgus > 10.0` — a pose sitting exactly on the threshold passes."""
        for drift, expect_flagged in ((0.0, False), (0.20, True)):
            indicator = compute_all_indicators(_valgus_pose(drift))["knee_valgus"]
            assert indicator["flagged"] is expect_flagged, drift

    def test_valgus_and_varus_are_indistinguishable(self):
        """CHARACTERISATION of a lost distinction, not a property to rely on.

        The docstring says "positive = valgus/knee valgus collapse", but `abs()`
        is taken of the *whole* signed angle (injury_risk.py:76-82), so the
        sign is destroyed. A knee collapsing medially and a knee collapsing
        laterally report the same number, and the payload cannot say which
        pattern was measured.
        """
        assert knee_valgus_angle(_valgus_pose(0.10)) == pytest.approx(
            knee_valgus_angle(_valgus_pose(-0.10)), abs=1e-9
        )

    @pytest.mark.parametrize(
        "landmarks",
        [
            [],                                        # IndexError
            [{"x": 1.0, "y": 1.0}],                     # IndexError (too short)
            [{"x": 1.0}, {}, {}],                       # KeyError on "y"
            [{"x": 1.0, "y": 1.0, "z": 0.0}, {}, {}],   # IndexError
        ],
    )
    def test_missing_or_malformed_landmarks_yield_none(self, landmarks):
        # None, not a number: the caller omits the indicator entirely, which is
        # more honest than publishing an angle it could not measure.
        assert knee_valgus_angle(landmarks) is None


def _valgus_pose(drift: float) -> list[dict]:
    """Right leg whose knee is displaced by `drift` (medially if negative)."""
    pose = _pose()
    _put(pose, RIGHT_HIP, 0.5 - drift, 0.5)
    _put(pose, RIGHT_KNEE, 0.5, 0.7)
    _put(pose, RIGHT_ANKLE, 0.5 - drift, 0.9)
    return pose


def _risk_pose(flexion_deg: float, ankle_extra: float, elbow_drop: float) -> list[dict]:
    """One pose driving all three boolean indicators, so the `_summary` ladder
    can be exercised by *count* rather than by arranging four joint angles by hand.

    Built in a single pass because the indicators share indices: the spine reads
    hips 23/24 and the valgus read starts at hip 24, so composing two helpers
    would silently move the spine's vertex.

    - `flexion_deg`  — forward torso rotation; flexion 60 puts the spine reading
      (90 - 60 = 30) under the 45 deg threshold.
    - `ankle_extra`  — lateral offset of the ankle off the hip-knee line.
      0.0 keeps hip/knee/ankle collinear (valgus 0); 0.1 puts it well past 10.
    - `elbow_drop`   — right-elbow drop below the shoulder; 0.08 is past 5%.
    """
    theta = math.radians(flexion_deg)
    pose = _pose()
    _put(pose, LEFT_HIP, 0.45, 0.6)
    _put(pose, RIGHT_HIP, 0.55, 0.6)
    _put(pose, LEFT_SHOULDER, 0.5 - 0.3 * math.sin(theta) - 0.05, 0.6 - 0.3 * math.cos(theta))
    _put(pose, RIGHT_SHOULDER, 0.5 - 0.3 * math.sin(theta) + 0.05, 0.6 - 0.3 * math.cos(theta))
    _put(pose, RIGHT_KNEE, 0.5, 0.7)
    _put(pose, RIGHT_ANKLE, 0.45 - ankle_extra, 0.8)
    # The arm hangs off the *same* right shoulder the spine indicator reads, so
    # the elbow and wrist are placed relative to wherever that landed.
    shoulder_y = pose[RIGHT_SHOULDER]["y"]
    shoulder_x = pose[RIGHT_SHOULDER]["x"]
    _put(pose, RIGHT_ELBOW, shoulder_x, shoulder_y + elbow_drop)
    _put(pose, RIGHT_WRIST, shoulder_x, shoulder_y + elbow_drop + 0.12)
    return pose


# ── spine_flexion_angle ──────────────────────────────────────────────────────


class TestSpineFlexionAngle:
    @pytest.mark.parametrize("flexion", [0.0, 15.0, 30.0, 45.0, 60.0, 80.0])
    def test_it_reports_ninety_minus_the_forward_flexion(self, flexion):
        """CHARACTERISATION: this is an interior angle, not a flexion amount.

        The number falls as the athlete bends over, which is the opposite of
        what the `> 45.0` gate downstream assumes.
        """
        assert spine_flexion_angle(_spine_pose(flexion)) == pytest.approx(
            90.0 - flexion, abs=0.05
        )

    def test_hyperextension_reads_above_ninety(self):
        assert spine_flexion_angle(_spine_pose(-30.0)) == pytest.approx(120.0, abs=0.05)

    def test_an_upright_athlete_is_reported_as_flexed(self):
        """The inverted gate, in isolation: 90.0 deg > 45.0 deg -> flagged."""
        result = compute_all_indicators(_spine_pose(0.0))["spine_flexion"]
        assert result["angle_deg"] == pytest.approx(90.0, abs=0.05)
        assert result["flagged"] is True
        assert result["risk_association"] == "Lumbar disc injury risk under load"

    def test_a_maximally_folded_athlete_is_not_reported_as_flexed(self):
        result = compute_all_indicators(_spine_pose(90.0))["spine_flexion"]
        assert result["angle_deg"] < 1.0
        assert result["flagged"] is False

    @pytest.mark.xfail(
        strict=True,
        reason="spine_flexion_angle returns the interior angle (90 deg = upright) "
        "but the flag compares it as a flexion amount. Fixing this will make the "
        "two characterisation tests above fail — re-read them, do not re-baseline.",
    )
    def test_the_reading_should_increase_as_the_spine_folds(self):
        upright = spine_flexion_angle(_spine_pose(0.0))
        folded = spine_flexion_angle(_spine_pose(90.0))
        assert upright < folded, (
            f"upright measured {upright:.1f} deg, folded measured {folded:.1f} deg"
        )

    def test_the_vertex_is_the_hip_midpoint_not_a_single_hip(self):
        # Narrowing the hips to a fifth of their width must not move the reading:
        # `spine` is the average of both hips (injury_risk.py:104-110), so the
        # direction from the vertex is unchanged. The tolerance is not zero
        # because `landmark_angle`'s absolute `+ 1e-6` denominator guard weighs
        # differently against a 0.01-long vector than a 0.05-long one: the
        # reading shifts by ~0.006 deg, which is the epsilon leaking scale.
        narrow = _spine_pose(20.0)
        _put(narrow, LEFT_HIP, 0.49, 0.6)
        _put(narrow, RIGHT_HIP, 0.51, 0.6)
        assert spine_flexion_angle(narrow) == pytest.approx(
            spine_flexion_angle(_spine_pose(20.0)), abs=0.01
        )

    @pytest.mark.parametrize("landmarks", [[], [{"x": 0.1, "y": 0.1}], [{}] * 23])
    def test_missing_landmarks_yield_none(self, landmarks):
        assert spine_flexion_angle(landmarks) is None


# ── arm_slot_drift ───────────────────────────────────────────────────────────


class TestArmSlotDrift:
    def test_a_straight_hanging_arm_is_near_180_and_unflagged(self):
        result = arm_slot_drift(_slot_pose(0.02))
        assert result["arm_slot_angle"] == pytest.approx(180.0, abs=2.0)
        assert result["elbow_below_shoulder"] is True
        assert result["shoulder_elbow_height_diff_px"] == pytest.approx(20.0)
        assert result["flagged"] is False

    def test_drift_below_five_percent_of_frame_height_is_not_flagged(self):
        result = arm_slot_drift(_slot_pose(0.04))
        assert result["elbow_below_shoulder"] is True
        assert result["shoulder_elbow_height_diff_px"] == pytest.approx(40.0)
        assert result["flagged"] is False

    def test_a_large_elbow_drop_is_flagged(self):
        result = arm_slot_drift(_slot_pose(0.08))
        assert result["shoulder_elbow_height_diff_px"] == pytest.approx(80.0)
        assert result["flagged"] is True

    def test_the_threshold_is_strictly_greater_than_five_percent(self):
        # `height_diff > 0.05` — a pose sitting exactly on the boundary must not
        # be flagged, which is what `>` and not `>=` buys.
        assert arm_slot_drift(_slot_pose(0.05))["flagged"] is False
        assert arm_slot_drift(_slot_pose(0.0501))["flagged"] is True

    def test_an_elbow_above_the_shoulder_is_never_flagged(self):
        pose = _pose()
        _put(pose, RIGHT_SHOULDER, 0.5, 0.60)
        _put(pose, RIGHT_ELBOW, 0.5, 0.40)
        _put(pose, RIGHT_WRIST, 0.5, 0.30)
        result = arm_slot_drift(pose)
        assert result["elbow_below_shoulder"] is False
        assert result["shoulder_elbow_height_diff_px"] == pytest.approx(-200.0)
        assert result["flagged"] is False

    def test_it_carries_the_risk_association_it_claims(self):
        assert (
            arm_slot_drift(_slot_pose(0.08))["risk_association"]
            == "UCL stress / shoulder impingement"
        )

    def test_a_collapsed_shoulder_elbow_pair_reports_a_confident_ninety(self):
        """CHARACTERISATION of a degenerate pose, not a property to rely on.

        Two landmarks at the same pixel give `landmark_angle` a zero-length
        vector; its `+ 1e-6` denominator guard (detection_utils.py:151) turns
        the undefined angle into a clean-looking 90.0. The sibling metric
        `_compute_elbow_extension` returns NaN for exactly this input
        (tracking.py:67-68), so the same collapsed pose yields "omit me" in one
        place and "90 degrees, UCL stress" in another.
        """
        result = arm_slot_drift(_slot_pose(0.0))
        assert result["arm_slot_angle"] == 90.0
        assert result["flagged"] is False

    def test_a_short_bone_is_biased_by_the_epsilon_guard(self):
        """CHARACTERISATION: the guard is an absolute 1e-6 against normalized
        coordinates, so a short bone reads visibly short of straight."""
        assert arm_slot_drift(_slot_pose(0.02))["arm_slot_angle"] == pytest.approx(180.0, abs=2.0)
        assert arm_slot_drift(_slot_pose(0.001))["arm_slot_angle"] == pytest.approx(172.6, abs=0.5)

    @pytest.mark.parametrize("landmarks", [[], [{"x": 1.0, "y": 1.0}] * 10, [{}] * 12])
    def test_missing_landmarks_yield_none(self, landmarks):
        assert arm_slot_drift(landmarks) is None


# ── landing_knee_flexion ─────────────────────────────────────────────────────


class TestLandingKneeFlexion:
    @pytest.mark.parametrize("interior", [2.0, 30.0, 60.0, 90.0, 120.0, 150.0, 178.0])
    def test_the_reported_angle_is_the_interior_knee_angle(self, interior):
        result = landing_knee_flexion(_knee_pose(interior))
        assert result["knee_flexion_angle"] == pytest.approx(interior, abs=0.2)

    @pytest.mark.xfail(
        strict=True,
        reason="landing_knee_flexion compares an interior knee angle against "
        "flexion-amount thresholds. A straight leg (179.8 deg) scores "
        "risk_level='low'; a folded knee (2.0 deg) scores 'high'. The module's "
        "own docstring states the opposite association.",
    )
    def test_an_extended_leg_is_the_high_risk_landing(self):
        assert landing_knee_flexion(_knee_pose(178.0))["risk_level"] == "high"
        assert landing_knee_flexion(_knee_pose(20.0))["risk_level"] == "low"

    def test_risk_bands_follow_the_interior_angle_scale(self):
        """CHARACTERISATION: >=30 low, >=15 moderate, else high — on the
        interior angle, i.e. the safest-looking postures get 'low'."""
        assert landing_knee_flexion(_knee_pose(178.0))["risk_level"] == "low"
        assert landing_knee_flexion(_knee_pose(40.0))["risk_level"] == "low"
        assert landing_knee_flexion(_knee_pose(20.0))["risk_level"] == "moderate"
        assert landing_knee_flexion(_knee_pose(5.0))["risk_level"] == "high"

    def test_the_band_edges_are_inclusive_on_the_lower_bound(self):
        assert landing_knee_flexion(_knee_pose(30.0))["risk_level"] == "low"
        assert landing_knee_flexion(_knee_pose(29.9))["risk_level"] == "moderate"
        assert landing_knee_flexion(_knee_pose(15.0))["risk_level"] == "moderate"
        assert landing_knee_flexion(_knee_pose(14.9))["risk_level"] == "high"

    def test_it_carries_its_risk_association(self):
        assert (
            landing_knee_flexion(_knee_pose(90.0))["risk_association"]
            == "ACL / ankle injury risk during landing"
        )

    def test_it_emits_no_flagged_key_so_the_summary_cannot_count_it(self):
        """CHARACTERISATION: `_summary` sums on `v.get("flagged") is True`.

        `landing_knee_flexion` reports `risk_level` and no `flagged`, so even a
        `"high"` reading contributes nothing to `flagged_count`. A payload can
        therefore read `overall_risk: "low"` while one indicator says `high`.
        """
        result = landing_knee_flexion(_knee_pose(5.0))
        assert result["risk_level"] == "high"
        assert "flagged" not in result

    @pytest.mark.parametrize("landmarks", [[], [{"x": 1.0, "y": 1.0}] * 10, [{}] * 24])
    def test_missing_landmarks_yield_none(self, landmarks):
        assert landing_knee_flexion(landmarks) is None


# ── compute_all_indicators ───────────────────────────────────────────────────


class TestComputeAllIndicators:
    def test_an_empty_pose_yields_only_a_summary(self):
        result = compute_all_indicators([])
        assert list(result) == ["_summary"]
        assert result["_summary"] == {
            "total_indicators_computed": 0,
            "flagged_count": 0,
            "overall_risk": "low",
        }

    @pytest.mark.parametrize("event_type", ["jump_land", "landing", "unknown"])
    def test_landing_flexion_is_computed_for_landing_and_unknown_events(self, event_type):
        assert "landing_knee_flexion" in compute_all_indicators(_knee_pose(90.0), event_type)

    @pytest.mark.parametrize("event_type", ["throw", "swing", "dribble", ""])
    def test_landing_flexion_is_skipped_for_other_event_types(self, event_type):
        assert "landing_knee_flexion" not in compute_all_indicators(
            _knee_pose(90.0), event_type
        )

    def test_the_event_type_defaults_to_unknown_so_landing_is_included(self):
        assert "landing_knee_flexion" in compute_all_indicators(_knee_pose(90.0))

    def test_the_summary_count_excludes_itself(self):
        result = compute_all_indicators(_knee_pose(90.0))
        assert result["_summary"]["total_indicators_computed"] == len(result) - 1

    @pytest.mark.parametrize(
        "flexion,valgus_drift,elbow_drop,expected_count,expected_risk",
        [
            (60.0, 0.00, 0.02, 0, "low"),        # nothing over threshold
            (60.0, 0.20, 0.02, 1, "moderate"),    # valgus only
            (60.0, 0.20, 0.08, 2, "elevated"),    # valgus + arm slot
            (0.0, 0.00, 0.02, 1, "moderate"),     # the inverted spine gate
        ],
    )
    def test_overall_risk_escalates_with_the_flagged_count(
        self, flexion, valgus_drift, elbow_drop, expected_count, expected_risk
    ):
        result = compute_all_indicators(
            _risk_pose(flexion, valgus_drift, elbow_drop), "landing"
        )
        assert result["_summary"]["flagged_count"] == expected_count
        assert result["_summary"]["overall_risk"] == expected_risk

    def test_the_flagged_count_is_read_off_the_published_indicators(self):
        result = compute_all_indicators(_spine_pose(0.0))
        counted = sum(
            1 for k, v in result.items() if k != "_summary" and v.get("flagged") is True
        )
        assert result["_summary"]["flagged_count"] == counted

    def test_a_published_threshold_matches_the_flag(self):
        result = compute_all_indicators(_valgus_pose(0.2))
        indicator = result["knee_valgus"]
        assert indicator["flagged"] == (indicator["angle_deg"] > indicator["threshold_deg"])
        assert result["spine_flexion"]["flagged"] == (
            result["spine_flexion"]["angle_deg"] > result["spine_flexion"]["threshold_deg"]
        )

    def test_each_published_indicator_carries_its_association(self):
        result = compute_all_indicators(_knee_pose(90.0))
        assert result["knee_valgus"]["threshold_deg"] == 10.0
        assert "Hewett" in result["knee_valgus"]["risk_association"]
        assert result["spine_flexion"]["threshold_deg"] == 45.0
        assert "Lumbar" in result["spine_flexion"]["risk_association"]

    def test_a_partially_measured_pose_publishes_only_what_it_has(self):
        # Only the right leg is present: the leg indicators answer, nothing raises.
        partial = _straight_leg_pose()
        result = compute_all_indicators(partial, "landing")
        assert "knee_valgus" in result
        assert "landing_knee_flexion" in result
        assert "arm_slot_drift" in result          # right arm is still readable
        assert "_summary" in result

    def test_all_four_indicators_appear_for_a_fully_specified_landing_pose(self):
        pose = _knee_pose(90.0)
        _put(pose, LEFT_HIP, 0.45, 0.60)
        _put(pose, LEFT_SHOULDER, 0.45, 0.30)
        _put(pose, RIGHT_SHOULDER, 0.55, 0.30)
        _put(pose, RIGHT_ELBOW, 0.55, 0.38)
        _put(pose, RIGHT_WRIST, 0.55, 0.50)
        result = compute_all_indicators(pose, "jump_land")
        for key in ("knee_valgus", "spine_flexion", "arm_slot_drift", "landing_knee_flexion"):
            assert key in result, key


# ── Untyped input: where the except clauses stop ─────────────────────────────


class TestUntypedLandmarkInput:
    """`except (IndexError, KeyError, ZeroDivisionError)` is narrower than what
    an upstream pose payload can contain.

    A landmark list reaches here from MediaPipe, and nothing upstream
    guarantees the numbers are numbers — this repo has already been bitten by
    exactly that (`int("8.5")` raising inside the render loop after the Gemini
    call had been paid for). These tests pin where the guard does not reach: the
    exception escapes as a TypeError through
    `analyzer._compute_injury_risk` and fails the whole analysis job.
    """

    @pytest.mark.parametrize(
        "fn,bad_index",
        [
            (knee_valgus_angle, RIGHT_ANKLE),
            (landing_knee_flexion, RIGHT_ANKLE),
            (arm_slot_drift, RIGHT_WRIST),
            (spine_flexion_angle, LEFT_HIP),
        ],
    )
    def test_a_string_coordinate_escapes_the_guard(self, fn, bad_index):
        pose = _knee_pose(90.0)
        _put(pose, LEFT_SHOULDER, 0.45, 0.30)
        pose[bad_index] = {"x": "0.5", "y": 0.9, "z": 0.0, "visibility": 1.0}
        with pytest.raises(TypeError):
            fn(pose)

    @pytest.mark.parametrize(
        "fn",
        [knee_valgus_angle, spine_flexion_angle, arm_slot_drift, landing_knee_flexion],
    )
    def test_a_none_pose_escapes_the_guard(self, fn):
        with pytest.raises(TypeError):
            fn(None)

    @pytest.mark.parametrize(
        "fn,bad_index",
        [
            (knee_valgus_angle, RIGHT_HIP),
            (landing_knee_flexion, RIGHT_KNEE),
            (arm_slot_drift, RIGHT_ELBOW),
            (spine_flexion_angle, RIGHT_HIP),
        ],
    )
    def test_a_none_landmark_entry_escapes_the_guard(self, fn, bad_index):
        pose = _knee_pose(90.0)
        _put(pose, LEFT_SHOULDER, 0.45, 0.30)
        _put(pose, RIGHT_ELBOW, 0.5, 0.4)
        _put(pose, RIGHT_WRIST, 0.5, 0.5)
        pose[bad_index] = None
        with pytest.raises(TypeError):
            fn(pose)

    def test_compute_all_indicators_propagates_it_rather_than_degrading(self):
        pose = _knee_pose(90.0)
        pose[RIGHT_ANKLE] = {"x": "0.5", "y": 0.9, "z": 0.0, "visibility": 1.0}
        with pytest.raises(TypeError):
            compute_all_indicators(pose)


# ── Module surface ───────────────────────────────────────────────────────────


class TestLandmarkIndices:
    def test_indices_match_the_media_pipe_pose_landmark_map(self):
        """Four indicators read these; a typo would silently measure a different
        joint and would not raise. LEFT_KNEE is declared but currently unread —
        the module is right-side-only for the leg indicators."""
        assert (LEFT_SHOULDER, RIGHT_SHOULDER) == (11, 12)
        assert (LEFT_HIP, RIGHT_HIP) == (23, 24)
        assert (LEFT_KNEE, RIGHT_KNEE) == (25, 26)
        assert (RIGHT_ELBOW, RIGHT_WRIST) == (14, 16)

    def test_the_summary_counts_only_strictly_true_flags(self):
        # `v.get("flagged") is True` — a truthy non-True would not be counted.
        result = compute_all_indicators(_knee_pose(90.0))
        counted = sum(
            1 for k, v in result.items() if k != "_summary" and v.get("flagged") is True
        )
        assert counted == result["_summary"]["flagged_count"]
