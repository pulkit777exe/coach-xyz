import json
import shutil
import subprocess

import pytest

from core import events, jobs, llm, matchup, motion, people, pipeline, sports, storage
from core.errors import EngineError
from core.track import Lock

from . import fakes

A_TIMES = fakes.A_PULSES


def upload(video_path: str) -> str:
    key = storage.raw_key("sess", "primary")
    shutil.copy(video_path, video_path + ".copy")
    storage.backend().put(key, video_path + ".copy")
    return key


def pick_athlete(video_path: str) -> dict:
    """The scan result for the red player, as the session would store it."""
    found = people.scan(video_path, fakes.FakePose())
    red = min(found, key=lambda p: p["bbox"]["x_min"])  # A starts on the left
    return {k: red[k] for k in ("player_index", "bbox", "frame_timestamp", "signature")}


def params(video_path: str, **extra) -> dict:
    return {
        "video_key": upload(video_path),
        "sha256": "abc",
        "angle": "side",
        "sport": "basketball",
        "render": True,
        "player": pick_athlete(video_path),
        "meta": {"team": 7},
        **extra,
    }


def types(job_id: str) -> list[str]:
    return [e["type"] for e in events.read(job_id)]


def test_scan_orders_players_left_to_right_and_keeps_a_signature(video):
    found = people.scan(video, fakes.FakePose())
    assert [p["player_index"] for p in found] == [1, 2]
    assert found[0]["bbox"]["x_min"] < found[1]["bbox"]["x_min"]
    assert all(p["signature"] and p["crop_base64"] for p in found)


def test_matchup_pairs_the_action_with_the_nearest_defender(video):
    detector = fakes.FakePose()
    athlete = pick_athlete(video)
    track = pipeline.track_athlete(video, detector, Lock.from_player(athlete), rate=12)
    cands = motion.candidates(track, sports.load("basketball"))
    blocks = matchup.analyse(video, detector, track, cands, sports.load("basketball"))
    block = blocks[cands[0].i]
    assert block["roles"] == {"primary": "Ball handler", "opponent": "Defender"}
    assert block["primary"]["metrics"] and any(
        m["value"] is not None for m in block["primary"]["metrics"]
    )
    assert block["found_opponent"] is True
    assert block["opponent"]["metrics"]
    assert block["separation"]["distance"] > 0
    assert block["frames"] and block["frames"][0]["primary"]


def test_job_emits_ordered_lifecycle_events_and_a_complete_result(video, wait):
    job = jobs.create("j1", params(video))
    done = wait(job["id"])
    assert done["state"] == "completed", done["error"]

    seen = types("j1")
    assert (
        seen[0] == "job.queued"
        and seen[1] == "job.started"
        and seen[-1] == "job.completed"
    )
    assert seen.index("result.ready") < seen.index("job.completed")
    assert [
        e["data"]["stage"] for e in events.read("j1") if e["type"] == "stage.started"
    ] == ["prepare", "track", "candidates", "judge", "result", "render"]

    result = jobs.load_result("j1")
    assert result["schema_version"] == 5 and result["sport"] == "basketball"
    assert result["job_status"] == "completed" and result["failures"] == []
    found = [e["t"] for e in result["events"]]
    assert len(found) == 3
    for got, want in zip(found, A_TIMES):
        assert got == pytest.approx(
            want, abs=0.4
        )  # B's hand raises never become events
    first = result["events"][0]
    assert first["id"] == "j1:e1" and first["result"] == "made"
    assert first["event_state"] == "confirmed" and first["confirmed"] is True
    assert any(
        m["source"] == "pose" and m["state"] == "valid" and 0 < m["value"] < 180
        for m in first["measurements"]
    )
    assert (
        first["score"] is not None
        and first["coverage_detail"]["value"] == first["score"]
    )
    assert first["metrics"] and any(m["value"] is not None for m in first["metrics"])
    assert first["matchup"]["roles"] == {
        "primary": "Ball handler",
        "opponent": "Defender",
    }
    assert first["matchup"]["found_opponent"] is True
    assert first["matchup"]["separation"]["distance"] > 0
    assert result["summary"]["strengths"] == ["Release height"]
    assert result["summary"]["confidence"] > 0.8 and result["summary"]["made"] >= 1
    assert result["summary"]["composite"]["status"] == "experimental_unvalidated"
    assert result["summary"]["composite"]["excluded_from_research"] is True
    assert {m["key"] for m in result["session_metrics"]} >= {
        "tracking_coverage",
        "tempo",
    }
    assert result["athlete"]["track_coverage"] > 0.8
    assert result["provenance"]["judged_by"] == "model" and result["degraded"] == []
    assert result["provenance"]["manifest"]["sport_pack"]["sha256"]
    assert result["provenance"]["manifest"]["prompt"]["hash"]
    assert result["angle_source"] == "declared"
    assert result["angle"] == "side"
    assert (
        result["detected_angle"]
        == result["provenance"]["manifest"]["camera"]["detected_angle"]
    )
    assert result["provenance"]["manifest"]["camera"]["research_mode"] is False
    assert result["event_detection"]["confirmed"] == 3


def test_outputs_are_published_as_artifacts_and_the_video_plays(video, wait, tmp_path):
    jobs.create("j2", params(video))
    wait("j2")
    names = {
        e["data"]["name"] for e in events.read("j2") if e["type"] == "artifact.ready"
    }
    assert {
        "result.json",
        "manifest.json",
        "events.csv",
        "measurements.csv",
        "findings.csv",
        "metrics.csv",
        "session.csv",
        "stats.csv",
        "track.json",
        "analysis.mp4",
        "thumbs/event_1.jpg",
    } <= names
    path = storage.backend().path(storage.result_key("j2", "analysis.mp4"))
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name,pix_fmt",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    stream = json.loads(probe.stdout)["streams"][0]
    assert (stream["codec_name"], stream["pix_fmt"]) == ("h264", "yuv420p")
    csv = (
        storage.backend()
        .path(storage.result_key("j2", "events.csv"))
        .read_text(encoding="utf-8-sig")
    )
    assert (
        csv.splitlines()[0].startswith("job_id,event_id") and len(csv.splitlines()) == 4
    )
    measurements = (
        storage.backend()
        .path(storage.result_key("j2", "measurements.csv"))
        .read_text(encoding="utf-8-sig")
    )
    header = measurements.splitlines()[0]
    assert "criterion_id" in header and ",state," in header and ",source," in header
    manifest = json.loads(
        storage.backend().path(storage.result_key("j2", "manifest.json")).read_text()
    )
    assert manifest["sport_pack"]["sha256"] and manifest["prompt"]["hash"]


def test_research_mode_is_fail_closed_and_stamped_on_the_manifest(video, wait):
    jobs.create("j6", params(video, research=True, angle="primary"))
    done = wait("j6")
    assert done["degraded"] == []
    result = jobs.load_result("j6")
    assert result["research_mode"] is True
    assert result["aggregation"] == "disabled_until_validated"
    assert result["provenance"]["manifest"]["camera"]["research_mode"] is True
    assert result["provenance"]["manifest"]["phases"] == [
        p["id"] for p in sports.load("basketball").phases
    ]
    gated = [
        r
        for e in result["events"]
        for r in e["measurements"]
        if r["key"] == "arm_extension"
    ]
    assert gated
    # Research mode never lets a camera-gated criterion carry a numeric score.
    for row in gated:
        assert row["score"] is None
        if row["source"] is None:
            assert row["state"] == "unavailable"
        else:
            # The VLM may still record a qualitative observation; it is not a measurement.
            assert row["source"] == "vlm" and row["evidence_type"] == "judged"
            assert row.get("qualitative_rating")


def test_model_outage_degrades_to_rules_but_still_delivers(video, wait, monkeypatch):
    monkeypatch.setattr(pipeline, "make_model", lambda: fakes.FakeModel(fail=True))
    jobs.create("j3", params(video))
    done = wait("j3")
    assert done["state"] == "completed" and done["degraded"] == ["llm"]
    assert "job.degraded" in types("j3")
    result = jobs.load_result("j3")
    assert result["provenance"]["judged_by"] == "rules"
    assert result["job_status"] == "degraded"
    assert any(f["code"] == "F11_VLM_UNAVAILABLE" for f in result["failures"])
    assert len(result["events"]) >= 3
    assert all(e["feedback"] for e in result["events"])
    assert all(e["score"] is not None for e in result["events"])  # measured, not judged
    # A motion peak is not a confirmed event: the rules fallback must not
    # promote unvalidated candidates into the event count.
    assert all(
        e["event_state"] == "candidate" and e["confirmed"] is False
        for e in result["events"]
    )
    assert result["event_detection"]["confirmed"] == 0
    assert result["event_detection"]["candidate"] >= 3


def test_missing_api_key_is_the_same_graceful_path(video, wait, monkeypatch):
    def no_key():
        raise llm.Unavailable("GEMINI_API_KEY is not configured")

    monkeypatch.setattr(pipeline, "make_model", no_key)
    jobs.create("j4", params(video))
    assert wait("j4")["degraded"] == ["llm"]


def test_unselected_player_is_locked_automatically(video, wait):
    jobs.create("auto", {**params(video, render=False), "player": None})
    done = wait("auto")
    assert done["state"] == "completed", done["error"]
    result = jobs.load_result("auto")
    assert result["athlete"]["track_coverage"] > 0.5
    found = [e["t"] for e in result["events"]]
    for got, want in zip(found, A_TIMES):
        assert got == pytest.approx(
            want, abs=0.4
        )  # still the same athlete, not the passer


def test_detected_sport_replaces_the_generic_pack(video, wait):
    jobs.create("sport", {**params(video, render=False), "sport": ""})
    done = wait("sport")
    assert done["state"] == "completed", done["error"]
    result = jobs.load_result("sport")
    assert result["sport"] == "basketball"
    assert result["provenance"]["sport_pack"] == sports.load("basketball").version
    assert all(
        e["type"] in sports.load("basketball").event_types for e in result["events"]
    )


def test_second_job_on_same_clip_reuses_tracking_and_verdicts(video, wait, monkeypatch):
    shared = params(video)
    jobs.create("a", shared)
    wait("a")
    detector, model = fakes.FakePose(), fakes.FakeModel()
    monkeypatch.setattr(pipeline, "make_detector", lambda: detector)
    monkeypatch.setattr(pipeline, "make_model", lambda: model)
    jobs.create("b", {**shared, "render": False})
    wait("b")
    assert detector.calls == 0 and model.calls == 0
    assert [e["id"] for e in jobs.load_result("b")["events"]] == [
        "b:e1",
        "b:e2",
        "b:e3",
    ]


def test_unreadable_video_fails_with_a_retryable_flag(tmp_path, wait):
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"not a video at all" * 100)
    jobs.create(
        "j5",
        {
            "video_key": upload(str(bad)),
            "angle": "primary",
            "sport": "",
            "player": None,
        },
    )
    done = wait("j5")
    assert done["state"] == "failed" and done["error"]["code"] == "VIDEO_DECODE_FAILED"
    assert types("j5")[-1] == "job.failed"


def test_cancel_a_queued_job_and_retry_it(video, wait, monkeypatch):
    jobs.pool().submit(lambda: __import__("time").sleep(1.0))  # occupy the only worker
    jobs.create("j6", params(video, render=False))
    assert jobs.cancel("j6")["state"] == "cancelled"
    assert types("j6")[-1] == "job.cancelled"
    jobs.retry("j6")
    assert wait("j6")["state"] == "completed"


def test_job_creation_is_idempotent(video, wait):
    a = jobs.create("same", params(video, render=False))
    b = jobs.create("same", {})
    assert a["id"] == b["id"]
    wait("same")
    assert types("same").count("job.queued") == 1


def test_render_failure_does_not_lose_the_analysis(video, wait, monkeypatch):
    from core import render

    def boom(*a, **k):
        raise EngineError("RENDER_FAILED", "encoder crashed", retryable=True)

    monkeypatch.setattr(render, "render", boom)
    jobs.create("j7", params(video))
    done = wait("j7")
    assert done["state"] == "completed" and done["degraded"] == ["render"]
    assert len(jobs.load_result("j7")["events"]) == 3
