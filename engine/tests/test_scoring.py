"""Tests for the scoring seam in core.scoring (extracted from analyzer)."""

from core.scoring import compute_criterion_score, compute_weighted_scoring


def _criterion(**overrides):
    base = {
        "key": "stance",
        "label": "Stance",
        "metric": "hip_width_stance_deg",
        "ideal_range": [45, 65],
        "acceptable_range": [35, 75],
        "weight": 0.1,
    }
    base.update(overrides)
    return base


class TestComputeCriterionScore:
    def test_missing_measurement_scores_zero(self):
        out = compute_criterion_score(_criterion(), None)
        assert out["score"] == 0.0
        assert out["measured_value"] is None
        assert out["in_ideal"] is False

    def test_ideal_scores_one(self):
        out = compute_criterion_score(_criterion(), 55.0)
        assert out["score"] == 1.0
        assert out["in_ideal"] is True
        assert out["in_acceptable"] is True

    def test_acceptable_scores_half(self):
        out = compute_criterion_score(_criterion(), 70.0)
        assert out["score"] == 0.5
        assert out["in_ideal"] is False
        assert out["in_acceptable"] is True

    def test_outside_scores_zero(self):
        out = compute_criterion_score(_criterion(), 10.0)
        assert out["score"] == 0.0
        assert out["in_acceptable"] is False


class TestComputeWeightedScoring:
    def test_attaches_composite_and_criteria_from_the_sport_pack(self):
        events = [
            {
                "form_breakdown": {"stance": "good"},
                "biomechanics": {"joint_angles": {"hip_width_stance_deg": 55.0}},
                "form_score": 7.0,
            }
        ]
        compute_weighted_scoring(events, "cricket")
        weighted = events[0]["weighted_scoring"]
        assert 1.0 <= weighted["composite_score"] <= 10.0
        assert len(weighted["criteria"]) == 9
        assert "weighted_rationale" in weighted

    def test_empty_events_are_a_no_op(self):
        compute_weighted_scoring([], "cricket")
