import asyncio
import json
import time

import httpx
import numpy as np
import pytest
from google.genai import errors

from core import (
    config, db, events, geometry as g, judge, llm, measure, metrics, motion, performance, result, sessions,
    sports, storage,
)
from core.judge import Judgement
from core.motion import Candidate
from core.sports import Criterion, MetricDef
from core.track import Track, clean
from core.video import Media


def pose(**pts) -> np.ndarray:
    lm = np.zeros((33, 4), np.float32)
    lm[:, :2], lm[:, 3] = 0.5, 1.0
    for name, (x, y) in pts.items():
        lm[int(name[1:])] = [x, y, 0, 1.0]
    return lm


# -- geometry ---------------------------------------------------------------

def test_angles_are_measured_in_pixels_not_normalized_units():
    lm = pose(i11=(0.5, 0.3), i13=(0.5, 0.5), i15=(0.7, 0.3))
    angle, conf = g.metric("left_elbow_angle", lm, 1920, 1080)
    assert angle == pytest.approx(60.6, abs=0.2)  # 45 if aspect ratio were ignored
    assert conf == 1.0


def test_hidden_joints_are_not_reported():
    lm = pose(i11=(0.5, 0.3), i13=(0.5, 0.5), i15=(0.7, 0.3))
    lm[15, 3] = 0.1
    assert g.metric("left_elbow_angle", lm, 1920, 1080) is None


def test_side_less_metrics_follow_the_active_side_or_average_both():
    lm = pose(i12=(0.5, 0.3), i14=(0.5, 0.5), i16=(0.7, 0.5), i23=(0.5, 0.5), i25=(0.5, 0.7), i27=(0.5, 0.9),
              i24=(0.5, 0.5), i26=(0.6, 0.7), i28=(0.5, 0.9))
    right = g.metric("elbow_angle", lm, 1000, 1000, "right")[0]
    assert right == pytest.approx(90, abs=0.5)
    knee = g.metric("knee_angle", lm, 1000, 1000)[0]
    assert knee == pytest.approx((180 + g.metric("right_knee_angle", lm, 1000, 1000)[0]) / 2, abs=0.5)
    assert g.metric("elbow_extension_angle_deg", lm, 1000, 1000, "right")[0] == right  # legacy pack name


def test_upright_trunk_reads_zero_and_a_lean_reads_the_lean():
    upright = pose(i11=(0.45, 0.3), i12=(0.55, 0.3), i23=(0.46, 0.6), i24=(0.54, 0.6))
    assert g.trunk_lean(upright, 1280, 720)[0] < 1
    leaning = pose(i11=(0.65, 0.35), i12=(0.75, 0.35), i23=(0.46, 0.6), i24=(0.54, 0.6))
    assert g.trunk_lean(leaning, 1000, 1000)[0] == pytest.approx(38.7, abs=0.5)


# -- motion -----------------------------------------------------------------

def synthetic_track(rises: dict[float, float], rate=12, seconds=10) -> Track:
    t = np.arange(0, seconds, 1 / rate)
    lm = np.full((len(t), 33, 4), 0.5, np.float32)
    lm[:, :, 3] = 1.0
    lm[:, 11, :2] = [0.45, 0.4]; lm[:, 12, :2] = [0.55, 0.4]
    lm[:, 23, :2] = [0.46, 0.6]; lm[:, 24, :2] = [0.54, 0.6]
    lm[:, 16, 1] = 0.6
    for centre, height in rises.items():
        lm[:, 16, 1] -= height * np.clip(1 - np.abs(t - centre) / 0.5, 0, None)
    return Track(t, lm, np.tile([0, 0, 10, 10.0], (len(t), 1)), np.ones(len(t), np.float32), 1000, 1000, rate)


def test_candidate_moments_are_wrist_raises_spaced_by_the_pack_gap():
    track = synthetic_track({2.0: 0.6, 2.8: 0.6, 6.0: 0.6})  # 2.0 and 2.8 are closer than 1.5 s
    found = motion.candidates(track, sports.load("basketball"))
    assert [round(c.t) for c in found] == [2, 6] and all(c.side == "right" for c in found)


def test_no_candidates_when_nothing_happens():
    assert motion.candidates(synthetic_track({}), sports.load("basketball")) == []


def test_short_gaps_are_bridged_and_long_gaps_are_not():
    track = synthetic_track({})
    track.lm[10:12] = np.nan
    track.lm[40:70] = np.nan
    fixed = clean(track)
    assert not np.isnan(fixed.lm[10:12]).any() and np.isnan(fixed.lm[50]).all()


# -- scoring ----------------------------------------------------------------

CRIT = Criterion("k", "Elbow", "elbow_angle", (155, 180), (135, 180), 1.0)


@pytest.mark.parametrize("value,expect", [(170, 1.0), (145, 0.5 + 0.25), (135, 0.5), (115, 0.5 - 0.5 * 20 / 25), (50, 0.0)])
def test_score_falls_smoothly_from_target_to_zero(value, expect):
    assert measure.score_value(value, CRIT)[0] == pytest.approx(expect, abs=0.01)


def test_judgements_are_evidence_but_never_measurements():
    rows = [
        {"key": "a", "weight": 0.5, "score": 1.0, "source": "pose", "state": "valid", "evidence_type": "measured"},
        {"key": "b", "weight": 0.3, "score": None, "source": None, "state": "unavailable", "evidence_type": "measured"},
        {"key": "c", "weight": 0.2, "score": 0.0, "source": "vlm", "state": "valid", "evidence_type": "judged"},
    ]
    score, coverage = measure.combine(rows)
    # Only the pose measurement counts. The VLM row is valid evidence, but a
    # judgement must not become a number, and the unavailable row is missing
    # evidence rather than a zero.
    assert coverage == 0.5 and score is None


def test_a_score_needs_enough_of_the_pack_to_rest_on():
    rows = [
        {"key": "a", "weight": 0.2, "score": 1.0, "source": "pose", "state": "valid", "evidence_type": "measured"},
        {"key": "b", "weight": 0.8, "score": None, "source": None, "state": "unavailable", "evidence_type": "measured"},
    ]
    detail = measure.combine_detail(rows)
    assert detail["value"] is None
    assert detail["coverage"] == 0.2 and detail["measured_weight"] == 0.2
    assert detail["excluded_criteria"] == ["b"]


# -- model access -------------------------------------------------------------

class Resp:
    def __init__(self, parsed):
        self.parsed, self.text = parsed, ""


class FakeClient:
    def __init__(self, plan):
        self.plan, self.seen = plan, []
        self.models = self

    def generate_content(self, model, contents, config):
        self.seen.append(model)
        outcome = self.plan[model]
        if isinstance(outcome, Exception):
            raise outcome
        return Resp(outcome)


def gemini(plan, monkeypatch, models=("m1", "m2")):
    monkeypatch.setattr(config.settings, "gemini_models", models)
    model = llm.Gemini()
    model.client = FakeClient(plan)
    return model


def quota(delay="1s", detail="PerMinute"):
    body = {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "message": detail,
                      "details": [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": delay}]}}
    return errors.ClientError(429, body)


def test_falls_through_to_the_next_model_when_one_is_out_of_quota(monkeypatch):
    m = gemini({"m1": quota(detail="PerDay limit: 0"), "m2": "ok"}, monkeypatch)
    assert m.structured("hi", dict)[1] == "ok"
    assert m.client.seen == ["m1", "m2"]
    m.structured("again", dict)
    assert m.client.seen == ["m1", "m2", "m2"]  # m1 is skipped now, not retried


def test_short_rate_limits_are_waited_out_once(monkeypatch):
    monkeypatch.setattr(time, "sleep", lambda s: None)
    m = gemini({"m1": quota("2s"), "m2": "ok"}, monkeypatch, models=("m1",))
    with pytest.raises(llm.Unavailable):
        m.structured("hi", dict)
    assert m.client.seen == ["m1", "m1"]


def test_unavailable_when_every_model_is_blocked(monkeypatch):
    m = gemini({"m1": quota(detail="PerDay"), "m2": quota(detail="PerDay")}, monkeypatch)
    with pytest.raises(llm.Unavailable) as exc:
        m.structured("hi", dict)
    assert exc.value.retryable and exc.value.status == 503
    with pytest.raises(llm.Unavailable):
        m.structured("hi", dict)
    assert len(m.client.seen) == 2  # the second call never reached the API


def test_missing_key_is_unavailable_not_a_crash(monkeypatch):
    monkeypatch.setattr(config.settings, "gemini_key", "")
    with pytest.raises(llm.Unavailable):
        llm.Gemini()


# -- events -----------------------------------------------------------------

def add_job(job_id, callback):
    db.run("INSERT INTO jobs(id, state, params, callback_url, created_at) VALUES (?,?,?,?,?)",
           (job_id, "running", "{}", callback, time.time()))


def test_events_are_ordered_and_replayable_from_a_sequence_number():
    a = events.emit("s", "one", {"n": 1})
    events.emit("other", "x")
    b = events.emit("s", "two", {"n": 2})
    assert [e["type"] for e in events.read("s")] == ["one", "two"]
    assert [e["type"] for e in events.read("s", after=a)] == ["two"] and b > a


def test_sse_replays_then_ends_on_a_terminal_event():
    events.emit("j", "job.started")
    events.emit("j", "job.completed", {"ok": True})

    async def collect():
        return [f async for f in events.follow("j", poll=0.01)]

    frames = asyncio.run(collect())
    assert frames[0].startswith("id: ") and "event: job.started" in frames[0]
    assert "event: job.completed" in frames[-1] and json.dumps({"ok": True}) in frames[-1]


def test_sse_gives_up_on_a_silent_stream():
    async def collect():
        return [f async for f in events.follow("nobody", poll=0.01, idle_timeout=0.05)]

    assert asyncio.run(collect()) == []


def test_webhooks_are_signed_ordered_and_retried(monkeypatch):
    monkeypatch.setattr(config.settings, "service_token", "secret")
    add_job("w", "http://server/hook")
    events.emit("w", "job.started")
    events.emit("w", "job.completed")
    got, fail = [], {"on": True}

    def handler(request: httpx.Request):
        if fail["on"]:
            return httpx.Response(500)
        body = request.content
        assert request.headers["x-engine-signature"] == events.sign(body, request.headers["x-engine-timestamp"])
        got.append(json.loads(body)["type"])
        return httpx.Response(200)

    d = events.Dispatcher()
    d.client = httpx.Client(transport=httpx.MockTransport(handler))
    assert d.tick() == 0  # server down: nothing delivered, event 2 is held back behind event 1
    db.run("UPDATE events SET next_try=0")
    fail["on"] = False
    assert d.tick() == 2 and got == ["job.started", "job.completed"]
    assert d.tick() == 0  # nothing delivered twice


def test_progress_events_are_not_sent_as_webhooks():
    add_job("p", "http://server/hook")
    events.emit("p", "stage.progress", {"progress": 10}, webhook=False)
    d = events.Dispatcher()
    d.client = httpx.Client(transport=httpx.MockTransport(lambda r: pytest.fail("should not be called")))
    assert d.tick() == 0


# -- storage and sessions -----------------------------------------------------

def test_storage_keys_cannot_escape_the_root():
    with pytest.raises(ValueError):
        storage.backend().path("../../etc/passwd")


def test_sessions_expire_and_replaced_uploads_are_reported(monkeypatch):
    token = sessions.new_token()
    assert sessions.add_angle(token, "primary", {"video_key": "raw/a", "players": []}) is None
    assert sessions.add_angle(token, "primary", {"video_key": "raw/b", "players": []}) == "raw/a"
    assert sessions.angle(token, "side")[0] == "primary"  # unknown angle falls back to primary
    monkeypatch.setattr(config.settings, "session_ttl_s", -1)
    assert sessions.get(token) is None


# -- camera angle validity ----------------------------------------------------

def test_classifier_reads_the_torso_axis_as_front_or_side():
    # Front: shoulders vertically above hips (small lateral offset, larger forward offset)
    facing = pose(i11=(0.5, 0.3), i12=(0.55, 0.3), i23=(0.5, 0.6), i24=(0.54, 0.6))
    assert g.classify_angle(facing, 1000, 1000) == "front"
    # Side: shoulders and hips horizontally separated, same vertical level
    side = pose(i11=(0.5, 0.5), i12=(0.5, 0.5), i23=(0.7, 0.5), i24=(0.7, 0.5))
    assert g.classify_angle(side, 1000, 1000) == "side"
    # Diagonal: both offsets moderate → forward-biased (forward > lateral)
    diagonal = pose(i11=(0.5, 0.5), i12=(0.55, 0.5), i23=(0.525, 0.525), i24=(0.55, 0.55))
    assert g.classify_angle(diagonal, 1000, 1000) == "front"


def test_measure_skips_criteria_the_angle_cannot_support():
    pack = sports.Pack(
        name="test", version=1, label="Test", signal="wrist_speed", min_gap_s=1.5, floor=4.0,
        event_types=["action"], positive=["made"], negative=["missed"], neutral=["unknown"],
        # positions and camera_angles are required fields in Pack; valid_angles is the new addition
        positions=[{"id": "sg", "label": "Shooting Guard"}],
        camera_angles=[{"id": "side", "label": "Side view"}, {"id": "front", "label": "Front view"}],
        criteria=[Criterion("arm_extension", "Arm extension", "elbow_angle", (155, 180), (135, 180), 0.3,
                              valid_angles=("side",))],
    )
    front = measure.measure(synthetic_track({}), 0, "left", pack, angle="front")
    assert front["criteria"][0]["source"] is None
    assert front["criteria"][0]["state"] == "invalid_view"
    assert front["criteria"][0]["skipped"] is True
    assert front["criteria"][0]["score"] is None
    # The declared camera angle wins over the classifier, so the side view
    # still measures the criterion.
    side = measure.measure(synthetic_track({}), 0, "left", pack, angle="side")
    assert side["criteria"][0]["state"] != "invalid_view"
    assert side["criteria"][0]["skipped"] is False
# -- derived metrics ----------------------------------------------------------

def test_metrics_without_a_target_range_are_measured_but_not_scored():
    value, note = measure.score_value(0.8, MetricDef("rise", "Rise", "hip_rise"))
    assert value is None and note == "no target range"


def test_key_metrics_are_normalised_by_torso_length():
    track = synthetic_track({})
    track.lm[:, 16, 1] = 0.2  # right wrist well above the shoulder line at 0.4
    close = metrics.derive("wrist_above_shoulder", track, 20, "right")
    track.width = track.height = 2000  # same pose, camera twice as far: torso doubles too
    far = metrics.derive("wrist_above_shoulder", track, 20, "right")
    assert close == pytest.approx(1.0, abs=0.05)
    assert far == pytest.approx(close, abs=0.01)


def test_every_pack_key_metric_gets_a_row_per_event():
    pack = sports.load("basketball")
    track = synthetic_track({2.0: 0.6})
    rows = metrics.event_metrics(track, 25, "right", pack)
    assert [r["key"] for r in rows] == [m.key for m in pack.key_metrics]
    assert all("score" in r and "value" in r for r in rows)
    assert any(r["value"] is not None for r in rows)


def test_session_metrics_summarise_events_and_coverage():
    pack = sports.load("basketball")
    track = synthetic_track({2.0: 0.6, 6.0: 0.6})
    events = [{"t": 2.0, "metrics": metrics.event_metrics(track, 24, "right", pack)},
              {"t": 6.0, "metrics": metrics.event_metrics(track, 72, "right", pack)}]
    rows = {m["key"]: m for m in metrics.session_metrics(track, events, pack)}
    assert rows["tempo"]["value"] == pytest.approx(4.0)
    assert rows["events_per_min"]["value"] == pytest.approx(12.0, abs=0.5)
    assert rows["tracking_coverage"]["value"] == pytest.approx(100.0)


# -- result without usable pose ----------------------------------------------

def test_result_still_builds_when_the_athlete_is_never_visible():
    track = synthetic_track({})
    track.lm[:] = np.nan
    track.conf[:] = 0
    judgement = Judgement(source="rules", sport="basketball", verdicts={
        0: {"is_event": True, "type": "shot", "result": "unknown", "feedback": "", "confidence": 0.5,
            "ratings": {}}})
    out = result.build("job", {"angle": "front"}, sports.load("basketball"), track, Media(10.0, 12.0, False),
                       [Candidate(0, 2.0, 1.0, "right")], judgement, [])
    event = out["events"][0]
    assert event["score"] is None and event["confidence"] == 0
    assert all(m["value"] is None for m in event["metrics"])
    assert out["summary"]["confidence"] == 0
    assert {"low_track_coverage", "no_measurable_events"} <= set(out["quality"]["issues"])
    assert out["needs_review"] is True


def test_legacy_summary_exposes_ui_ready_stats():
    from routes.legacy import legacy_summary

    track = synthetic_track({2.0: 0.6})
    judgement = Judgement(source="rules", sport="basketball", verdicts={
        0: {"is_event": True, "type": "shot", "result": "made", "feedback": "Good look.", "confidence": 0.8,
            "ratings": {}}})
    out = result.build("job", {"angle": "front"}, sports.load("basketball"), track, Media(10.0, 12.0, False),
                       [Candidate(24, 2.0, 1.0, "right")], judgement, [])
    legacy = legacy_summary(out)
    assert legacy["confidence"] == out["summary"]["confidence"]
    assert legacy["average_score"] == (out["summary"]["average_score"] or 0)
    assert legacy["success_rate"] == pytest.approx(out["summary"]["success_rate"] / 100)
    assert legacy["session_metrics"] == out["session_metrics"]
    assert legacy["stats"] == out["stats"]
    assert legacy["shot_events"][0]["metrics"] == out["events"][0]["metrics"]


# -- professional stat layer ---------------------------------------------------

def test_professional_stats_label_every_source_and_name_what_is_unavailable():
    pack = sports.load("basketball")
    events = [
        {"t": 2.0, "type": "catch_and_shoot", "result": "made", "score": 8.4, "score_source": "measured",
         "measurements": [
             {"key": "arm_extension", "label": "Shooting arm extension", "score": 1.0, "source": "pose"},
             {"key": "balance", "label": "Upright balance", "score": 0.5, "source": "judged"},
         ],
         "metrics": [{"key": "release_height", "label": "Release height", "value": 0.9, "unit": "torso"}],
         "matchup": {"separation": {"distance": 1.1}}, "tags": ["high release"], "pressure": "contested"},
        {"t": 6.0, "type": "off_dribble", "result": "missed", "score": 7.2, "score_source": "measured",
         "measurements": [
             {"key": "arm_extension", "label": "Shooting arm extension", "score": 0.75, "source": "judged"},
         ],
         "metrics": [{"key": "release_height", "label": "Release height", "value": 0.7, "unit": "torso"}],
         "matchup": {"separation": {"distance": 2.8}}, "tags": ["high release", "late closeout"],
         "pressure": "open"},
    ]
    session_metrics = [
        {"key": "release_height", "label": "Release height", "unit": "torso", "kind": "metric", "n": 2,
         "value": 0.8, "best": 0.9, "worst": 0.7},
        {"key": "tempo", "label": "Tempo", "unit": "s", "kind": "session", "n": 1, "value": 4.0},
        {"key": "events_per_min", "label": "Action rate", "unit": "/min", "kind": "session", "n": 2,
         "value": 12.0},
        {"key": "tracking_coverage", "label": "Pose coverage", "unit": "%", "kind": "session", "n": 120,
         "value": 92.0},
        {"key": "opponent_distance", "label": "Defender distance", "unit": "torso", "kind": "matchup", "n": 2,
         "value": 1.95, "best": 1.1, "worst": 2.8},
    ]
    consistency = [{"key": "arm_extension", "label": "Shooting arm extension", "n": 2, "mean": 165.0,
                    "sd": 5.0, "ideal": [155, 180]}]
    out = performance.build(pack, events, session_metrics, consistency,
                            {"events": 2, "made": 1, "missed": 1})
    groups = {g["key"]: g for g in out["groups"]}
    assert {"output", "technique", "execution", "pressure", "consistency"} <= set(groups)
    sources = {row["source"] for group in out["groups"] for row in group["stats"]}
    assert sources <= {"measured", "counted", "observed"}
    assert any(row["source"] == "observed" for row in groups["technique"]["stats"])
    # A criterion that mixes pose measurements with model ratings is not
    # reported as measured: the mean of the two is a judgement, not a measurement.
    technique = {row["key"]: row for row in groups["technique"]["stats"]}
    assert technique["arm_extension"]["source"] == "observed"
    assert groups["output"]["stats"][0]["source"] == "counted"
    assert out["provenance"]["counted"] >= 1 and out["provenance"]["measured"] >= 1
    assert out["event_breakdown"][0]["label"] in ("Catch and shoot", "Off dribble")
    assert out["tags"][0] == {"tag": "high release", "count": 2}
    assert out["trend"] is None  # fewer than four scored events
    assert any("Shot chart" in item["label"] for item in out["unavailable"])
    assert out["bands"]["target"]


def test_every_sport_pack_declares_the_stats_it_cannot_produce():
    for name in sports.KNOWN + ("generic",):
        stats = performance.UNAVAILABLE[name]
        assert stats and all(item["label"] and item["reason"] for item in stats)


def test_professional_fallback_copy_is_deterministic_and_specific():
    pack = sports.load("basketball")
    stats = {"events": 2, "made": 1, "missed": 1}
    professional = {
        "groups": [
            {"key": "technique", "stats": [
                {"key": "arm_extension", "label": "Shooting arm extension", "value": 9.0},
                {"key": "balance", "label": "Upright balance", "value": 6.0},
            ]},
            {"key": "pressure", "stats": [
                {"key": "opponent_distance", "label": "Defender distance", "value": 1.4,
                 "band": "contested"},
            ]},
            {"key": "consistency", "stats": [
                {"key": "technique_spread", "label": "Technique spread", "value": 4.0, "band": "high"},
            ]},
            {"key": "output", "stats": [
                {"key": "conversion", "label": "Conversion", "value": 50.0},
            ]},
        ],
        "trend": None,
    }
    summary, insights = performance.fallback_insights(pack, stats, professional)
    assert "50.0%" in summary and "Shooting arm extension" in summary
    assert 1 <= len(insights) <= 4
    assert any("Defender distance" in line for line in insights)
