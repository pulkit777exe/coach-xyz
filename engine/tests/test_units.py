import asyncio
import json
import time

import httpx
import numpy as np
import pytest
from google.genai import errors

from core import config, db, events, geometry as g, judge, llm, measure, motion, result, sessions, sports, storage
from core.judge import Review, Verdict
from core.sports import Criterion
from core.track import Track, clean


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


def test_unmeasured_criteria_do_not_count_as_zero_and_judgements_weigh_less():
    rows = [{"weight": 0.5, "score": 1.0, "source": "pose"}, {"weight": 0.3, "score": None, "source": "none"},
            {"weight": 0.2, "score": 0.0, "source": "judged"}]
    score, coverage = measure.combine(rows)
    assert coverage == 0.7 and score == pytest.approx(10 * 0.5 / 0.6, abs=0.1)


def test_a_score_needs_enough_of_the_pack_to_rest_on():
    assert measure.combine([{"weight": 0.2, "score": 1.0, "source": "pose"}, {"weight": 0.8, "score": None, "source": "none"}])[0] is None


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


# -- judging and result edge cases --------------------------------------------

class SportModel:
    """Answers with a sport the caller did not name, as the real model can."""

    def video_part(self, path, fps):
        return object(), None

    def drop_file(self, name):
        pass

    def structured(self, contents, schema, system=None, video=False):
        return "fake", Review(
            sport="tennis",
            events=[Verdict(candidate=1, is_event=True, event_type="serve", result="ace",
                            ratings=[], feedback="Toss higher.", confidence=0.9)],
            summary="", strengths=[], focus_areas=[], priority_drill="",
        )


def test_a_model_identified_sport_cleans_its_own_event_types(video):
    track = synthetic_track({2.0: 0.6})
    cands = [motion.Candidate(i=24, t=2.0, strength=1.0, side="right")]
    judged = judge.review(track, cands, [{"criteria": []}], sports.load(None), video,
                          sport_known=False, make_llm=SportModel)
    # "serve"/"ace" are tennis words. Cleaning with the generic pack that the prompt
    # was built from rewrote both to "action"/unknown before anything reloaded the
    # identified pack, so the result lost the real event type it was given.
    assert judged.sport == "tennis"
    assert judged.verdicts[0]["type"] == "serve" and judged.verdicts[0]["result"] == "ace"


def test_unmeasured_rows_keep_their_shape_and_accept_a_judged_rating():
    pack = sports.load("basketball")
    rows = measure.unmeasured(pack)
    assert [r["key"] for r in rows] == [c.key for c in pack.criteria]
    assert all(r["source"] == "none" and r["score"] is None for r in rows)
    assert measure.apply_ratings(rows, {rows[0]["key"]: "good"}) is None
    assert rows[0]["source"] == "judged" and rows[0]["score"] == 1.0
    score, coverage = measure.combine(rows)
    assert coverage > 0 and (score is None or 0 <= score <= 10)


def test_an_event_at_a_weak_pose_sample_is_unmeasured_not_a_crash():
    track = synthetic_track({2.0: 0.6})
    track.conf[:] = 0.1  # below the 0.3 confidence floor result.build checks
    cands = [motion.Candidate(i=24, t=2.0, strength=1.0, side="right")]
    judged = judge.Judgement(source="model", sport="basketball", verdicts={
        0: {"is_event": True, "type": "three_pointer", "result": "made", "feedback": "",
            "confidence": 0.9, "ratings": {}}})
    built = result._events("job", track, cands, judged, sports.load("basketball"))
    assert len(built) == 1
    assert built[0]["score"] is None and built[0]["score_source"] is None
    assert built[0]["measurements"] and built[0]["feedback"]
