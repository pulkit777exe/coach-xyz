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
