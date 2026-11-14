from __future__ import annotations

import json

import numpy as np
import pytest

from core import exports, failures, judge, pipeline, render, result, sports
from core.judge import Judgement
from core.motion import Candidate
from core.track import Track
from core.video import Media


def _track(n=20, *, conf=0.9, rate=10.0, width=640, height=360):
    t = np.linspace(0, max(0.1, (n - 1) / rate), n)
    lm = np.zeros((n, 33, 4), np.float32)
    lm[:, :, :2] = 0.5
    lm[:, :, 3] = conf
    box = np.tile([100, 50, 200, 300], (n, 1)).astype(np.float32)
    c = np.full(n, conf, np.float32)
    return Track(t=t, lm=lm, box=box, conf=c, width=width, height=height, rate=rate)


def _pack():
    return sports.load("basketball")


def _media(duration=2.0):
    return Media(duration=duration, fps=30.0, has_audio=False, codec="h264")


def test_result_build_quality_needs_review_and_provenance_consistency_mixed_cases():
    pack = _pack()
    tr = _track()
    # candidate verdicts + F07 detail => partial/unconfirmed issues and needs_review coherence
    cands = [Candidate(5, 0.5, "right", 1.0), Candidate(10, 1.0, "right", 0.8)]
    judgement = Judgement(
        source="model",
        sport="basketball",
        verdicts={
            0: {"is_event": True, "state": "confirmed", "type": "three_pointer", "result": "made", "feedback": "ok", "confidence": 0.8, "ratings": {}, "tags": [], "pressure": "unknown"},
            1: {"is_event": True, "state": "candidate", "type": "three_pointer", "result": "unknown", "feedback": "not shown", "confidence": 0.0, "ratings": {}, "tags": ["unreviewed"], "pressure": "unknown"},
        },
        model="fake",
        prompt_hash="ph",
        judged_at="2026-01-01T00:00:00Z",
        failures=[{"code": "F07_MISSED_CANDIDATE", "stage": "judge", "message": "x", "detail": {"unseen_candidates": [1], "unseen_candidate_times": [1.0]}}],
    )
    out = result.build("job-q", {"angle": "side"}, pack, tr, _media(), cands, judgement, [], angle="side", angle_source="declared", failures_list=list(judgement.failures))
    assert out["quality"]["needs_review"] is True
    assert out["needs_review"] is True
    assert "unconfirmed_candidate_events" in out["quality"]["issues"]
    assert "partial_review" in out["quality"]["issues"]
    assert out["quality"]["partial_review"] is True
    assert out["quality"]["passed"] is False
    # provenance consistency
    prov = out["provenance"]
    assert prov["engine"] and prov["pipeline"] and prov["prompt"]
    assert prov["sport_pack"] == pack.version
    assert prov["judged_by"] == "model"
    assert prov["model"] == "fake"
    assert prov["prompt_hash"] == "ph"
    assert prov["judged_at"] == "2026-01-01T00:00:00Z"
    assert prov["angle_source"] == "declared"
    assert prov["manifest"]["sport_pack"]["name"] == pack.name
    assert out["sport_pack_version"] == (pack.pack_version or str(pack.version))


def test_result_build_nonfinite_and_malformed_numeric_fields_do_not_crash_or_fabricate():
    pack = _pack()
    tr = _track()
    tr.conf[:] = np.nan
    tr.lm[:, :, 3] = np.nan
    cands = [Candidate(5, float("nan"), "right", float("inf"))]
    judgement = Judgement(
        source="model",
        sport="basketball",
        verdicts={
            0: {"is_event": True, "state": "confirmed", "type": "three_pointer", "result": "made", "feedback": " ", "confidence": float("nan"), "ratings": {}, "tags": [None, 1], "pressure": "unknown"},
        },
        failures=[],
    )
    out = result.build("job-n", {"angle": "side"}, pack, tr, _media(), cands, judgement, [], angle="side", angle_source="declared", failures_list=[])
    assert np.isfinite(float(out["summary"]["pose_confidence"]))
    assert np.isfinite(float(out["summary"]["confidence"]))
    assert out["summary"]["confidence_kind"] == "event"
    assert len(out["events"]) == 1
    assert out["events"][0]["t"] == 0.0
    assert np.isfinite(float(out["events"][0]["confidence"]))
    assert out["events"][0]["score"] is None or np.isfinite(float(out["events"][0]["score"]))
    assert out["findings"][0]["start_ms"] == 0
    assert out["findings"][0]["end_ms"] >= out["findings"][0]["start_ms"]


def test_result_composite_and_score_nullability_edge_cases():
    # no applicable measurable criteria -> reason and null value coherence
    composite = result._composite([{"score": None, "coverage": 0.0, "coverage_detail": {"applicable_weight": 0.0}}], None)
    assert composite["value"] is None
    assert composite["status"] == "not_available"
    assert composite["scored_events"] == 0
    assert composite["considered_events"] == 1
    # empty events
    empty = result._composite([], None)
    assert empty["value"] is None
    assert empty["scored_events"] == 0


def test_exports_tolerate_mixed_container_types_without_crash_or_fabrication(tmp_path):
    # malformed/mixed collections: events/findings/session_metrics/stats as wrong types
    r = {
        "job_id": "j",
        "sport": "basketball",
        "summary": "not-a-dict",
        "provenance": {"sport_pack_manifest": ["bad"], "manifest": "bad"},
        "athlete": "bad",
        "events": {"bad": 1},
        "findings": "bad",
        "session_metrics": "bad",
        "stats": ["bad"],
        "failures": {"bad": 1},
        "quality": "bad",
    }
    # Should not crash; outputs remain valid CSV/JSON text
    assert isinstance(exports.events_csv(r), str)
    assert isinstance(exports.measurements_csv(r), str)
    assert isinstance(exports.findings_csv(r), str)
    assert isinstance(exports.session_csv(r), str)
    assert isinstance(exports.metrics_csv(r), str)
    assert isinstance(exports.stats_csv(r), str)
    paths = exports.write_all(r, str(tmp_path / "out"))
    for p in paths.values():
        assert __import__("pathlib").Path(p).exists()
    manifest = json.loads((tmp_path / "out" / "manifest.json").read_text())
    # manifest.json is provenance.manifest or {}; malformed string should not become text blob
    assert isinstance(manifest, dict)


def test_exports_handle_nonfinite_and_wrong_typed_nested_values():
    r = {
        "job_id": "j",
        "summary": {"events": 1, "confidence": float("nan"), "composite": None},
        "provenance": {},
        "events": [
            {
                "id": "e1", "index": 1, "type": "x", "t": float("inf"), "result": "unknown",
                "event_state": "confirmed", "confirmed": True, "score": float("nan"),
                "score_source": "pose", "coverage": "bad", "confidence": "bad",
                "pressure": 1, "tags": "bad", "feedback": 123,
                "measurements": [{"key": "k", "ideal": "bad", "source_frames": "bad", "source_t": "bad", "value": float("nan")}],
                "metrics": [{"key": "m", "ideal": "bad", "value": "bad"}],
                "matchup": {"opponent": {"metrics": [{"key": "o", "ideal": None, "value": None}] }},
            }
        ],
        "findings": [{"id": "f1", "start_ms": "bad", "end_ms": None, "confidence": "bad"}],
        "session_metrics": [{"key": "s", "value": float("inf")}],
        "stats": {"groups": [{"label": "G", "stats": [{"key": "k", "label": "L", "value": float("nan")}]}], "trend": {"delta": "bad"}, "unavailable": [{"label": "u", "reason": 1}]},
    }
    for fn in (exports.events_csv, exports.measurements_csv, exports.findings_csv, exports.session_csv, exports.metrics_csv, exports.stats_csv):
        text = fn(r)
        assert isinstance(text, str) and "job_id" in text.splitlines()[0]


def test_render_helpers_handle_malformed_summary_quality_failures_and_events():
    pack = _pack()
    frame = np.zeros((120, 90, 3), np.uint8)
    # malformed/mixed containers
    res = {
        "summary": "bad",
        "quality": "bad",
        "failures": "bad",
        "events": "bad",
        "session_metrics": "bad",
    }
    # reason/end cards should not crash on malformed summary/quality/failures
    reason = render._reason_card(frame, res, pack, 0.4, "No confirmed actions were detected in this clip.")
    end = render._end_card(frame, res, pack, 0.4)
    assert reason.shape == frame.shape and end.shape == frame.shape
    # HUD with malformed events container coerced via caller expectation? _hud takes events list
    hud = render._hud(pack, [], 1.0, None, 120, 0.5)
    assert hud[0].shape[1] == 120

    bad_event = {
        "index": "x", "type": 1, "result": 2, "score": "bad", "event_state": 3,
        "confirmed": "no", "confidence": "bad", "confidence_kind": 4, "feedback": 5,
        "quality": "bad", "metrics": "bad", "matchup": "bad",
    }
    sprite, alpha = render._banner(bad_event, 140, 0.4, max_h=120)
    assert sprite.shape[1] == 140 and alpha.shape[:2] == sprite.shape[:2]


def test_pipeline_and_judge_cache_helpers_are_defensive(tmp_path):
    bad = tmp_path / "j.json"
    bad.write_text("not json")
    assert pipeline._load_judgement(bad) is None
    bad.write_text(json.dumps(["not", "dict"]))
    assert pipeline._load_judgement(bad) is None
    bad.write_text(json.dumps({"verdicts": "bad"}))
    assert pipeline._load_judgement(bad) is None
    bad.write_text(json.dumps({"verdicts": {"a": {"x": 1}, "2": {"y": 2}}}))
    j = pipeline._load_judgement(bad)
    assert j is None or isinstance(j, Judgement)
    if j is not None:
        assert 2 in j.verdicts and "a" not in j.verdicts

    m = tmp_path / "m.json"
    m.write_text("not json")
    assert pipeline._read_matchups(m) is None
    m.write_text(json.dumps([1, 2]))
    assert pipeline._read_matchups(m) is None
    m.write_text(json.dumps({"bad": {"frames": []}}))
    out = pipeline._read_matchups(m)
    assert out is None or isinstance(out, dict)


def test_judge_rules_and_event_feedback_remain_honest_for_empty_candidates():
    pack = _pack()
    j = judge.rules([], pack, "no candidate moments")
    assert j.source == "rules"
    assert j.verdicts == {}
    # no events confirmed by rules fallback
    text = judge.event_feedback([], pack)
    assert isinstance(text, str) and text


def test_result_event_detection_missing_failures_container_and_malformed_entries():
    ed = result._event_detection([], Judgement(source="rules", sport="basketball"), failures_list=None)
    assert ed["candidate_count"] == 0
    assert ed["partial_review"] is False
    ed2 = result._event_detection([], Judgement(source="rules", sport="basketball"), failures_list=[None, "x", {"code": "F07_MISSED_CANDIDATE", "detail": "bad"}])
    assert ed2["candidate_count"] == 0
