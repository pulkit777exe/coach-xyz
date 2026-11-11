from __future__ import annotations

import numpy as np

from core import measure, render, result, sports
from core.judge import Judgement
from core.motion import Candidate
from core.track import Track
from core.video import Media


def _track():
    n = 20
    t = np.linspace(0, 2, n)
    lm = np.zeros((n, 33, 4), np.float32)
    lm[:, :, :2] = 0.5
    lm[:, :, 3] = 0.9
    box = np.tile([100, 50, 200, 300], (n, 1)).astype(np.float32)
    conf = np.full(n, 0.9, np.float32)
    return Track(t=t, lm=lm, box=box, conf=conf, width=640, height=360, rate=10.0)


def _build(judgement, events=None, cands=None):
    pack = sports.load("basketball")
    track = _track()
    media = Media(duration=2.0, fps=30.0, has_audio=False, codec="h264")
    return result.build(
        "job",
        {"angle": "side"},
        pack,
        track,
        media,
        cands or [],
        judgement,
        [],
        angle="side",
        angle_source="declared",
        failures_list=[],
    )


def test_fallback_summary_does_not_duplicate_kpis_or_tactical_text():
    judgement = Judgement(source="rules", sport="basketball", verdicts={}, reason="x")
    out = _build(judgement)
    summary = out["summary"]
    assert "Measured:" not in summary["text"]
    assert summary["tactical_summary"] == ""
    assert summary["text"] != ""


def test_model_summary_keeps_text_without_kpi_append_and_non_identical_tactical():
    judgement = Judgement(
        source="model",
        sport="basketball",
        verdicts={},
        summary="Clear release pattern.",
        tactical_summary="",
    )
    out = _build(judgement)
    summary = out["summary"]
    assert summary["text"] == "Clear release pattern."
    assert "Measured:" not in summary["text"]
    assert summary["tactical_summary"] != summary["text"]


def test_zero_event_summary_uses_tracking_confidence_label():
    judgement = Judgement(source="rules", sport="basketball", verdicts={})
    out = _build(judgement)
    assert out["summary"]["events"] == 0
    assert out["summary"]["confidence_kind"] == "tracking"
    assert out["summary"]["pose_confidence"] == out["summary"]["confidence"]


def test_composite_reports_scored_and_considered_event_counts():
    judgement = Judgement(source="rules", sport="basketball", verdicts={})
    out = _build(judgement)
    composite = out["summary"]["composite"]
    assert composite["scored_events"] == 0
    assert "considered_events" in composite
    assert composite["minimum_coverage"] == measure.MIN_MEASURED_COVERAGE


def test_render_fmt_adds_space_for_word_units():
    assert render._fmt(1.3, "torso") == "1.3 torso"
    assert render._fmt(90.0, "°") == "90°"
    assert render._fmt(10.0, "/10") == "10/10"


def test_confirmed_unscored_events_report_event_confidence_kind():
    from core.motion import Candidate

    pack = sports.load("basketball")
    track = _track()
    c = Candidate(5, 0.5, "right", 1.0)
    judgement = Judgement(
        source="rules",
        sport="basketball",
        verdicts={
            0: {
                "is_event": True,
                "state": "confirmed",
                "type": "three_pointer",
                "result": "unknown",
                "feedback": "",
                "confidence": 0.4,
                "ratings": {},
                "tags": [],
                "pressure": "unknown",
            }
        },
    )
    out = result.build(
        "job",
        {"angle": "side"},
        pack,
        track,
        Media(duration=2.0, fps=30.0, has_audio=False, codec="h264"),
        [c],
        judgement,
        [],
        angle="side",
        angle_source="declared",
        failures_list=[],
    )
    assert out["summary"]["events"] == 1
    assert out["summary"]["average_score"] is None
    assert out["summary"]["confidence_kind"] == "event"
    assert out["summary"]["pose_confidence"] == 0.9
    assert out["summary"]["confidence"] == out["events"][0]["confidence"]


def test_legacy_summary_keeps_confidence_fields_without_duplicates():
    from routes.legacy import legacy_summary

    out = _build(Judgement(source="rules", sport="basketball", verdicts={}))
    legacy = legacy_summary(out)
    assert legacy["confidence_kind"] == out["summary"]["confidence_kind"]
    assert legacy["pose_confidence"] == out["summary"]["pose_confidence"]
    assert list(legacy.keys()).count("confidence_kind") == 1
    assert list(legacy.keys()).count("pose_confidence") == 1


def test_reason_and_end_cards_keep_text_within_frame():
    from PIL import Image, ImageDraw

    pack = sports.load("basketball")
    out = _build(Judgement(source="rules", sport="basketball", verdicts={}))
    out["failures"] = [
        {"code": "F13_INSUFFICIENT_COVERAGE", "message": "coverage too low " * 20}
    ]
    frame = np.zeros((180, 240, 3), np.uint8)
    reason = render._reason_card(
        frame, out, pack, 0.6, "No confirmed actions were detected in this clip. " * 8
    )
    end = render._end_card(frame, out, pack, 0.6)
    assert reason.shape == frame.shape
    assert end.shape == frame.shape
    # bottom margin region should remain part of the composed card (no out-of-bounds draw errors)
    assert reason.dtype == np.uint8 and end.dtype == np.uint8


def test_hud_sprite_stays_single_line_when_compacted():
    pack = sports.load("basketball")
    sprite, alpha = render._hud(pack, [], 12.3, None, 90, 1.0)
    assert sprite.shape[0] > 0 and sprite.shape[1] == 90
    # no-wrap HUD should not grow tall from wrapped lines
    assert sprite.shape[0] < 60
    assert alpha.shape[:2] == sprite.shape[:2]

import tempfile

from core import judge, video
from core.judge import Review, Verdict
from core.motion import Candidate
from core.sports import Pack


class _Model:
    def __init__(self, count=1):
        self.count = count

    def video_part(self, path, fps):
        return object(), None

    def drop_file(self, name):
        pass

    def structured(self, contents, schema, system=None, video=False):
        events = [
            Verdict(
                candidate=n,
                is_event=True,
                event_type="three_pointer",
                result="made",
                ratings=[],
                feedback="ok",
                confidence=0.9,
            )
            for n in range(1, self.count + 1)
        ]
        return "fake-model", Review(
            sport="basketball",
            events=events,
            summary="Solid session.",
            strengths=[],
            focus_areas=[],
            priority_drill="",
        )


def test_unshown_candidates_remain_unreviewed_and_emit_f07(monkeypatch, tmp_path):
    track = _track()
    pack = sports.load("basketball")
    cands = [Candidate(5, 0.5, "right", 1.0), Candidate(10, 1.0, "right", 0.8)]
    measured = [{"criteria": []}, {"criteria": []}]

    monkeypatch.setattr(video, "build_proxy", lambda *a, **k: [video.Segment(0.0, 0.0, 2.0)])

    def fake_to_reel(segments, t):
        return 0.5 if abs(t - 0.5) < 1e-6 else None

    monkeypatch.setattr(video, "to_reel", fake_to_reel)
    out = judge.review(
        track,
        cands,
        measured,
        pack,
        str(tmp_path / "x.mp4"),
        sport_known=True,
        make_llm=lambda: _Model(count=1),
        workdir=str(tmp_path),
    )
    assert out.verdicts[0]["state"] in ("confirmed", "uncertain")
    assert out.verdicts[1]["state"] == "candidate"
    assert out.verdicts[1]["is_event"] is True
    assert any(f["code"] == "F07_MISSED_CANDIDATE" for f in out.failures)


def test_matchup_primary_metrics_not_overwritten_when_not_tracked():
    pack = sports.load("basketball")
    track = _track()
    c = Candidate(5, 0.5, "right", 1.0)
    judgement = Judgement(
        source="rules",
        sport="basketball",
        verdicts={
            0: {
                "is_event": True,
                "state": "confirmed",
                "type": "three_pointer",
                "result": "made",
                "feedback": "",
                "confidence": 0.5,
                "ratings": {},
                "tags": [],
                "pressure": "unknown",
            }
        },
    )
    matchups = {
        5: {
            "roles": {"primary": "Ball handler", "opponent": "Defender"},
            "primary": {"role": "Ball handler", "tracked": False, "metrics": [{"value": 123}]},
            "opponent": None,
            "frames": [],
        }
    }
    evs = result._events("j", track, [c], judgement, pack, "side", matchups=matchups)
    assert evs[0]["matchup"]["primary"]["metrics"] == [{"value": 123}]


def test_long_clip_window_omission_keeps_unseen_candidates_unreviewed(video, monkeypatch, tmp_path):
    from core import config, judge, pipeline, sports, video as core_video
    from core.track import Lock

    # Real proxy/reel path: force a tiny window budget so only a subset of spaced
    # candidate windows is copied into the review clip.
    monkeypatch.setattr(config.settings, "proxy_max_s", 4.0)
    monkeypatch.setattr(config.settings, "proxy_fps", 5)

    detector = pipeline.make_detector()
    try:
        track = pipeline.track_athlete(str(video), detector, Lock(None), rate=12)
    finally:
        close = getattr(detector, "close", None)
        if callable(close):
            close()
    pack = sports.load("basketball")
    dur = float(track.t[-1])
    cands = [
        Candidate(i=0, t=0.8, side="right", strength=1.0),
        Candidate(i=min(len(track.t) // 2, len(track.t) - 1), t=max(0.8, dur / 2), side="right", strength=0.6),
        Candidate(i=len(track.t) - 1, t=max(0.8, dur - 0.8), side="right", strength=0.4),
    ]
    # Ensure distinct, in-range times.
    for c in cands:
        c.t = float(np.clip(c.t, 0.1, max(0.1, dur - 0.1)))
    measured = [{"criteria": []} for _ in cands]

    segments = core_video.build_proxy(
        str(video),
        str(tmp_path / "probe.mp4"),
        box_at=track.box_at,
        marks=[(c.t - 1.0, c.t + 0.8, f"#{n}") for n, c in enumerate(cands, 1)],
        windows=judge._windows(track, cands),
        fps=config.settings.proxy_fps,
        cancelled=lambda: None,
    )
    shown = [i for i, c in enumerate(cands) if core_video.to_reel(segments, c.t) is not None]
    assert shown, "expected at least one candidate in the review clip"
    assert len(shown) < len(cands), "expected window omission to leave a candidate unseen"

    class _ShownModel(_Model):
        def __init__(self, indices):
            super().__init__(count=len(indices))
            self.indices = indices

        def structured(self, contents, schema, system=None, video=False):
            events = [
                Verdict(
                    candidate=n + 1,
                    is_event=True,
                    event_type="three_pointer",
                    result="made",
                    ratings=[],
                    feedback="ok",
                    confidence=0.9,
                )
                for n in self.indices
            ]
            return "fake-model", Review(
                sport="basketball",
                events=events,
                summary="Solid session.",
                strengths=[],
                focus_areas=[],
                priority_drill="",
            )

    out = judge.review(
        track,
        cands,
        measured,
        pack,
        str(video),
        sport_known=True,
        make_llm=lambda: _ShownModel(shown),
        workdir=str(tmp_path),
    )

    unseen = [i for i in range(len(cands)) if i not in shown]
    for i in unseen:
        assert out.verdicts[i]["state"] == "candidate"
        assert out.verdicts[i]["is_event"] is True
        assert "unreviewed candidate" in out.verdicts[i]["feedback"]
    # Unseen moments must never be rejected by omission; shown moments may be judged.
    assert all(out.verdicts[i]["state"] != "rejected" for i in unseen)
    assert all(out.verdicts[i]["state"] != "candidate" for i in shown)

    f07 = [f for f in out.failures if f["code"] == "F07_MISSED_CANDIDATE"]
    assert f07
    assert sorted(f07[0].get("detail", {}).get("unseen_candidates", [])) == sorted(unseen)


def test_identity_switch_failure_includes_reacquisition_context():
    import numpy as np

    from core import people, track as track_mod

    class _Det:
        pass

    frame = np.zeros((100, 100, 3), np.uint8)
    person = people.Person(np.zeros((33, 4), np.float32), np.array([10, 10, 30, 30], np.float32), 0.9)
    person.lm[0, 3] = 1.0

    orig_find = people.find_people
    orig_sig = people.signature
    orig_sim = people.similarity
    try:
        people.find_people = lambda detector, frame, max_people=8: [person]
        people.signature = lambda frame, box: np.ones(4, np.float32)
        people.similarity = lambda a, b: 0.05
        events = []
        out = track_mod._find(
            _Det(),
            frame,
            3.25,
            track_mod.Lock(signature=np.ones(4, np.float32), box=(50, 50, 70, 70), at=0.0),
            None,
            events=events,
        )
        assert out is None
        assert len(events) == 1
        ev = events[0]
        assert ev["code"] == "F02_IDENTITY_SWITCH"
        assert ev["similarity"] == 0.05
        assert ev["threshold"] == 0.15
        assert ev["reacquired"] is False
        assert "similarity 0.05" in ev["message"]
        assert "3.25s" in ev["message"]
    finally:
        people.find_people = orig_find
        people.signature = orig_sig
        people.similarity = orig_sim


def test_partial_review_state_is_honest_in_result_payload():
    from core.motion import Candidate

    pack = sports.load("basketball")
    track = _track()
    cands = [Candidate(5, 0.5, "right", 1.0), Candidate(10, 1.0, "right", 0.8)]
    judgement = Judgement(
        source="model",
        sport="basketball",
        verdicts={
            0: {
                "is_event": True,
                "state": "confirmed",
                "type": "three_pointer",
                "result": "made",
                "feedback": "ok",
                "confidence": 0.9,
                "ratings": {},
                "tags": [],
                "pressure": "unknown",
            },
            1: {
                "is_event": True,
                "state": "candidate",
                "type": "three_pointer",
                "result": "unknown",
                "feedback": "This moment was not shown in the model review clip; it remains an unreviewed candidate.",
                "confidence": 0.0,
                "ratings": {},
                "tags": ["unreviewed"],
                "pressure": "unknown",
            },
        },
        failures=[
            {
                "code": "F07_MISSED_CANDIDATE",
                "stage": "judge",
                "message": "1 of 2 candidate moment(s) were not shown to the model for review",
                "retryable": False,
                "detail": {"unseen_candidates": [1], "unseen_count": 1, "shown_count": 1, "candidate_count": 2},
            }
        ],
    )
    out = result.build(
        "job",
        {"angle": "side"},
        pack,
        track,
        Media(duration=2.0, fps=30.0, has_audio=False, codec="h264"),
        cands,
        judgement,
        [],
        angle="side",
        angle_source="declared",
        failures_list=list(judgement.failures),
    )
    assert out["event_detection"]["partial_review"] is True
    assert out["event_detection"]["unseen_candidates"] == [1]
    assert out["event_detection"]["unseen_candidate_count"] == 1
    assert out["quality"]["partial_review"] is True
    assert "partial_review" in out["quality"]["issues"]
    ev = next(e for e in out["events"] if e["index"] == 2)
    assert ev["event_state"] == "candidate"
    assert ev["confirmed"] is False
    assert "unreviewed candidate" in ev["feedback"]


def test_banner_and_cards_prioritize_honesty_on_dense_extreme_frames():
    import numpy as np
    from PIL import Image

    pack = sports.load("basketball")
    # dense banner content including uncertain/unreviewed state and confidence
    e = {
        "id": "j:e1",
        "index": 1,
        "type": "three_pointer",
        "result": "unknown",
        "score": None,
        "event_state": "candidate",
        "confirmed": False,
        "confidence": 0.0,
        "confidence_kind": "event",
        "feedback": "This moment was not shown in the model review clip; it remains an unreviewed candidate. " * 4,
        "matchup": {
            "roles": {"primary": "Ball handler", "opponent": "Defender"},
            "primary": {"metrics": [{"label": "Elbow angle", "value": 91.2, "unit": "°", "score": 0.7}]},
            "opponent": {"role": "Defender", "metrics": [{"label": "Contest", "value": 1.1, "unit": "torso"}]},
            "separation": {"distance": 1.4, "side": "left"},
        },
        "metrics": [{"label": "Release", "value": 42.0, "unit": "°", "score": 0.8}],
        "quality": {"needs_review": True},
    }
    sprite, alpha = render._banner(e, 180, 0.5, max_h=120)
    assert sprite.shape[1] == 180
    assert sprite.shape[0] <= 120
    # rendered text pixels should include non-background content (honesty cues present in sprite)
    assert alpha.max() > 0

    out = _build(Judgement(source="rules", sport="basketball", verdicts={}))
    out["quality"]["issues"] = ["no_events", "low_track_coverage", "partial_review"]
    out["quality"]["partial_review"] = True
    out["failures"] = [
        {"code": "F07_MISSED_CANDIDATE", "message": "1 of 4 candidate moment(s) were not shown to the model for review"},
        {"code": "F13_INSUFFICIENT_COVERAGE", "message": "athlete track coverage was below the minimum confidence threshold"},
        {"code": "F02_IDENTITY_SWITCH", "message": "low-similarity reacquisition while athlete was lost (similarity 0.05 < 0.15 at 3.25s)"},
    ]
    out["summary"]["confidence_kind"] = "tracking"
    out["summary"]["confidence"] = 0.42
    # extreme/narrow portrait frame
    frame = np.zeros((360, 120, 3), np.uint8)
    reason = render._reason_card(frame, out, pack, 0.45, "No confirmed actions were detected in this clip.")
    end = render._end_card(frame, out, pack, 0.45)
    assert reason.shape == frame.shape and end.shape == frame.shape
    # ensure cards drew into the image (not all black)
    assert reason.mean() > 0 and end.mean() > 0


def test_long_media_multicandidate_review_and_render_honesty(tmp_path, monkeypatch):
    """Integration-style: longer multi-window review path with omission + rendered honesty."""
    import cv2
    import numpy as np

    from core import config, judge, sports, video as core_video
    from core.judge import Review, Verdict
    from core.video import FFmpegWriter

    # Longer synthetic clip so multiple spaced candidate windows cannot all fit in review proxy.
    path = str(tmp_path / "long.mp4")
    w, h, fps, seconds = 480, 270, 12, 20
    with FFmpegWriter(path, w, h, fps) as wr:
        for i in range(fps * seconds):
            t = i / fps
            img = np.full((h, w, 3), 50, np.uint8)
            x = int(40 + (w - 80) * (t / seconds))
            cv2.circle(img, (x, h // 2), 18, (40, 40, 220), -1)
            wr.write(img)

    monkeypatch.setattr(config.settings, "proxy_max_s", 4.0)
    monkeypatch.setattr(config.settings, "proxy_fps", 5)

    track = _track()
    # Stretch track timeline to represent a longer clip with spaced candidates.
    n = len(track.t)
    track.t = np.linspace(0.0, float(seconds), n)
    pack = sports.load("basketball")
    cands = [
        Candidate(i=1, t=1.5, side="right", strength=1.0),
        Candidate(i=4, t=5.0, side="right", strength=0.95),
        Candidate(i=7, t=9.0, side="right", strength=0.9),
        Candidate(i=10, t=13.0, side="right", strength=0.85),
        Candidate(i=13, t=16.5, side="right", strength=0.8),
    ]
    measured = [{"criteria": []} for _ in cands]

    # Deterministic multi-window omission: only first two candidate windows are included.
    def fake_build_proxy(src, dst, *, box_at, marks, windows, fps, cancelled, max_s=None):
        # create a tiny placeholder proxy file; fake model ignores actual video content
        with FFmpegWriter(dst, w, h, fps) as wr:
            for _ in range(max(1, int(fps * 2))):
                wr.write(np.full((h, w, 3), 40, np.uint8))
        return [
            core_video.Segment(src_start=0.0, reel_start=0.0, duration=3.0),
            core_video.Segment(src_start=4.0, reel_start=3.0, duration=3.0),
        ]

    monkeypatch.setattr(core_video, "build_proxy", fake_build_proxy)
    shown = [i for i, c in enumerate(cands) if core_video.to_reel(
        [
            core_video.Segment(src_start=0.0, reel_start=0.0, duration=3.0),
            core_video.Segment(src_start=4.0, reel_start=3.0, duration=3.0),
        ],
        c.t,
    ) is not None]
    assert shown == [0, 1], "expected deterministic omission leaving later candidates unseen"
    assert len(shown) < len(cands)

    class _PartialModel:
        def video_part(self, p, fps):
            return object(), None

        def drop_file(self, name):
            pass

        def structured(self, contents, schema, system=None, video=False):
            # Review only shown moments in order; unseen must remain unreviewed candidates.
            events = []
            for idx in shown[:2]:
                events.append(
                    Verdict(
                        candidate=idx + 1,
                        is_event=True,
                        event_type="three_pointer",
                        result="made",
                        ratings=[],
                        feedback="ok",
                        confidence=0.88,
                    )
                )
            return "fake-model", Review(
                sport="basketball",
                events=events,
                summary="Partial review.",
                strengths=[],
                focus_areas=[],
                priority_drill="",
            )

    out_judge = judge.review(
        track,
        cands,
        measured,
        pack,
        path,
        sport_known=True,
        make_llm=lambda: _PartialModel(),
        workdir=str(tmp_path),
    )
    f07 = [f for f in out_judge.failures if f["code"] == "F07_MISSED_CANDIDATE"]
    assert f07
    detail = f07[0].get("detail") or {}
    unseen = set(detail.get("unseen_candidates") or [])
    assert unseen
    assert all(out_judge.verdicts[i]["state"] == "candidate" for i in unseen)
    assert all(out_judge.verdicts[i]["is_event"] is True for i in unseen)
    assert all("unreviewed candidate" in (out_judge.verdicts[i].get("feedback") or "") for i in unseen)
    assert all(out_judge.verdicts[i]["state"] != "rejected" for i in unseen)

    res = result.build(
        "job-long",
        {"angle": "side"},
        pack,
        track,
        Media(duration=float(seconds), fps=float(fps), has_audio=False, codec="h264"),
        cands,
        out_judge,
        [],
        angle="side",
        angle_source="declared",
        failures_list=list(out_judge.failures),
    )
    assert res["event_detection"]["partial_review"] is True
    assert res["event_detection"]["unseen_candidate_count"] == len(unseen)
    assert "partial_review" in res["quality"]["issues"]
    for ev in res["events"]:
        if ev["index"] - 1 in unseen:
            assert ev["event_state"] == "candidate"
            assert ev["confirmed"] is False

    # Rendered honesty outputs must remain legible on dense/extreme frames with failure context.
    frame = np.zeros((220, 120, 3), np.uint8)
    reason = render._reason_card(
        frame,
        res,
        pack,
        0.45,
        "Actions were found but review was partial; some moments remain unreviewed.",
    )
    end = render._end_card(frame, res, pack, 0.45)
    assert reason.shape == frame.shape and end.shape == frame.shape
    assert reason.mean() > 0 and end.mean() > 0
    # Empty/no-confirmed render path should also produce an honesty card video.
    out_vid = str(tmp_path / "empty.mp4")
    thumbs = render.render_empty(path, res, pack, out_vid, Media(duration=float(seconds), fps=float(fps), has_audio=False, codec="h264"), reason="Actions were found but review was partial; some moments remain unreviewed.")
    assert thumbs == []
    assert (tmp_path / "empty.mp4").exists()


def test_f07_detail_includes_unseen_times_and_partial_review_payload():
    pack = sports.load("basketball")
    track = _track()
    cands = [Candidate(4, 0.4, "right", 1.0), Candidate(9, 0.9, "right", 0.8), Candidate(14, 1.4, "right", 0.7)]
    judgement = Judgement(
        source="model",
        sport="basketball",
        verdicts={
            0: {"is_event": True, "state": "confirmed", "type": "three_pointer", "result": "made", "feedback": "ok", "confidence": 0.9, "ratings": {}, "tags": [], "pressure": "unknown"},
            1: {"is_event": True, "state": "candidate", "type": "three_pointer", "result": "unknown", "feedback": "unreviewed", "confidence": 0.0, "ratings": {}, "tags": ["unreviewed"], "pressure": "unknown"},
            2: {"is_event": True, "state": "candidate", "type": "three_pointer", "result": "unknown", "feedback": "unreviewed", "confidence": 0.0, "ratings": {}, "tags": ["unreviewed"], "pressure": "unknown"},
        },
        failures=[{
            "code": "F07_MISSED_CANDIDATE",
            "stage": "judge",
            "message": "2 of 3 candidate moment(s) were not shown to the model for review",
            "retryable": False,
            "detail": {
                "unseen_candidates": [1, 2],
                "unseen_candidate_times": [0.9, 1.4],
                "unseen_count": 2,
                "shown_count": 1,
                "candidate_count": 3,
                "partial_review": True,
            },
        }],
    )
    out = result.build("job", {"angle": "side"}, pack, track, Media(duration=2.0, fps=30.0, has_audio=False, codec="h264"), cands, judgement, [], angle="side", angle_source="declared", failures_list=list(judgement.failures))
    ed = out["event_detection"]
    assert ed["partial_review"] is True
    assert ed["unseen_candidates"] == [1, 2]
    assert ed["unseen_candidate_times"] == [0.9, 1.4]
    assert out["quality"]["partial_review"] is True
    assert "partial_review" in out["quality"]["issues"]
    assert all(e["event_state"] != "rejected" for e in out["events"] if e["index"] in (2, 3))


def test_render_empty_and_banner_extreme_dense_frames_prioritize_honesty(tmp_path):
    pack = sports.load("basketball")
    res = _build(Judgement(source="rules", sport="basketball", verdicts={}))
    res["quality"]["issues"] = ["no_events", "partial_review"]
    res["quality"]["partial_review"] = True
    res["failures"] = [
        {"code": "F07_MISSED_CANDIDATE", "message": "2 of 5 candidate moment(s) were not shown to the model for review"},
        {"code": "F02_IDENTITY_SWITCH", "message": "low-similarity reacquisition while athlete was lost (similarity 0.05 < 0.15 at 3.25s)"},
    ]
    res["summary"]["confidence_kind"] = "tracking"
    res["summary"]["confidence"] = 0.31
    frame = np.zeros((220, 90, 3), np.uint8)
    reason = render._reason_card(frame, res, pack, 0.35, "No confirmed actions were detected in this clip.")
    assert reason.shape == frame.shape and reason.mean() > 0
    # render_empty path (end-of-clip honesty card video) on tiny/extreme source frame
    src = str(tmp_path / "src.mp4")
    import cv2
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    vw = cv2.VideoWriter(src, fourcc, 10.0, (90, 220))
    for _ in range(5):
        vw.write(np.zeros((220, 90, 3), np.uint8))
    vw.release()
    out_path = str(tmp_path / "out.mp4")
    thumbs = render.render_empty(src, res, pack, out_path, Media(duration=0.5, fps=10.0, has_audio=False, codec="h264"), reason="No confirmed actions were detected in this clip.")
    assert thumbs == []
    assert (tmp_path / "out.mp4").exists()
    # dense banner in narrow/short space keeps honesty cues and stays bounded
    e = {
        "index": 1, "type": "layup", "result": "unknown", "score": None,
        "event_state": "candidate", "confirmed": False, "confidence": 0.0,
        "confidence_kind": "event", "feedback": "Unreviewed candidate. " * 12,
        "quality": {"needs_review": True}, "metrics": [{"label": "Knee", "value": 88, "unit": "°", "score": 0.6}],
        "matchup": {"primary": {"metrics": [{"label": "Knee", "value": 88, "unit": "°", "score": 0.6}]}, "roles": {"primary": "Athlete"}},
    }
    sprite, _ = render._banner(e, 120, 0.35, max_h=90)
    assert sprite.shape[1] == 120 and sprite.shape[0] <= 90 and sprite.mean() > 0
