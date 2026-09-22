"""Tests for core/findings.py — deterministic, evidence-bound findings."""

from core.findings import build_findings

JOB = "job-123"
PROV = {"model": "gemini-2.5-flash", "analysis_prompt": "1", "sport_pack_version": 1}


def _event(**over):
    base = {
        "timestamp": 12.5,
        "event_type": "drive",
        "form_score": 7.5,
        "feedback": "Good timing.",
        "key_observation": "head: needs_work",
        "biomechanics": {"confidence": 0.9, "measured_at_frame": 375},
    }
    base.update(over)
    return base


class TestBuildFindings:
    def test_one_finding_per_event_with_stable_id(self):
        out = build_findings([_event(), _event()], "cricket", PROV, JOB)
        assert [f["id"] for f in out] == [f"{JOB}:e1", f"{JOB}:e2"]

    def test_timestamps_in_ms_with_evidence_window(self):
        out = build_findings([_event()], "cricket", PROV, JOB)
        assert out[0]["start_ms"] == 12500
        assert out[0]["end_ms"] > out[0]["start_ms"]

    def test_confidence_bands(self):
        high = build_findings([_event()], "cricket", PROV, JOB)[0]
        assert high["confidence_band"] == "high"
        assert high["review_state"] == "auto"
        mod = build_findings(
            [_event(biomechanics={"confidence": 0.6})], "cricket", PROV, JOB
        )[0]
        assert mod["confidence_band"] == "moderate"
        low = build_findings(
            [_event(biomechanics={"confidence": 0.2})], "cricket", PROV, JOB
        )[0]
        assert low["confidence_band"] == "needs_review"
        assert low["review_state"] == "needs_review"

    def test_missing_biomechanics_never_claims_confidence(self):
        out = build_findings([_event(biomechanics=None)], "cricket", PROV, JOB)[0]
        assert out["confidence"] is None
        assert out["review_state"] == "needs_review"

    def test_severity_from_score(self):
        assert build_findings([_event(form_score=9)], "cricket", PROV, JOB)[0]["severity"] == "low"
        assert build_findings([_event(form_score=6)], "cricket", PROV, JOB)[0]["severity"] == "medium"
        assert build_findings([_event(form_score=3)], "cricket", PROV, JOB)[0]["severity"] == "high"

    def test_model_versions_stamped(self):
        out = build_findings([_event()], "cricket", PROV, JOB)[0]
        assert out["model_versions"]["model"] == "gemini-2.5-flash"

    def test_observation_prefers_key_observation(self):
        out = build_findings([_event()], "cricket", PROV, JOB)[0]
        assert out["observation"] == "head: needs_work"

    def test_non_dict_events_skipped(self):
        assert build_findings([None, "x", _event()], "cricket", PROV, JOB)[0]["id"] == f"{JOB}:e3"
