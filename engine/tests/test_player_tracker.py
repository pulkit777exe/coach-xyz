"""player_tracker: the keyframe scorer, and the normalisation it depends on.

`core/player_tracker.py` scores video frames to pick the 5 best keyframes, and
every number it publishes is a weighted composition:

    pose confidence 40% + player count 25% + (1 - occlusion) 20% + blur 15%

It has had no test at all: 119 statements, 0% coverage, and its name appears in
`test_detector.py` only inside a docstring. That is the module that decides which
frames a coach ever sees, so every weight and every clamp here is a decision.

Mediapipe is not installed in CI and no model file is present, so `score_frames`
itself cannot run. The five scoring helpers below CAN, and they are where the
arithmetic lives — the same split `test_detector.py` uses for `extract_players`.
"""

import numpy as np
import pytest

from core import player_tracker as pt


# ── _extract_skeletons: normalising MediaPipe landmarks ───────────────────────


class _Lm:
    """A landmark with normalised coords and a visibility."""

    def __init__(self, x, y, visibility=0.9):
        self.x = x
        self.y = y
        self.visibility = visibility


def _skeleton(points):
    return [_Lm(x, y, v) for (x, y, v) in points]


class TestExtractSkeletons:
    def test_no_landmarks_is_an_empty_list_not_an_error(self):
        assert pt._extract_skeletons(None, 320, 240) == []
        assert pt._extract_skeletons([], 320, 240) == []

    def test_normalised_coords_become_pixel_bbox_and_centroid(self):
        # x spans 0.25..0.75 of a 320 frame => 80..240. y spans 0.5..1.0 of 240
        # => 120..240.
        skels = pt._extract_skeletons(
            [_skeleton([(0.25, 0.5, 0.9), (0.75, 1.0, 0.9)])], 320, 240
        )
        assert len(skels) == 1
        bbox = skels[0]["bbox"]
        assert (bbox["x_min"], bbox["x_max"]) == (80, 240)
        assert (bbox["y_min"], bbox["y_max"]) == (120, 240)
        assert skels[0]["centroid"] == (160.0, 180.0)

    def test_out_of_range_landmarks_are_dropped_not_clamped(self):
        # A landmark at x=1.4 is garbage from a detector that lost the subject.
        # Filtering it is the point: clamping it to the frame edge would invent
        # a player pressed against the border.
        skels = pt._extract_skeletons(
            [_skeleton([(0.3, 0.3, 0.9), (1.4, 0.3, 0.9), (0.3, 0.3, 0.9)])], 320, 240
        )
        assert len(skels) == 1
        assert skels[0]["bbox"]["x_max"] == 96  # 0.3 * 320, not 320

    def test_a_skeleton_whose_landmarks_are_all_invalid_is_skipped(self):
        assert pt._extract_skeletons([_skeleton([(1.4, 0.3, 0.9)])], 320, 240) == []

    def test_confidence_is_the_mean_visibility(self):
        skels = pt._extract_skeletons(
            [_skeleton([(0.3, 0.3, 1.0), (0.4, 0.4, 0.5)])], 320, 240
        )
        assert skels[0]["confidence"] == pytest.approx(0.75)

    def test_missing_visibility_defaults_to_the_midpoint(self):
        # getattr(..., 0.5): a landmark with no visibility is not evidence of
        # confidence, and defaulting to 0.0 would zero a whole player out.
        lm = _Lm(0.3, 0.3)
        del lm.visibility
        skels = pt._extract_skeletons([[lm]], 320, 240)
        assert skels[0]["confidence"] == pytest.approx(0.5)


# ── The four score components ─────────────────────────────────────────────────


class TestPoseConfidence:
    def test_no_skeletons_scores_zero(self):
        assert pt._pose_confidence([]) == 0.0

    def test_it_is_the_mean_confidence(self):
        skels = [{"confidence": 0.8}, {"confidence": 0.4}]
        assert pt._pose_confidence(skels) == pytest.approx(0.6)

    def test_a_skeleton_with_no_confidence_key_counts_as_zero(self):
        assert pt._pose_confidence([{}, {"confidence": 1.0}]) == pytest.approx(0.5)

    def test_out_of_range_confidences_are_clamped_on_the_mean_not_each_value(self):
        # np.clip is applied to the mean, not per element — so [1.4, -0.2]
        # averages to 0.6, which is already in range and is returned unchanged.
        # Pinned because that is the actual behaviour, and it differs from the
        # reading a reader brings to a function named "clamped".
        assert pt._pose_confidence([{"confidence": 1.4}, {"confidence": -0.2}]) == pytest.approx(0.6)
        # A mean that genuinely leaves the range is clamped.
        assert pt._pose_confidence([{"confidence": 2.0}, {"confidence": 2.0}]) == 1.0
        assert pt._pose_confidence([{"confidence": -1.0}, {"confidence": -1.0}]) == 0.0


class TestPlayerCountScore:
    def test_full_credit_at_four_visible_players(self):
        # The weight this carries is 25%, and 4 is the documented threshold, so
        # the boundary is worth pinning: 3 must not also saturate.
        assert pt._player_count_score(4) == 1.0
        assert pt._player_count_score(8) == 1.0
        assert pt._player_count_score(3) == pytest.approx(0.75)

    def test_it_is_linear_below_the_threshold(self):
        assert pt._player_count_score(0) == 0.0
        assert pt._player_count_score(1) == pytest.approx(0.25)
        assert pt._player_count_score(2) == pytest.approx(0.5)

    def test_a_negative_count_cannot_produce_a_negative_score(self):
        assert pt._player_count_score(-3) == 0.0


def _skel_bbox(x1, y1, x2, y2, conf=0.9):
    return {
        "bbox": {"x_min": x1, "y_min": y1, "x_max": x2, "y_max": y2},
        "centroid": ((x1 + x2) / 2, (y1 + y2) / 2),
        "confidence": conf,
    }


class TestOcclusionPenalty:
    def test_a_single_player_cannot_occlude_anything(self):
        assert pt._occlusion_penalty([]) == 0.0
        assert pt._occlusion_penalty([_skel_bbox(0, 0, 10, 10)]) == 0.0

    def test_identical_boxes_are_a_total_penalty(self):
        # Two players reported at the same box is a duplicate detection, and the
        # scorer should distrust that frame. This is the branch that decides it.
        assert pt._occlusion_penalty(
            [_skel_bbox(0, 0, 100, 100), _skel_bbox(0, 0, 100, 100)]
        ) == pytest.approx(1.0)

    def test_disjoint_boxes_are_no_penalty(self):
        assert pt._occlusion_penalty(
            [_skel_bbox(0, 0, 50, 50), _skel_bbox(200, 200, 250, 250)]
        ) == pytest.approx(0.0)

    def test_it_is_the_mean_over_pairs(self):
        # Three boxes: two pairs at 0 overlap, one pair fully overlapping ->
        # mean iou 1/3.
        skels = [
            _skel_bbox(0, 0, 100, 100),
            _skel_bbox(0, 0, 100, 100),
            _skel_bbox(300, 300, 400, 400),
        ]
        assert pt._occlusion_penalty(skels) == pytest.approx(1 / 3)

    def test_half_overlapping_boxes(self):
        # [0,100] and [50,150] intersect over 50 of a 100-wide union -> iou 1/3.
        assert pt._occlusion_penalty(
            [_skel_bbox(0, 0, 100, 100), _skel_bbox(50, 0, 150, 100)]
        ) == pytest.approx(1 / 3)


class TestBlurScore:
    def test_a_flat_frame_is_maximally_blurry(self):
        flat = np.zeros((240, 320, 3), dtype=np.uint8)
        assert pt._blur_score(flat) == 0.0

    def test_a_noisy_frame_scores_higher_than_a_flat_one(self):
        rng = np.random.default_rng(7)
        noisy = rng.integers(0, 256, size=(240, 320, 3), dtype=np.uint8)
        assert pt._blur_score(noisy) > pt._blur_score(np.zeros((240, 320, 3), np.uint8))

    def test_the_score_saturates_rather_than_exceeding_one(self):
        # Variance is divided by 300 and clipped. A very noisy frame must reach
        # 1.0, never 1.7 — the composition at score_frames adds these together,
        # so an unbounded component would let blur dominate the other 85%.
        rng = np.random.default_rng(11)
        for _ in range(5):
            wild = rng.integers(0, 256, size=(480, 640, 3), dtype=np.uint8)
            assert 0.0 <= pt._blur_score(wild) <= 1.0

    def test_a_structured_image_is_read_as_sharp(self):
        # A checkerboard has huge Laplacian variance; a gradient does not.
        board = np.indices((240, 320)).sum(axis=0) % 2 * 255
        frame = np.repeat(board[:, :, None], 3, axis=2).astype(np.uint8)
        assert pt._blur_score(frame) > 0.5


# ── The weights, which are the module's actual policy ─────────────────────────


class TestWeights:
    def test_the_four_weights_sum_to_one(self):
        # They are combined linearly at score_frames, so a sum that drifts from
        # 1.0 silently re-weights the whole selection.
        total = pt._POSE_WEIGHT + pt._COUNT_WEIGHT + pt._OCCLUSION_WEIGHT + pt._BLUR_WEIGHT
        assert total == pytest.approx(1.0)

    def test_the_declared_weights_are_the_documented_ones(self):
        # 40/25/20/15 — pinned because the docstring states them and a future
        # edit to one weight would otherwise pass every other test here.
        assert pt._POSE_WEIGHT == pytest.approx(0.40)
        assert pt._COUNT_WEIGHT == pytest.approx(0.25)
        assert pt._OCCLUSION_WEIGHT == pytest.approx(0.20)
        assert pt._BLUR_WEIGHT == pytest.approx(0.15)


class TestScoredFrame:
    def test_it_carries_every_component_it_was_built_from(self):
        f = pt.ScoredFrame(
            frame_index=3,
            timestamp_s=1.5,
            total_score=0.8,
            pose_confidence=0.9,
            player_count_score=0.5,
            occlusion_penalty=0.1,
            blur_score=0.7,
            frame_width=320,
            frame_height=240,
            detected_skeletons=[],
        )
        assert f.frame_index == 3
        assert f.timestamp_s == pytest.approx(1.5)
        assert f.detected_skeletons == []


class TestGuards:
    def test_a_missing_backend_raises_a_named_import_error(self):
        # The module must not fall back to a default pose backend: returning
        # plausible-looking frames with no pose backend would be worse than
        # refusing, because the caller cannot tell the difference.
        if pt._HAS_TASKS:
            pytest.skip("mediapipe-tasks is installed; the guard is unreachable")
        with pytest.raises(ImportError, match="mediapipe"):
            pt.score_frames("whatever.mp4")
