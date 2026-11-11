"""Research-to-code compliance tests.

These tests encode the architectural promises in the manuscript. They are
deliberately small and direct: if a future refactor lets a VLM judgement become
a measurement, promotes a motion peak to a confirmed event, or drops the
provenance manifest, the suite fails before the paper and the product drift
apart again.
"""

from __future__ import annotations

import copy

import numpy as np
import pytest

from core import evidence, judge, measure, result, sports
from core.judge import Verdict
from core.motion import Candidate
from core.track import Track
from evaluation import protocol


def track_at(
    angle: float = 160.0, visibility: float = 1.0, seconds: float = 4.0
) -> Track:
    rate = 12
    t = np.arange(0, seconds, 1 / rate)
    lm = np.zeros((len(t), 33, 4), np.float32)
    lm[:, :, 3] = visibility
    # Right shoulder, elbow, wrist forming an angle near ``angle``.
    lm[:, 12, :2] = [0.50, 0.40]
    lm[:, 14, :2] = [0.55, 0.50]
    lm[:, 16, :2] = [0.60, 0.40]
    # Hips and shoulders for trunk lean / knee metrics.
    lm[:, 11, :2] = [0.45, 0.40]
    lm[:, 23, :2] = [0.46, 0.60]
    lm[:, 24, :2] = [0.54, 0.60]
    lm[:, 26, :2] = [0.46, 0.75]
    lm[:, 28, :2] = [0.46, 0.90]
    lm[:, 25, :2] = [0.54, 0.75]
    lm[:, 27, :2] = [0.54, 0.90]
    return Track(
        t,
        lm,
        np.tile([0, 0, 10, 10.0], (len(t), 1)),
        np.ones(len(t), np.float32),
        1000,
        1000,
        rate,
    )


def test_invalid_camera_view_is_not_scored():
    pack = sports.Pack(
        name="test",
        version=1,
        label="Test",
        signal="wrist_speed",
        min_gap_s=1.5,
        floor=4.0,
        event_types=["action"],
        positive=["made"],
        negative=["missed"],
        neutral=["unknown"],
        positions=[],
        camera_angles=[{"id": "side"}, {"id": "front"}],
        criteria=[
            sports.Criterion(
                "elbow",
                "Elbow",
                "elbow_angle",
                (155, 180),
                (135, 180),
                1.0,
                allowed_views=("side",),
            )
        ],
    )
    row = measure.measure(track_at(), 10, "right", pack, angle="front")["criteria"][0]
    assert row["state"] == "invalid_view"
    assert row["source"] is None and row["score"] is None
    assert row["view_verified"] is False
    assert measure.combine_detail([row])["value"] is None


def test_missing_landmark_becomes_occluded_not_a_low_score():
    pack = sports.load("basketball")
    track = track_at(visibility=0.05)
    row = next(
        r
        for r in measure.measure(track, 10, "right", pack, angle="side")["criteria"]
        if r["key"] == "arm_extension"
    )
    assert row["state"] in ("occluded", "low_confidence")
    assert row["score"] is None
    assert row["value"] is None


def test_vlm_unavailable_keeps_valid_measurements():
    pack = sports.load("basketball")
    track = track_at()
    rows = measure.measure(track, 10, "right", pack, angle="side")["criteria"]
    verdict = judge.rules([Candidate(10, 1.0, 1.0, "right")], pack, "no key").verdicts[
        0
    ]
    assert verdict["state"] == "candidate"
    assert any(
        r["state"] == "valid" and r["source"] == "pose" and r["value"] is not None
        for r in rows
    )
    detail = measure.combine_detail(rows)
    assert (
        detail["value"] is not None
        and detail["coverage"] >= measure.MIN_MEASURED_COVERAGE
    )


def test_research_mode_is_fail_closed_without_a_declared_camera_view():
    pack = sports.load("basketball")
    track = track_at()
    undeclared = measure.measure(track, 10, "right", pack, angle=None, research=True)
    for row in undeclared["criteria"]:
        assert row["state"] == "unavailable" and row["score"] is None
        assert row["view_verified"] is False
        assert "declared camera view" in row["note"]

    declared = measure.measure(track, 10, "right", pack, angle="side", research=True)
    arm = next(r for r in declared["criteria"] if r["key"] == "arm_extension")
    assert arm["state"] != "invalid_view" and arm["skipped"] is False

    front = measure.measure(track, 10, "right", pack, angle="front", research=True)
    arm = next(r for r in front["criteria"] if r["key"] == "arm_extension")
    assert arm["state"] == "invalid_view"


def test_research_mode_does_not_silently_widen_product_behaviour():
    # Product runs must not overstate camera-gated measurements when the
    # camera view was never declared or verified.
    pack = sports.load("basketball")
    rows = measure.measure(track_at(), 10, "right", pack, angle=None)["criteria"]
    arm = next(r for r in rows if r["key"] == "arm_extension")
    assert arm["state"] == "view_unverified"
    assert arm["view_verified"] is False
    assert arm["score"] is None and arm["source"] is None


def test_vlm_ratings_for_unknown_criteria_are_dropped_and_recorded():
    pack = sports.load("basketball")
    verdicts = {
        0: {"ratings": {"arm_extension": "consistent", "telekinesis": "consistent"}}
    }
    failure = judge._drop_unsupported_ratings(verdicts, pack)
    assert failure is not None and failure["code"] == "F10_UNSUPPORTED_OBSERVATION"
    assert failure["detail"]["unsupported_criteria"] == ["telekinesis"]
    assert verdicts[0]["ratings"] == {"arm_extension": "consistent"}
    assert (
        judge._drop_unsupported_ratings(
            {0: {"ratings": {"arm_extension": "consistent"}}}, pack
        )
        is None
    )


def test_unsupported_or_low_confidence_vlm_claim_is_not_confirmed():
    pack = sports.load("basketball")
    uncertain = judge._clean(
        Verdict(
            candidate=1,
            is_event=True,
            event_type="free_throw",
            result="made",
            ratings=[],
            feedback="",
            confidence=0.2,
        ),
        pack,
    )
    rejected = judge._clean(
        Verdict(
            candidate=1,
            is_event=False,
            event_type="free_throw",
            result="made",
            ratings=[],
            feedback="",
            confidence=0.9,
        ),
        pack,
    )
    assert uncertain["state"] == "uncertain"
    assert rejected["state"] == "rejected"
    # A VLM rating is qualitative evidence; it never writes a numeric score.
    rows = measure.measure(track_at(), 10, "right", pack, angle="side")["criteria"]
    measure.apply_ratings(rows, {"arm_extension": "consistent"})
    row = next(r for r in rows if r["key"] == "arm_extension")
    assert (
        row["source"] == "pose" and row["score"] is not None
    )  # pose row is left alone
    blank = [
        {
            "key": "other",
            "criterion_id": "BB99",
            "weight": 1.0,
            "score": None,
            "source": None,
            "state": "unavailable",
            "evidence_type": "judged",
            "validation_status": "proposed",
        }
    ]
    measure.apply_ratings(blank, {"other": "consistent"})
    assert blank[0]["source"] == "vlm" and blank[0]["score"] is None
    assert blank[0]["qualitative_rating"] == "consistent"


def test_not_applicable_is_excluded_from_the_coverage_denominator():
    rows = [
        {
            "key": "a",
            "criterion_id": "BB01",
            "weight": 0.5,
            "score": 1.0,
            "source": "pose",
            "state": "valid",
            "evidence_type": "measured",
        },
        {
            "key": "b",
            "criterion_id": "BB02",
            "weight": 0.5,
            "score": None,
            "source": "vlm",
            "state": "not_applicable",
            "evidence_type": "judged",
        },
    ]
    detail = measure.combine_detail(rows)
    assert detail["applicable_weight"] == 0.5
    assert detail["coverage"] == 1.0
    assert detail["value"] == 10.0


def test_insufficient_coverage_emits_no_aggregate_score():
    rows = [
        {
            "key": "a",
            "criterion_id": "BB01",
            "weight": 0.2,
            "score": 1.0,
            "source": "pose",
            "state": "valid",
            "evidence_type": "measured",
        },
        {
            "key": "b",
            "criterion_id": "BB02",
            "weight": 0.8,
            "score": None,
            "source": None,
            "state": "unavailable",
            "evidence_type": "measured",
        },
    ]
    detail = measure.combine_detail(rows)
    assert detail["value"] is None
    assert detail["coverage"] == 0.2


def test_unconfirmed_candidate_is_not_a_confirmed_event():
    pack = sports.load("basketball")
    judgement = judge.rules([Candidate(10, 1.0, 1.0, "right")], pack, "VLM unavailable")
    assert judgement.verdicts[0]["state"] == "candidate"
    assert result._event_state(judgement.verdicts[0]) == "candidate"
    detection = result._event_detection([Candidate(10, 1.0, 1.0, "right")], judgement)
    assert detection["confirmed"] == 0 and detection["candidate"] == 1


def test_experimental_rating_is_excluded_from_research_output():
    doc = {
        "summary": {
            "rating": "Elite",
            "average_score": 9.2,
            "composite": {"value": 9.2},
            "scoring_status": "experimental_unvalidated",
        },
        "events": [{"score": 9.2, "score_source": "measured"}],
        "findings": [{"form_score": 9.2}],
    }
    out = protocol.research_view(doc)
    assert "rating" not in out["summary"] and "average_score" not in out["summary"]
    assert "composite" not in out["summary"]
    assert out["summary"]["scoring_status"] == "excluded_from_research"
    assert "score" not in out["events"][0] and "score_source" not in out["events"][0]
    assert "form_score" not in out["findings"][0]
    assert out["research_output"] is True


def _manifest_result() -> dict:
    return {
        "provenance": {
            "manifest": {
                "application": {"git_commit": "abc123"},
                "sport_pack": {"sha256": "pack456", "version": 3},
                "models": {
                    "pose": {"sha256": "pose789"},
                    "vlm": {"model_used": "model-a"},
                },
                "prompt": {"hash": "prompt000", "version": "v1"},
                "video": {"sha256": "video111"},
                "camera": {"angle": "side", "angle_source": "declared"},
                "environment": {"python": "3.12"},
                "preprocessing": {"analysis_fps": 15},
            }
        }
    }


def test_missing_provenance_is_rejected():
    with pytest.raises(protocol.EvaluationRejected):
        protocol.validate_manifest({"provenance": {}})
    broken = _manifest_result()
    broken["provenance"]["manifest"]["video"].pop("sha256")
    with pytest.raises(protocol.EvaluationRejected):
        protocol.validate_manifest(broken)


def test_model_version_change_creates_a_new_evaluation_version():
    first = _manifest_result()
    second = copy.deepcopy(first)
    second["provenance"]["manifest"]["models"]["vlm"]["model_used"] = "model-b"
    assert protocol.evaluation_version(first) != protocol.evaluation_version(second)
    third = copy.deepcopy(first)
    third["provenance"]["manifest"]["models"]["vlm"]["model_used"] = "model-a"
    assert protocol.evaluation_version(first) == protocol.evaluation_version(third)


def test_every_paper_criterion_has_a_permanent_id_and_pack_traceability():
    for name, prefix, count in (
        ("cricket", "CR", 11),
        ("football", "FB", 12),
        ("basketball", "BB", 12),
    ):
        pack = sports.load(name)
        expected = [f"{prefix}{i:02d}" for i in range(1, count + 1)]
        assert [c["criterion_id"] for c in pack.paper_criteria] == expected
        assert pack.action_id and pack.pack_version and pack.phases and pack.objects
        for criterion in pack.criteria:
            assert criterion.criterion_id in expected, (
                f"{name}:{criterion.key} has no paper ID"
            )
            assert criterion.validation_status in evidence.VALIDATION_STATUSES
            assert criterion.evidence_type in evidence.EVIDENCE_TYPES
        registry = result._criteria_registry(pack)
        assert {row["criterion_id"] for row in registry} == set(expected)
        assert pack.aggregation == "disabled_until_validated"
        assert pack.fallback.get("restricted_states")
        for criterion in pack.criteria:
            assert criterion.abstention_states


def test_phase_localization_is_reported_as_not_implemented_without_runtime_phases():
    doc = _manifest_result()
    doc["events"] = [
        {"t": 1.0, "event_state": "confirmed", "duration_s": 2.0, "measurements": []},
    ]
    window = protocol.AnnotatedWindow(
        "clip-1",
        0.5,
        3.0,
        True,
        {"BB04": "functional"},
        phase_boundaries={"preparation": (0.0, 1.0)},
    )
    report = protocol.evaluate(doc, [window], training=[window])
    phase = report["phase_localization"]
    assert phase["status"] == "not_implemented"
    assert phase["annotated_phases"] == 1 and phase["detected_phases"] == 0
    assert phase["precision"] is None and phase["f1"] is None


def test_phase_localization_metrics_score_boundary_agreement():
    result = {
        "events": [
            {
                "t": 1.0,
                "phases": {"preparation": [0.1, 1.1], "ball_release": [1.2, 1.6]},
            },
        ],
    }
    window = protocol.AnnotatedWindow(
        "clip-1",
        0.5,
        3.0,
        True,
        {},
        phase_boundaries={
            "preparation": (0.0, 1.0),
            "ball_release": (1.1, 1.5),
            "recovery": (1.6, 2.0),
        },
    )
    m = protocol.phase_localization_metrics(result, [window])
    assert m["status"] == "implemented"
    assert m["annotated_phases"] == 3
    assert m["matched"] == 2
    assert m["precision"] == 1.0
    assert m["recall"] == pytest.approx(2 / 3, abs=0.01)
    assert m["boundary_error_s"] is not None and m["boundary_error_s"] > 0


def test_ablation_uses_the_same_annotated_windows_and_reports_event_detection_separately():
    doc = _manifest_result()
    doc["events"] = [
        {
            "t": 1.0,
            "event_state": "confirmed",
            "duration_s": 2.0,
            "measurements": [
                {
                    "criterion_id": "BB04",
                    "source": "pose",
                    "state": "valid",
                    "value": 160.0,
                },
                {
                    "criterion_id": "BB05",
                    "source": "vlm",
                    "state": "valid",
                    "value": None,
                    "qualitative_rating": "functional",
                },
            ],
        },
        {"t": 8.0, "event_state": "candidate", "duration_s": 2.0, "measurements": []},
    ]
    window = protocol.AnnotatedWindow(
        "clip-1", 0.5, 3.0, True, {"BB04": "consistent", "BB05": "functional"}
    )
    training = [window]
    report = protocol.evaluate(doc, [window], training=training)
    assert report["annotated_windows"] == 1
    assert set(report["variants"]) == set(protocol.MODES)
    # B0 sees only training data; B1 cannot use the VLM row without a mapping.
    assert report["variants"]["B0_MAJORITY"]["technique"]["n"] == 2
    assert report["variants"]["B1_POSE_ONLY"]["technique"]["n"] == 0
    assert report["variants"]["B2_VLM_ONLY"]["technique"]["n"] == 1
    # Event detection is separate and counts only confirmed intervals.
    assert (
        report["variants"]["B3_HYBRID"]["event_detection"]["predicted_confirmed"] == 1
    )
    assert report["variants"]["B3_HYBRID"]["event_detection"]["matched"] == 1
