"""Tests for core/quality.py — pre-render quality gate (never blocks)."""

from core.quality import quality_check


def _summary(**over):
    base = {
        "sport": "cricket",
        "form_score": 7.5,
        "overall_rating": "Advanced",
        "total_events": 1,
        "shot_events": [{"timestamp": 12.5, "event_type": "drive"}],
        "findings": [
            {
                "id": "job:e1",
                "confidence_band": "high",
                "evidence_frames": [375],
                "review_state": "auto",
            }
        ],
    }
    base.update(over)
    return base


class TestQualityCheck:
    def test_clean_summary_passes(self):
        report = quality_check(_summary(), duration_s=90.0)
        assert report == {"passed": True, "issues": [], "needs_review": False}

    def test_missing_summary_fails(self):
        report = quality_check(None)
        assert report["passed"] is False
        assert report["issues"] == ["missing_summary"]
        assert report["needs_review"] is True

    def test_missing_sport_and_scores_flagged(self):
        report = quality_check(_summary(sport="", form_score=None, overall_rating="Pro"))
        assert "missing_sport" in report["issues"]
        assert "missing_form_score" in report["issues"]
        assert "invalid_overall_rating" in report["issues"]
        assert report["needs_review"] is True

    def test_form_score_out_of_range(self):
        assert "form_score_out_of_range" in quality_check(_summary(form_score=11))["issues"]
        assert "form_score_out_of_range" in quality_check(_summary(form_score=-1))["issues"]

    def test_missing_events_and_findings(self):
        report = quality_check(_summary(shot_events=[], findings=[]))
        assert "missing_shot_events" in report["issues"]
        assert "missing_findings" in report["issues"]

    def test_event_timestamp_out_of_range(self):
        report = quality_check(_summary(), duration_s=5.0)
        assert "event_timestamp_out_of_range" in report["issues"]

    def test_event_count_mismatch(self):
        report = quality_check(_summary(total_events=3))
        assert "event_count_mismatch" in report["issues"]

    def test_unsupported_strong_claim(self):
        summary = _summary()
        summary["findings"][0]["evidence_frames"] = []
        report = quality_check(summary)
        assert "unsupported_strong_claim" in report["issues"]

    def test_invalid_review_state(self):
        summary = _summary()
        summary["findings"][0]["review_state"] = "maybe"
        report = quality_check(summary)
        assert "invalid_review_state" in report["issues"]

    def test_malformed_entries_flagged_once(self):
        report = quality_check(_summary(shot_events=["nope"], findings=["nope"]))
        assert "malformed_shot_event" in report["issues"]
        assert "malformed_finding" in report["issues"]

    def test_duration_unknown_skips_range_checks(self):
        report = quality_check(_summary(), duration_s=None)
        assert report["passed"] is True
