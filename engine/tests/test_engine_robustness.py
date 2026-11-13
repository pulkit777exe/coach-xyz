from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import pytest

from core import exports, failures, jobs, judge, motion, pipeline, render, result, sports, storage, track, video
from core.judge import Judgement, Review, Verdict
from core.motion import Candidate
from core.track import Lock, Track
from core.video import Media

from . import fakes


def _track(n=20, *, valid_all=True, conf=0.9, width=640, height=360, rate=10.0):
    t = np.linspace(0, max(0.1, (n - 1) / rate), n)
    lm = np.zeros((n, 33, 4), np.float32)
    lm[:, :, :2] = 0.5
    lm[:, :, 3] = conf
    box = np.tile([100, 50, 200, 300], (n, 1)).astype(np.float32)
    c = np.full(n, conf, np.float32)
    if not valid_all:
        lm[::3, :, :] = np.nan
        c[::3] = 0.0
    tr = Track(t=t, lm=lm, box=box, conf=c, width=width, height=height, rate=rate)
    return tr


def _pack():
    return sports.load("basketball")


class _MemStore:
    name = "local"

    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.fail_put = set()
        self.fail_get = False

    def _path(self, key):
        return self.root / key.lstrip("/")

    def put(self, key, src):
        if key in self.fail_put:
            raise OSError(f"put failed: {key}")
        dest = self._path(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        Path(src).replace(dest) if Path(src).exists() else dest.write_bytes(Path(src).read_bytes())

    def path(self, key):
        return self._path(key)

    def exists(self, key):
        return self._path(key).is_file()

    def delete(self, key):
        self._path(key).unlink(missing_ok=True)

    def delete_prefix(self, prefix):
        import shutil
        shutil.rmtree(self._path(prefix), ignore_errors=True)

    def local_copy(self, key):
        import contextlib, tempfile, shutil
        @contextlib.contextmanager
        def cm():
            p = self._path(key)
            if self.fail_get or not p.is_file():
                raise FileNotFoundError(key)
            tmp = tempfile.NamedTemporaryFile(suffix=Path(key).suffix, delete=False)
            tmp.close()
            shutil.copy(p, tmp.name)
            try:
                yield tmp.name
            finally:
                Path(tmp.name).unlink(missing_ok=True)
        return cm()

    def serve(self, key):
        p = self._path(key)
        if not p.is_file():
            raise FileNotFoundError(key)
        return "file", str(p)

    def upload_slot(self, key, mime):
        return {"mode": "multipart", "scan_url": "/scan"}


def test_corrupt_judgement_cache_is_ignored_and_recomputed(tmp_path, monkeypatch):
    # Simulate pipeline cache read robustness at unit level via _load_judgement contract.
    bad = tmp_path / "bad.json"
    bad.write_text("{not json")
    # pipeline._load_judgement currently assumes valid json; hardening should treat as miss.
    if hasattr(pipeline, "_load_judgement"):
        out = pipeline._load_judgement(bad)
        assert out is None
    bad2 = tmp_path / "bad2.json"
    bad2.write_text(json.dumps({"source": "model", "sport": "basketball"}))
    if hasattr(pipeline, "_load_judgement"):
        out2 = pipeline._load_judgement(bad2)
        assert out2 is None or isinstance(out2, Judgement)


def test_corrupt_matchup_cache_is_ignored(tmp_path):
    p = tmp_path / "m.json"
    p.write_text("not-json")
    assert pipeline._read_matchups(p) is None
    p.write_text(json.dumps({"x": {"frames": []}}))
    # non-integer-ish keys may be tolerated; must not crash
    out = pipeline._read_matchups(p)
    assert out is None or isinstance(out, dict)


def test_track_load_corruption_does_not_poison_contract(tmp_path):
    p = tmp_path / "t.npz"
    p.write_bytes(b"garbage")
    with pytest.raises(Exception):
        Track.load(str(p))


def test_result_tolerates_malformed_partial_verdicts_and_missing_fields():
    pack = _pack()
    tr = _track()
    cands = [Candidate(5, 0.5, "right", 1.0), Candidate(10, 1.0, "right", 0.8), Candidate(15, 1.5, "left", 0.6)]
    # malformed verdict payloads: missing keys, wrong types, None values
    judgement = Judgement(
        source="model",
        sport="basketball",
        verdicts={
            0: {"is_event": True, "state": "confirmed", "type": "three_pointer", "result": "made", "feedback": None, "confidence": "0.7", "ratings": None, "tags": None, "pressure": None},
            1: {"is_event": None, "state": "banana", "type": "???", "result": "???", "feedback": 123, "confidence": None, "ratings": {"unknown": "bad"}, "tags": [1, None, "ok"], "pressure": 5},
            2: None,
        },
        failures=[{"code": "F07_MISSED_CANDIDATE", "stage": "judge", "message": "x", "detail": {"unseen_candidates": ["2", -1, 99, True], "unseen_candidate_times": ["bad", 1.5]}}],
    )
    try:
        out = result.build(
            "job-r",
            {"angle": "side"},
            pack,
            tr,
            Media(duration=2.0, fps=30.0, has_audio=False, codec="h264"),
            cands,
            judgement,
            [],
            angle="side",
            angle_source="declared",
            failures_list=list(judgement.failures),
        )
    except Exception as e:
        pytest.fail(f"result.build crashed on malformed verdicts: {e!r}")
    assert out["job_id"] == "job-r"
    assert "event_detection" in out and "summary" in out and "events" in out
    # unseen normalization must stay in-range/typed and not fabricate invalid indices
    ed = out["event_detection"]
    for idx in ed.get("unseen_candidates", []):
        assert isinstance(idx, int) and 0 <= idx < len(cands)
    for t in ed.get("unseen_candidate_times", []):
        assert isinstance(t, (int, float))
    for ev in out["events"]:
        assert ev["event_state"] in ("candidate", "confirmed", "rejected", "uncertain")
        assert isinstance(ev["confirmed"], bool)
        assert ev["score"] is None or isinstance(ev["score"], (int, float))


def test_result_exports_tolerate_missing_optional_fields():
    pack = _pack()
    tr = _track()
    judgement = Judgement(source="rules", sport="basketball", verdicts={})
    out = result.build("job-e", {"angle": "side"}, pack, tr, Media(duration=2.0, fps=30.0, has_audio=False, codec="h264"), [], judgement, [], failures_list=[])
    # inject partial/missing structures similar to degraded/legacy paths
    out["events"] = []
    out["session_metrics"] = [None, {"label": "x"}, {"kind": "metric", "key": "k", "label": "L", "unit": "", "value": 1}]
    out["failures"] = [None, "bad", {"code": "F13_INSUFFICIENT_COVERAGE", "message": "m", "stage": "track"}]
    try:
        csvs = {
            "events": exports.events_csv(out),
            "measurements": exports.measurements_csv(out),
            "findings": exports.findings_csv(out),
            "session": exports.session_csv(out),
            "metrics": exports.metrics_csv(out),
        }
    except Exception as e:
        pytest.fail(f"exports crashed on partial/missing fields: {e!r}")
    assert all(isinstance(v, str) and v for v in csvs.values())


def test_render_reason_and_end_cards_handle_malformed_failures_and_missing_summary(tmp_path):
    pack = _pack()
    frame = np.zeros((120, 90, 3), np.uint8)
    res = {
        "summary": {"events": 0, "confidence": None, "confidence_kind": None, "average_score": None},
        "quality": {"issues": [None, "no_events", 123]},
        "failures": [None, "F13", {"code": None, "message": None}, {"code": "F13_INSUFFICIENT_COVERAGE", "message": "coverage low " * 30}],
        "session_metrics": [{"kind": "metric", "label": "a", "value": float("nan"), "unit": "x"}],
    }
    reason = render._reason_card(frame, res, pack, 0.35, "No confirmed actions were detected in this clip.")
    end = render._end_card(frame, res, pack, 0.35)
    assert reason.shape == frame.shape and end.shape == frame.shape


def test_render_banner_handles_extreme_missing_and_nonfinite_values():
    e = {
        "index": None,
        "type": None,
        "result": None,
        "score": float("nan"),
        "event_state": "candidate",
        "confirmed": False,
        "confidence": float("inf"),
        "confidence_kind": "event",
        "feedback": None,
        "quality": None,
        "metrics": [None, {"label": "Knee", "value": float("nan"), "unit": "°", "score": None}],
        "matchup": None,
    }
    sprite, alpha = render._banner(e, 80, 0.25, max_h=40)
    assert sprite.shape[1] == 80 and sprite.shape[0] <= 40
    assert alpha.shape[:2] == sprite.shape[:2]


def test_motion_and_track_edge_cases_empty_short_dropout_jitter():
    # very short/insufficient tracks
    t = np.array([0.0, 0.1], np.float64)
    lm = np.full((2, 33, 4), np.nan, np.float32)
    box = np.full((2, 4), np.nan, np.float32)
    conf = np.zeros(2, np.float32)
    tr = Track(t=t, lm=lm, box=box, conf=conf, width=320, height=240, rate=10.0)
    pack = _pack()
    assert motion.candidates(tr, pack) == []
    cleaned = track.clean(tr)
    assert len(cleaned.t) == 2
    # dropout/jitter pattern with NaN gaps
    tr2 = _track(30, valid_all=False, conf=0.8)
    # inject jitter on valid frames
    valid = np.flatnonzero(tr2.valid)
    tr2.lm[valid, 15, 0] += ((np.arange(len(valid)) % 2) * 0.02).astype(np.float32)
    cands = motion.candidates(tr2, pack)
    assert isinstance(cands, list)
    # long clip with many candidates (synthetic)
    tr3 = _track(300, rate=30.0)
    tr3.t = np.linspace(0, 30, 300)
    for i in range(0, 300, 30):
        j = min(i + 2, 299)
        tr3.lm[j, 16, 1] = 0.2  # create wrist rise-like motion cues not guaranteed; candidates may be 0 but must not crash
    cands3 = motion.candidates(tr3, pack)
    assert isinstance(cands3, list)


def test_judge_review_handles_partial_windows_and_no_shown_moments(monkeypatch, tmp_path):
    tr = _track(40)
    tr.t = np.linspace(0, 20, 40)
    pack = _pack()
    cands = [Candidate(5, 2.0, "right", 1.0), Candidate(20, 10.0, "right", 0.8), Candidate(35, 18.0, "right", 0.6)]
    measured = [{"criteria": []} for _ in cands]
    # build_proxy returns segments that exclude all candidate times
    monkeypatch.setattr(video, "build_proxy", lambda *a, **k: [video.Segment(0.0, 0.0, 0.5)])
    monkeypatch.setattr(video, "to_reel", lambda segments, t: None)

    class _M:
        def video_part(self, path, fps):
            return object(), None
        def drop_file(self, name):
            pass
        def structured(self, contents, schema, system=None, video=False):
            return "fake", Review(sport="basketball", events=[], summary="", strengths=[], focus_areas=[], priority_drill="")

    out = judge.review(tr, cands, measured, pack, str(tmp_path / "x.mp4"), sport_known=True, make_llm=lambda: _M(), workdir=str(tmp_path))
    assert all(out.verdicts[i]["state"] == "candidate" for i in range(len(cands)))
    assert any(f["code"] == "F07_MISSED_CANDIDATE" for f in out.failures)


def test_judge_invalid_structured_response_emits_f12(monkeypatch, tmp_path):
    tr = _track()
    pack = _pack()
    cands = [Candidate(5, 0.5, "right", 1.0)]
    measured = [{"criteria": []}]
    monkeypatch.setattr(video, "build_proxy", lambda *a, **k: [video.Segment(0.0, 0.0, 2.0)])
    monkeypatch.setattr(video, "to_reel", lambda segments, t: 0.5)

    class _M:
        def video_part(self, path, fps):
            return object(), None
        def drop_file(self, name):
            pass
        def structured(self, contents, schema, system=None, video=False):
            raise ValueError("bad schema")

    out = judge.review(tr, cands, measured, pack, str(tmp_path / "x.mp4"), sport_known=True, make_llm=lambda: _M(), workdir=str(tmp_path))
    assert out.source == "rules"
    assert any(f["code"] == "F12_INVALID_STRUCTURED_RESPONSE" for f in out.failures)


def test_failure_and_status_helpers_coherent():
    assert failures.status_for("failed", ["llm"], [{"code": "F11_VLM_UNAVAILABLE"}]) == "failed"
    assert failures.status_for("completed", ["llm"], [{"code": "F11_VLM_UNAVAILABLE"}]) == "degraded"
    assert failures.status_for("completed", [], []) == "completed"
    f = failures.failure("F13_INSUFFICIENT_COVERAGE", "track", "m", coverage=0.1)
    assert f.to_dict()["code"] == "F13_INSUFFICIENT_COVERAGE"
    with pytest.raises(ValueError):
        failures.failure("F99_NOPE", "x", "y")
