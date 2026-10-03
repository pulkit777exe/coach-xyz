"""core/detection_utils.py — the shared detection primitives.

Every player-detection path in the engine funnels through this module:
`detector._detect_pose_candidates` and `tracking.detect_pose_candidates` both
import the HOG proposal step, the crop->frame landmark transform and the bbox
helper from here, and `iou` decides which boxes are *the same athlete*. Nothing
here had a direct test, so the three modules above it were only ever exercised
through whatever their other imports happened to reach.

The branches that decide an answer, not the happy path:
  - `detect_hog_people`: the frame clamp (HOG returns x/y/w/h, so the corner is
    `x + w`), the `min_weight` filter and its inclusive boundary, and the
    `i < len(weights)` fallback.
  - `bbox_from_landmarks`: the two *different* landmark-selection rules
    (explicit indices ignore visibility; `None` filters by it), the
    `filtered or landmarks` fallback, the asymmetric padding that adds head room
    to the top only, and the frame clamp.
  - `landmark_angle`: the `1e-6` denominator guard, which biases the extremes and
    turns a collapsed joint into a plausible-looking number.

Two defects are pinned as characterisation rather than asserted away; both are
described at their test.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

import core.detection_utils as du
from core.detection_utils import (
    ALL_LANDMARK_INDICES,
    BODY_LANDMARK_INDICES,
    PoseCandidate,
    bbox_from_landmarks,
    detect_hog_people,
    iou,
    landmark_angle,
    transform_landmarks_to_global,
)


def _pose(n: int = 33, vis: float = 1.0) -> list[dict]:
    return [{"x": 0.5, "y": 0.5, "visibility": vis} for _ in range(n)]


def _put(pose: list[dict], i: int, x: float, y: float, vis: float = 1.0) -> list[dict]:
    pose[i] = {"x": x, "y": y, "visibility": vis}
    return pose


# ── iou ──────────────────────────────────────────────────────────────────────


class TestIou:
    def test_identical_boxes_are_one(self):
        assert iou((0, 0, 10, 10), (0, 0, 10, 10)) == pytest.approx(1.0)

    def test_disjoint_boxes_are_zero(self):
        assert iou((0, 0, 10, 10), (50, 50, 60, 60)) == 0.0

    def test_touching_boxes_are_zero_not_negative(self):
        # `max(0, ...)` on both axes: a shared edge is not an intersection.
        assert iou((0, 0, 10, 10), (10, 0, 20, 10)) == 0.0
        assert iou((0, 0, 10, 10), (0, 10, 10, 20)) == 0.0

    def test_a_half_overlap_is_one_third(self):
        # intersection 50, union 100 + 100 - 50 = 150
        assert iou((0, 0, 10, 10), (5, 0, 15, 10)) == pytest.approx(50 / 150)

    def test_containment_is_the_intersection_over_the_larger_area(self):
        assert iou((0, 0, 10, 10), (2, 2, 4, 4)) == pytest.approx(4 / 100)

    def test_a_degenerate_zero_area_box_does_not_divide_by_zero(self):
        # area clamps to 1 and the union clamps to 1.0, so a collapsed box
        # yields a number instead of ZeroDivisionError.
        assert 0.0 <= iou((5, 5, 5, 5), (0, 0, 10, 10)) <= 1.0
        assert iou((5, 5, 5, 5), (5, 5, 5, 5)) == pytest.approx(0.0)

    def test_an_inverted_box_does_not_raise(self):
        # `x1 > x2` can come out of `bbox_from_landmarks` (see
        # TestBboxFromLandmarks::test_a_landmark_at_the_far_corner_inverts_the_box),
        # and `iou` is what compares those boxes during dedup.
        assert 0.0 <= iou((100, 80, 99, 79), (10, 10, 50, 50)) <= 1.0

    def test_iou_is_symmetric(self):
        a, b = (0, 0, 30, 40), (10, 10, 50, 60)
        assert iou(a, b) == pytest.approx(iou(b, a))


# ── landmark_angle ───────────────────────────────────────────────────────────


class TestLandmarkAngle:
    def test_a_straight_line_is_near_180(self):
        a, b, c = {"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0}, {"x": 2.0, "y": 0.0}
        assert landmark_angle(a, b, c) == pytest.approx(180.0, abs=0.1)

    def test_a_right_angle_measures_ninety(self):
        a, b, c = {"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0}, {"x": 1.0, "y": 1.0}
        assert landmark_angle(a, b, c) == pytest.approx(90.0, abs=0.01)

    def test_a_doubled_back_line_is_near_zero(self):
        a, b, c = {"x": 2.0, "y": 0.0}, {"x": 1.0, "y": 0.0}, {"x": 2.0, "y": 0.0}
        assert landmark_angle(a, b, c) == pytest.approx(0.0, abs=0.1)

    def test_the_epsilon_biades_both_extremes_inward(self):
        """CHARACTERISATION: `+ 1e-6` on the denominator (line 151).

        The guard keeps the division alive but is an absolute constant, so it
        weighs differently against short and long bones. Straight measures
        179.919 deg and fully-folded 0.081 deg — a symmetric 0.081 deg bias. The
        same epsilon is called out in tests/test_tracking_elbow.py:110-112 for
        `compute_joint_angles`, where the sibling `_compute_elbow_extension`
        returns NaN instead.
        """
        assert landmark_angle({"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0}, {"x": 2.0, "y": 0.0}) == pytest.approx(179.9190, abs=1e-3)
        assert landmark_angle({"x": 2.0, "y": 0.0}, {"x": 1.0, "y": 0.0}, {"x": 2.0, "y": 0.0}) == pytest.approx(0.0810, abs=1e-3)

    def test_it_is_an_interior_angle_with_no_branch_cut(self):
        """180 = straight, which is the convention `tracking._compute_elbow_extension`
        was rewritten to match, and it is what a sport pack scoring an ideal
        range like [160, 175] expects. Rotating the whole figure must not move
        the reading, which a direction-difference form cannot promise."""
        base = landmark_angle({"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0}, {"x": 2.0, "y": 0.0})
        for degrees in range(0, 360, 15):
            theta = math.radians(degrees)
            rotated = landmark_angle(
                {"x": 0.0, "y": 0.0},
                {"x": math.cos(theta), "y": math.sin(theta)},
                {"x": 2 * math.cos(theta), "y": 2 * math.sin(theta)},
            )
            assert rotated == pytest.approx(base, abs=0.2), degrees

    def test_arms_of_unequal_length_give_the_same_angle(self):
        a, b = {"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0}
        near = {"x": 1.0, "y": 0.5}
        far = {"x": 1.0, "y": 9.0}
        assert landmark_angle(a, b, near) == pytest.approx(landmark_angle(a, b, far), abs=0.1)

    def test_a_collapsed_vertex_returns_a_number_rather_than_nan(self):
        """CHARACTERISATION of the degenerate pose.

        Two landmarks on the same pixel make the interior angle undefined. The
        guard keeps the division alive and `np.clip` pins the result, so the
        caller receives a confident `0.0` / `90.0` / `180.0` for a joint it
        cannot measure. `tracking._compute_elbow_extension` returns NaN for the
        identical input (tracking.py:67-68), so the two producers of a joint
        angle in this repo disagree about what "unmeasurable" looks like.
        """
        value = landmark_angle({"x": 1.0, "y": 1.0}, {"x": 1.0, "y": 1.0}, {"x": 2.0, "y": 1.0})
        assert not math.isnan(value)
        assert value in (0.0, 90.0, 180.0)

    def test_the_result_is_always_a_plain_float_in_range(self):
        value = landmark_angle({"x": 0.3, "y": 0.7}, {"x": 0.4, "y": 0.2}, {"x": 0.9, "y": 0.1})
        assert isinstance(value, float)
        assert 0.0 <= value <= 180.0


# ── detect_hog_people ────────────────────────────────────────────────────────


def _fake_hog(monkeypatch, boxes, weights):
    """Replace the module-level HOG descriptor with one that returns fixed data.

    `boxes` are (x, y, w, h) — the shape OpenCV's detectMultiScale actually
    returns, which the module converts to a corner.
    """

    class _Desc:
        def detectMultiScale(self, frame, winStride, padding, scale):  # noqa: N803
            self.seen = (frame.shape, winStride, padding, scale)
            return (
                np.array(boxes, dtype=np.int32).reshape(-1, 4),
                np.array(weights),
            )

    monkeypatch.setattr(du, "_HOG_DESCRIPTOR", _Desc())


def _frame(h: int = 240, w: int = 320) -> np.ndarray:
    return np.zeros((h, w, 3), dtype=np.uint8)


class TestDetectHogPeople:
    def test_a_confident_detection_is_returned_as_a_corner_box(self, monkeypatch):
        # HOG gives (x, y, w, h) = (10, 20, 30, 60) -> corner (40, 80).
        _fake_hog(monkeypatch, [(10, 20, 30, 60)], [0.8])
        result = detect_hog_people(_frame())
        assert len(result) == 1
        (box, weight), = result
        assert box == (10, 20, 40, 80)
        assert weight == pytest.approx(0.8)

    def test_a_weak_detection_is_filtered_out(self, monkeypatch):
        _fake_hog(monkeypatch, [(0, 0, 40, 80)], [0.29])
        assert detect_hog_people(_frame()) == []

    def test_the_min_weight_boundary_is_inclusive(self, monkeypatch):
        _fake_hog(monkeypatch, [(0, 0, 40, 80)], [0.3])
        assert len(detect_hog_people(_frame())) == 1
        _fake_hog(monkeypatch, [(0, 0, 40, 80)], [0.29999])
        assert detect_hog_people(_frame()) == []

    def test_a_raising_the_threshold_removes_everything(self, monkeypatch):
        _fake_hog(monkeypatch, [(0, 0, 40, 80)], [0.5])
        assert detect_hog_people(_frame(), min_weight=0.51) == []

    def test_an_overhanging_box_is_clamped_to_the_frame(self, monkeypatch):
        """The corner is `x + w` / `y + h`, clamped to `w-1` / `h-1` so a
        downstream `frame[y1:y2, x1:x2]` slice stays inside the array instead of
        silently returning a short crop."""
        _fake_hog(monkeypatch, [(300, 200, 100, 100)], [0.9])
        (box, _), = detect_hog_people(_frame(h=240, w=320))
        assert box == (300, 200, 319, 239)

    def test_a_missing_weight_falls_back_to_a_default_confidence(self, monkeypatch):
        """Defensive branch: `i < len(weights)`. OpenCV returns one weight per
        box, so this cannot happen today — pinned so a future change cannot start
        publishing a fabricated 0.6 for a real detection."""
        _fake_hog(monkeypatch, [(10, 10, 20, 20)], [])
        (box, weight), = detect_hog_people(_frame())
        assert box == (10, 10, 30, 30)
        assert weight == pytest.approx(0.6)

    def test_no_detections_returns_an_empty_list(self, monkeypatch):
        _fake_hog(monkeypatch, [], [])
        assert detect_hog_people(_frame()) == []

    def test_every_surviving_detection_is_returned_in_order(self, monkeypatch):
        _fake_hog(monkeypatch, [(0, 0, 20, 40), (100, 0, 20, 40), (200, 0, 20, 40)], [0.9, 0.1, 0.4])
        results = detect_hog_people(_frame())
        assert [r[0][0] for r in results] == [0, 200]
        assert [r[1] for r in results] == pytest.approx([0.9, 0.4])

    def test_float_boxes_are_truncated_to_ints(self, monkeypatch):
        _fake_hog(monkeypatch, [(10.7, 20.2, 30.9, 60.4)], [0.8])
        (box, _), = detect_hog_people(_frame())
        assert all(isinstance(v, int) for v in box)
        assert box == (10, 20, 40, 80)   # truncated by the int32 cast, then x + w

    def test_the_parameters_sent_to_opencv_are_the_documented_ones(self, monkeypatch):
        _fake_hog(monkeypatch, [], [])
        detect_hog_people(_frame())
        assert du._HOG_DESCRIPTOR.seen[1:] == ((8, 8), (8, 8), 1.05)

    def test_it_reads_the_frame_shape_from_the_array_not_the_capture(self, monkeypatch):
        _fake_hog(monkeypatch, [], [])
        detect_hog_people(_frame(h=100, w=400))
        assert du._HOG_DESCRIPTOR.seen[0] == (100, 400, 3)


# ── transform_landmarks_to_global ────────────────────────────────────────────


class TestTransformLandmarksToGlobal:
    def test_a_crop_local_landmark_is_mapped_into_frame_coordinates(self):
        local = [{"x": 0.0, "y": 0.0, "visibility": 1.0}]
        result = transform_landmarks_to_global(local, 50, 100, 80, 160, 400, 320)
        assert result == [{"x": 0.125, "y": 0.3125, "visibility": 1.0}]

    def test_the_crop_origin_is_included_not_just_the_scale(self):
        (out,) = transform_landmarks_to_global(
            [{"x": 1.0, "y": 1.0, "visibility": 1.0}], 100, 200, 100, 100, 400, 400
        )
        assert out["x"] == pytest.approx(200 / 400)
        assert out["y"] == pytest.approx(300 / 400)

    def test_visibility_defaults_to_zero_when_absent(self):
        (out,) = transform_landmarks_to_global(
            [{"x": 0.5, "y": 0.5}], 0, 0, 10, 10, 100, 100
        )
        assert out["visibility"] == 0.0

    def test_the_z_coordinate_is_dropped(self):
        """Only x/y/visibility survive, so a consumer cannot mistake a
        crop-local z for a frame-global one."""
        (out,) = transform_landmarks_to_global(
            [{"x": 0.5, "y": 0.5, "z": -0.2, "visibility": 0.7}], 0, 0, 10, 10, 100, 100
        )
        assert set(out) == {"x", "y", "visibility"}

    def test_an_empty_list_stays_empty(self):
        assert transform_landmarks_to_global([], 0, 0, 10, 10, 100, 100) == []

    def test_every_landmark_is_transformed(self):
        local = [{"x": i / 10.0, "y": i / 10.0, "visibility": 1.0} for i in range(10)]
        result = transform_landmarks_to_global(local, 0, 0, 100, 100, 100, 100)
        assert len(result) == 10
        assert [r["x"] for r in result] == pytest.approx([i / 10.0 for i in range(10)])


# ── bbox_from_landmarks ──────────────────────────────────────────────────────


class TestBboxFromLandmarks:
    def test_the_box_spans_the_landmarks(self):
        pose = _put(_pose(), 0, 0.2, 0.3)
        _put(pose, 1, 0.8, 0.7)
        assert bbox_from_landmarks(pose, 100, 100, landmark_indices=[0, 1]) == (20, 30, 80, 70)

    def test_explicit_indices_ignore_visibility(self):
        """The two selection rules differ: an explicit index list is taken as
        given, so a caller asking for shoulder/hip indices gets them even at
        zero visibility. `tracking.detect_pose_candidates` relies on this for its
        tight body box; a change to honour visibility here would silently shrink
        every tracking box to the fallback.
        """
        pose = _pose(vis=0.0)
        _put(pose, 0, 0.1, 0.1, vis=0.0)
        _put(pose, 1, 0.9, 0.9, vis=0.0)
        assert bbox_from_landmarks(pose, 100, 100, landmark_indices=[0, 1]) == (10, 10, 90, 90)

    def test_without_indices_landmarks_below_the_threshold_are_dropped(self):
        pose = _put(_pose(), 0, 0.05, 0.05, vis=0.9)      # visible, would stretch the box
        _put(pose, 1, 0.95, 0.95, vis=0.2)                # low visibility, filtered out
        for i in range(2, 33):
            _put(pose, i, 0.5, 0.5, vis=0.9)
        box = bbox_from_landmarks(pose, 100, 100, min_visibility=0.4)
        assert box[0] == 5 and box[2] == 50

    def test_the_visibility_comparison_is_strictly_greater_than(self):
        pose = _put(_pose(3, vis=0.4), 0, 0.10, 0.10, vis=0.4)
        _put(pose, 1, 0.90, 0.90, vis=0.4)
        _put(pose, 2, 0.50, 0.50, vis=0.4)
        # Everything sits exactly at the threshold, so all three are dropped and
        # the `filtered or landmarks` fallback spans them anyway.
        assert bbox_from_landmarks(pose, 100, 100, min_visibility=0.4) == (10, 10, 90, 90)

    def test_when_everything_is_filtered_it_falls_back_to_all_landmarks(self):
        pose = _pose(3, vis=0.0)
        _put(pose, 0, 0.10, 0.10, vis=0.0)
        _put(pose, 1, 0.90, 0.90, vis=0.0)
        _put(pose, 2, 0.50, 0.50, vis=0.0)
        assert bbox_from_landmarks(pose, 100, 100, min_visibility=0.9) == (10, 10, 90, 90)

    def test_out_of_range_indices_are_skipped_rather_than_raising(self):
        pose = _put(_pose(), 0, 0.25, 0.25)
        assert bbox_from_landmarks(pose, 100, 100, landmark_indices=[0, 999]) == (25, 25, 25, 25)

    def test_a_single_landmark_yields_a_zero_area_box(self):
        """Both callers then skip it: `extract_players` refuses `crop_w < 24`,
        so this is caught downstream rather than here."""
        assert bbox_from_landmarks(_put(_pose(), 0, 0.4, 0.6), 100, 100, landmark_indices=[0]) == (
            40, 60, 40, 60,
        )

    def test_padding_widens_horizontally_and_adds_head_room_above(self):
        """`y1 -= ph + frame_h * 0.15` gives the head room; the bottom gets only
        `ph`. Pinned because a swapped sign would crop the player's head off the
        crop the coach actually sees."""
        x1, y1, x2, y2 = bbox_from_landmarks(
            _put(_pose(), 0, 0.5, 0.5), 200, 200, landmark_indices=[0], padding_ratio=0.0
        )
        assert (x1, y1, x2, y2) == (100, 100, 100, 100)
        # A non-degenerate base box makes the padding legible.
        pose = _put(_pose(), 0, 0.4, 0.5)
        _put(pose, 1, 0.6, 0.5)
        x1, y1, x2, y2 = bbox_from_landmarks(
            pose, 200, 200, landmark_indices=[0, 1], padding_ratio=0.1
        )
        # base x 80..120 (pw=4), y 100..100 (ph=0)
        assert (x1, x2) == (76, 124)
        assert y2 == 100
        assert y1 == 100 - 0 - (200 * 0.15) + 0  # 70: 30 of head room above
        assert y1 == pytest.approx(70.0, abs=0.01)

    def test_padding_scales_with_the_box_size(self):
        pose = _put(_pose(), 0, 0.2, 0.5)
        _put(pose, 1, 0.8, 0.5)
        tight, = [bbox_from_landmarks(pose, 200, 200, landmark_indices=[0, 1], padding_ratio=0.0)]
        padded, = [bbox_from_landmarks(pose, 200, 200, landmark_indices=[0, 1], padding_ratio=0.5)]
        assert padded[0] < tight[0] and padded[2] > tight[2]

    def test_the_bottom_right_corner_is_clamped_to_the_frame(self):
        pose = _put(_pose(), 0, 0.95, 0.5)
        _put(pose, 1, 1.0, 0.55)
        x1, y1, x2, y2 = bbox_from_landmarks(
            pose, 100, 100, landmark_indices=[0, 1], padding_ratio=0.5
        )
        assert (x2, y2) == (99, 57)
        assert 0 <= x1 <= x2 and 0 <= y1 <= y2

    def test_the_top_left_corner_is_clamped_at_zero(self):
        pose = _put(_pose(), 0, 0.0, 0.0)
        _put(pose, 1, 0.05, 0.05)
        x1, y1, _, _ = bbox_from_landmarks(
            pose, 100, 100, landmark_indices=[0, 1], padding_ratio=0.5
        )
        assert (x1, y1) == (0, 0)

    def test_a_landmark_at_the_far_corner_inverts_the_box(self):
        """CHARACTERISATION of a real defect, pinned so it stays visible.

        A landmark at (1.0, 1.0) scales to exactly (frame_w, frame_h), and only
        the *far* corner is clamped (`min(frame_w - 1, ...)`). So x1 stays at
        `frame_w` while x2 becomes `frame_w - 1` — an inverted box with
        `x1 > x2`. It does not raise: `iou` clamps each area to `max(1, ...)`
        and returns 0, and `extract_players` refuses the crop on
        `crop_w < 24`. But a caller that trusted the box would read a negative
        width. Correct behaviour would be to clamp `x1` to `frame_w - 1` too,
        or to build the corner as `min(x + w, frame_w - 1)` before expanding.
        """
        box = bbox_from_landmarks(_put(_pose(), 0, 1.0, 1.0), 100, 80, landmark_indices=[0])
        assert box == (100, 80, 99, 79)
        assert box[0] > box[2] and box[1] > box[3]

    def test_the_body_landmark_indices_are_the_advertised_six(self):
        # Shoulders, hips, ankles: the tight tracking box, no head and no feet.
        assert BODY_LANDMARK_INDICES == [11, 12, 23, 24, 27, 28]

    def test_the_body_indices_exclude_the_head_and_hands(self):
        assert not set(BODY_LANDMARK_INDICES) & set(range(11))

    def test_all_landmark_indices_cover_the_whole_pose(self):
        assert ALL_LANDMARK_INDICES == list(range(33))


# ── PoseCandidate ────────────────────────────────────────────────────────────


class TestPoseCandidate:
    def test_it_holds_the_three_fields_every_caller_reads(self):
        candidate = PoseCandidate(landmarks=[], bbox=(1, 2, 3, 4), visibility=0.9)
        assert candidate.landmarks == []
        assert candidate.bbox == (1, 2, 3, 4)
        assert candidate.visibility == 0.9

    def test_it_compares_by_value(self):
        a = PoseCandidate(landmarks=[], bbox=(1, 2, 3, 4), visibility=0.9)
        b = PoseCandidate(landmarks=[], bbox=(1, 2, 3, 4), visibility=0.9)
        assert a == b

    def test_it_is_mutable_because_dedup_overwrites_the_kept_candidate(self):
        # detector._detect_pose_candidates replaces landmarks/bbox/visibility on
        # the surviving candidate when a higher-visibility duplicate arrives.
        candidate = PoseCandidate(landmarks=[], bbox=(0, 0, 1, 1), visibility=0.4)
        candidate.visibility = 0.9
        candidate.bbox = (2, 2, 3, 3)
        assert (candidate.visibility, candidate.bbox) == (0.9, (2, 2, 3, 3))
