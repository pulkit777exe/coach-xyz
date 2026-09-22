"""Tests for core/findings.py — deterministic, evidence-bound findings."""

from core.findings import build_findings, enforce_evidence_gate

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


class TestNeedsReview:
    def test_true_when_any_finding_needs_review(self):
        from core.analyzer import _needs_review

        assert _needs_review([{"review_state": "auto"}, {"review_state": "needs_review"}]) is True
        assert _needs_review([{"review_state": "auto"}]) is False
        assert _needs_review([]) is False
        assert _needs_review(None) is False
        assert _needs_review("nope") is False


def _finding(**over):
    base = {
        "id": f"{JOB}:e1",
        "category": "drive",
        "start_ms": 12000,
        "end_ms": 16000,
        "confidence": 0.9,
        "confidence_band": "high",
        "severity": "medium",
        "observation": "Good timing.",
        "feedback": "Good timing.",
        "form_score": 7.5,
        "evidence_frames": [375],
        "measured_at_timestamp": 12.5,
        "model_versions": {},
        "review_state": "auto",
    }
    base.update(over)
    return base


class TestEnforceEvidenceGate:
    def test_supported_claims_pass_through(self):
        gated, downgraded = enforce_evidence_gate([_finding()], duration_s=90.0)
        assert downgraded == 0
        assert gated[0]["confidence_band"] == "high"
        assert gated[0]["review_state"] == "auto"

    def test_strong_claim_without_frames_downgrades(self):
        gated, downgraded = enforce_evidence_gate(
            [_finding(evidence_frames=[])], duration_s=90.0
        )
        assert downgraded == 1
        assert gated[0]["confidence_band"] == "needs_review"
        assert gated[0]["review_state"] == "needs_review"

    def test_moderate_without_frames_downgrades(self):
        gated, downgraded = enforce_evidence_gate(
            [_finding(confidence_band="moderate", evidence_frames=None)]
        )
        assert downgraded == 1
        assert gated[0]["review_state"] == "needs_review"

    def test_inverted_range_needs_review(self):
        gated, downgraded = enforce_evidence_gate([_finding(start_ms=5000, end_ms=1000)])
        assert downgraded == 1
        assert gated[0]["review_state"] == "needs_review"

    def test_range_fully_outside_duration_needs_review(self):
        gated, downgraded = enforce_evidence_gate([_finding(start_ms=95000, end_ms=99000)], duration_s=90.0)
        assert downgraded == 1
        assert gated[0]["review_state"] == "needs_review"

    def test_partial_overflow_clamps_without_downgrade(self):
        gated, downgraded = enforce_evidence_gate([_finding(start_ms=88000, end_ms=99000)], duration_s=90.0)
        assert downgraded == 0
        assert gated[0]["start_ms"] == 88000
        assert gated[0]["end_ms"] == 90000
        assert gated[0]["review_state"] == "auto"

    def test_already_needs_review_not_double_counted(self):
        gated, downgraded = enforce_evidence_gate(
            [_finding(confidence_band="needs_review", review_state="needs_review")]
        )
        assert downgraded == 0
        assert gated[0]["review_state"] == "needs_review"

    def test_non_dict_entries_skipped(self):
        gated, downgraded = enforce_evidence_gate([None, "x", _finding()])
        assert len(gated) == 1
        assert downgraded == 0

    def test_gate_end_to_end_on_built_findings(self):
        built = build_findings(
            [_event(biomechanics={"confidence": 0.9, "measured_at_frame": 375})],
            "cricket",
            PROV,
            JOB,
        )
        gated, downgraded = enforce_evidence_gate(built, duration_s=90.0)
        assert downgraded == 0
        assert gated[0]["review_state"] == "auto"

    def test_gate_end_to_end_downgrades_frameless_claims(self):
        built = build_findings(
            [_event(biomechanics={"confidence": 0.9})], "cricket", PROV, JOB
        )
        assert built[0]["confidence_band"] == "high"
        gated, downgraded = enforce_evidence_gate(built, duration_s=90.0)
        assert downgraded == 1
        assert gated[0]["confidence_band"] == "needs_review"
