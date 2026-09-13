"""Tests for core/validator.py — schema validation of Gemini analysis output."""

from core.validator import EXPECTED_STAT_KEYS, VALID_RESULTS, validate_analysis


def _shot(**overrides):
    shot = {
        "timestamp_of_shot": "0:05",
        "timestamp_of_outcome": "0:05",
        "result": "made",
        "shot_type": "jumper",
        "feedback": "Good arc",
        "form_score": 8,
        "form_breakdown": {"follow_through": "good"},
        "total_shots_made_so_far": 1,
        "total_shots_missed_so_far": 0,
        "total_three_pointers_made_so_far": 0,
        "total_layups_made_so_far": 0,
        "total_free_throws_made_so_far": 0,
    }
    shot.update(overrides)
    return shot


def _valid_analysis():
    return {
        "sport": "basketball",
        "shots": [_shot()],
        "session_summary": {
            "total_events": 1,
            "success_rate_percent": 100,
            "average_form_score": 8.0,
            "top_issues": [],
            "strengths": [],
            "priority_drill": "Keep shooting",
            "overall_rating": "Elite",
        },
    }


class TestValidateAnalysis:
    def test_valid_analysis_has_no_errors(self):
        assert validate_analysis(_valid_analysis()) == []

    def test_missing_top_level_fields_reported(self):
        errors = validate_analysis({"shots": []})
        assert any("Missing required top-level field: 'sport'" in e for e in errors)
        errors = validate_analysis({"sport": "basketball"})
        assert any("Missing required top-level field: 'shots'" in e for e in errors)

    def test_invalid_sport_reported(self):
        errors = validate_analysis({"sport": "curling", "shots": []})
        assert any("Invalid sport" in e for e in errors)

    def test_shots_must_be_a_list(self):
        errors = validate_analysis({"sport": "basketball", "shots": "nope"})
        assert any("'shots' must be a list" in e for e in errors)

    def test_invalid_result_for_sport(self):
        data = _valid_analysis()
        data["shots"][0]["result"] = "four"  # basketball has no "four"
        errors = validate_analysis(data)
        assert any("invalid result 'four' for basketball" in e for e in errors)

    def test_form_score_out_of_range(self):
        data = _valid_analysis()
        data["shots"][0]["form_score"] = 11
        errors = validate_analysis(data)
        assert any("form_score must be 1–10" in e for e in errors)

    def test_decreasing_cumulative_stats_reported(self):
        data = _valid_analysis()
        data["shots"] = [
            _shot(total_shots_made_so_far=5),
            _shot(total_shots_made_so_far=3),
        ]
        errors = validate_analysis(data)
        assert any("decreased from 5 to 3" in e for e in errors)

    def test_empty_feedback_reported(self):
        data = _valid_analysis()
        data["shots"][0]["feedback"] = "   "
        errors = validate_analysis(data)
        assert any("'feedback' is empty" in e for e in errors)

    def test_invalid_summary_rating_reported(self):
        data = _valid_analysis()
        data["session_summary"]["overall_rating"] = "Godlike"
        errors = validate_analysis(data)
        assert any("invalid overall_rating 'Godlike'" in e for e in errors)


class TestVocabulary:
    def test_every_sport_has_result_and_stat_definitions(self):
        for sport, results in VALID_RESULTS.items():
            assert results, f"{sport} has no valid results"
        for sport, keys in EXPECTED_STAT_KEYS.items():
            assert keys, f"{sport} has no expected stat keys"
        assert set(VALID_RESULTS) == set(EXPECTED_STAT_KEYS)
