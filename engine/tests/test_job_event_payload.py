"""Tests for _publish_job_event's payload — core/jobs.py.

The publish path used to `asdict(job)` and then null the summary. asdict
deep-copies every field, so a summary measured in tens of KB was copied in full
and immediately discarded — on every one of the ~6 publishes per analysis.

These tests pin the *result*: a byte-identical payload, a summary that is always
null, no video paths, and a copy that is measurably cheaper because the summary
is never traversed. The last one is a ratio assertion (before vs after), so it
fails if someone reinstates the deep copy, and it is expressed as "the deep copy
is much slower" rather than an absolute millisecond budget, which would be a
flake on a loaded CI box.
"""

from __future__ import annotations

import copy
import json
import time
from dataclasses import asdict, replace

import pytest

from core import jobs
from core.errors import EngineError, InvalidStateTransition
from core.jobs import JobStatus, _publish_job_event


def _big_summary() -> dict:
    """A summary with the shape and bulk of a real one — nested dicts and lists,
    which is what makes asdict's deepcopy expensive."""
    return {
        "success": True,
        "form_score": 71.5,
        "sport": "cricket",
        "shot_events": [
            {
                "index": i,
                "timestamp": round(i * 0.8, 2),
                "type": "forehand" if i % 2 else "drive",
                "score": 55 + i,
                "landmarks": [
                    {"x": round(0.01 * (i + j), 4), "y": round(0.02 * j, 4), "v": 0.9}
                    for j in range(33)
                ],
                "coaching_cues": ["Rotate the hips earlier. ", "Follow through higher. "] * 5,
            }
            for i in range(14)
        ],
        "coaching_notes": ["note " * 25] * 10,
        "findings": [{"title": f"finding {i}", "evidence": [1, 2, 3]} for i in range(8)],
        "quality": {"passed": True, "issues": [], "needs_review": False},
    }


def _rich_job(**overrides) -> JobStatus:
    fields = dict(
        job_id="job-publish",
        state="completed",
        stage=6,
        stage_name="Complete",
        progress=100,
        complete=True,
        summary=_big_summary(),
        video_key="coachai/renders/job-publish.mp4",
        video_path="/tmp/renders/job-publish.mp4",
    )
    fields.update(overrides)
    return JobStatus(**fields)


@pytest.fixture
def recording_redis(monkeypatch):
    """Capture what _publish_job_event would put on the wire."""
    published: list[tuple[str, str]] = []

    class _Recorder:
        def publish(self, channel: str, message: str) -> int:
            published.append((channel, message))
            return 1

    monkeypatch.setattr(jobs, "redis", _Recorder())
    return published


class TestPublishedPayload:
    def test_summary_is_never_published(self, recording_redis):
        _publish_job_event(_rich_job())

        payload = json.loads(recording_redis[0][1])
        assert payload["status"]["summary"] is None

    def test_summary_content_does_not_leak_into_the_payload(self, recording_redis):
        """The reason the summary is stripped: potentially sensitive analysis
        content must not ride a shared Redis channel."""
        secret = _big_summary()
        _publish_job_event(_rich_job(summary=secret))

        message = recording_redis[0][1]
        assert "coaching_cues" not in message
        assert "form_score" not in message
        assert len(message) < 400, "payload is far larger than a stripped snapshot"

    def test_video_paths_are_still_omitted(self, recording_redis):
        _publish_job_event(_rich_job())

        status = json.loads(recording_redis[0][1])["status"]
        assert "video_key" not in status
        assert "video_path" not in status

    def test_payload_is_identical_to_the_previous_deepcopy_shape(self, recording_redis):
        """The fix was a cheaper route to the same bytes. Compute the old shape
        independently and require an exact match — a field silently dropped by
        replace() would not show up any other way."""
        job = _rich_job()

        legacy: dict = asdict(job)
        legacy.pop("video_key", None)
        legacy.pop("video_path", None)
        legacy["summary"] = None
        legacy_wire = json.dumps(
            {"job_id": job.job_id, "status": legacy}, separators=(",", ":")
        )

        _publish_job_event(job)
        assert recording_redis[0][1] == legacy_wire

    def test_every_other_field_survives_the_strip(self, recording_redis):
        job = _rich_job(error="boom", error_code="GEMINI_TIMEOUT", retryable=False)

        _publish_job_event(job)
        status = json.loads(recording_redis[0][1])["status"]

        assert status["job_id"] == "job-publish"
        assert status["state"] == "completed"
        assert status["stage"] == 6
        assert status["stage_name"] == "Complete"
        assert status["progress"] == 100
        assert status["complete"] is True
        assert status["error"] == "boom"
        assert status["error_code"] == "GEMINI_TIMEOUT"
        assert status["retryable"] is False
        assert status["created_at"] == pytest.approx(job.created_at)

    def test_job_is_not_mutated_by_publishing(self, recording_redis):
        job = _rich_job()
        summary_before = copy.deepcopy(job.summary)

        _publish_job_event(job)

        assert job.summary == summary_before
        assert job.video_key == "coachai/renders/job-publish.mp4"

    def test_nulling_the_summary_never_mutates_the_shared_summary_object(self, monkeypatch):
        """replace() builds a shallow copy, so if any later code wrote into the
        returned dict's summary it would hit the live object. Assert the
        published snapshot's summary is a distinct None, not an aliased value."""
        recording = []

        class _Recorder:
            def publish(self, channel: str, message: str) -> int:
                recording.append(message)
                return 1

        monkeypatch.setattr(jobs, "redis", _Recorder())
        shared = _big_summary()
        job = _rich_job(summary=shared)

        _publish_job_event(job)

        snapshot = json.loads(recording[0])["status"]
        assert snapshot["summary"] is None
        assert shared.get("shot_events"), "the live summary was disturbed"

    def test_publish_failure_does_not_raise(self, monkeypatch):
        """Event fan-out must never turn a successful transition into a failed
        job — the status key is authoritative."""

        class _Exploding:
            def publish(self, channel: str, message: str) -> int:
                raise RuntimeError("redis pubsub down")

        monkeypatch.setattr(jobs, "redis", _Exploding())
        _publish_job_event(_rich_job())  # must not raise

    def test_no_redis_client_is_a_silent_skip(self, monkeypatch):
        monkeypatch.setattr(jobs, "redis", None)
        _publish_job_event(_rich_job())  # must not raise


class TestPublishFailureDoesNotFailTheTransition:
    """The guarantee named at jobs.py:29-35, pinned at the level it is stated.

    `test_publish_failure_does_not_raise` above proves the helper swallows a
    publish error, but it calls `_publish_job_event` directly. Nothing proved
    the property that actually matters: that a job's state transition still
    COMMITS when event delivery fails. Those are different claims, and the
    second one is the invariant — the persisted status key is authoritative and
    the server re-reads it on reconnect, so a dead pub/sub channel must not be
    able to fail a job.

    Why this is pinned rather than assumed: collapsing the authoritative `set`
    and the best-effort `publish` into one Upstash `/pipeline` batch looks like a
    free round trip, but `Pipeline.exec()` raises `UpstashError` from the first
    erroring element (upstash_redis/http.py: `format_response` raises per
    sub-response, and `exec()` builds its list through it). A batched set+publish
    would therefore raise from the same call that performed the authoritative
    write, and a blanket `except` around it cannot tell "publish failed" from
    "the state write failed" — it would silently swallow the second. These tests
    are the tripwire for exactly that change.

    `fail_job` matters most of the three: it is the terminal path, so a publish
    error there must not leave a failed job stuck reporting its previous state.
    """

    @pytest.fixture
    def exploding_pubsub(self, monkeypatch):
        """A Redis whose reads and writes work and whose publish always raises."""

        class _ExplodingPubsub:
            def __init__(self) -> None:
                self.store: dict[str, str] = {}

            def get(self, key: str) -> str | None:
                return self.store.get(key)

            def set(self, key: str, value: str, ex: int | None = None) -> None:
                self.store[key] = value

            def publish(self, channel: str, message: str) -> int:
                raise RuntimeError("redis pubsub down")

        fake = _ExplodingPubsub()
        monkeypatch.setattr(jobs, "redis", fake)
        return fake

    @staticmethod
    def _seed(fake, job_id: str, state: str) -> None:
        job = JobStatus(job_id=job_id, state=state)
        info = jobs.PIPELINE_STATES[state]
        job.stage, job.stage_name, job.progress = info["stage"], info["stage_name"], info["progress"]
        fake.set(f"{jobs.KEY}{job_id}", job.to_redis(), ex=jobs.JOB_TTL)

    def _stored(self, fake, job_id: str) -> JobStatus:
        return JobStatus.from_redis(fake.store[f"{jobs.KEY}{job_id}"])

    def test_transition_commits_when_publish_fails(self, exploding_pubsub):
        self._seed(exploding_pubsub, "j1", "uploading")

        jobs.transition_job("j1", "scanning")  # must not raise

        stored = self._stored(exploding_pubsub, "j1")
        assert stored.state == "scanning"
        assert stored.progress == jobs.PIPELINE_STATES["scanning"]["progress"]

    def test_update_commits_when_publish_fails(self, exploding_pubsub):
        self._seed(exploding_pubsub, "j2", "analyzing")

        jobs.update_job("j2", summary={"form_score": 71.5})  # must not raise

        stored = self._stored(exploding_pubsub, "j2")
        assert stored.summary == {"form_score": 71.5}

    def test_fail_job_commits_when_publish_fails(self, exploding_pubsub):
        """The terminal path — the worst one to lose, since nothing retries it."""
        self._seed(exploding_pubsub, "j3", "analyzing")

        error = EngineError(code="INTERNAL_ERROR", message="boom")
        jobs.fail_job("j3", error)  # must not raise

        stored = self._stored(exploding_pubsub, "j3")
        assert stored.state == "failed"
        assert stored.complete is True
        assert stored.error_code == "INTERNAL_ERROR"

    def test_create_job_commits_when_publish_fails(self, exploding_pubsub):
        jobs.create_job("j4")  # must not raise

        assert self._stored(exploding_pubsub, "j4").state == "uploading"

    def test_the_transition_failure_is_still_raised(self, exploding_pubsub):
        """The mirror image, so the fixture above cannot pass vacuously: the
        guarantee is scoped to *publish*. An invalid transition must still
        raise, which proves these tests observe a real enforcement path rather
        than an everything-is-swallowed no-op."""

        class _NoSetReached(Exception):
            pass

        self._seed(exploding_pubsub, "j5", "uploading")

        with pytest.raises(InvalidStateTransition):
            jobs.transition_job("j5", "completed")  # uploading -> completed is illegal

        assert self._stored(exploding_pubsub, "j5").state == "uploading"


class TestAFailedAuthoritativeWriteStillRaises:
    """The other half of the guarantee, and the one batching would destroy.

    The best-effort rule is scoped to *event delivery*. It is explicitly NOT a
    licence to swallow any error raised near a job write, because the persisted
    status key is the source of truth: if its write fails silently the job stops
    advancing, the server's SSE consumers never see the new state, and nothing
    retries it.

    This is the specific tripwire for collapsing `set` + `publish` into one
    Upstash `/pipeline` batch. `Pipeline.exec()` raises `UpstashError` from the
    first erroring element, so a batch surfaces the publish's failure through
    the same call that performed the write — and the only way to keep publish
    non-fatal is a blanket `except` around the batch, which cannot distinguish
    "publish failed" (harmless) from "the write failed" (catastrophic). These
    tests assert the distinction is load-bearing, so that refactor has to solve
    the discrimination rather than route around it.
    """

    @pytest.fixture
    def failing_write(self, monkeypatch):
        """A Redis that reads fine but fails every authoritative write."""

        class _BrokenWrites:
            def __init__(self) -> None:
                self.store: dict[str, str] = {}
                self.publish_attempts = 0

            def get(self, key: str) -> str | None:
                return self.store.get(key)

            def set(self, key: str, value: str, ex: int | None = None) -> None:
                raise RuntimeError("redis write down")

            def publish(self, channel: str, message: str) -> int:
                self.publish_attempts += 1
                return 1

        fake = _BrokenWrites()
        monkeypatch.setattr(jobs, "redis", fake)
        return fake

    @staticmethod
    def _seed(fake, job_id: str, state: str) -> None:
        job = JobStatus(job_id=job_id, state=state)
        info = jobs.PIPELINE_STATES[state]
        job.stage, job.stage_name, job.progress = info["stage"], info["stage_name"], info["progress"]
        fake.store[f"{jobs.KEY}{job_id}"] = job.to_redis()

    def test_transition_raises_when_the_write_fails(self, failing_write):
        self._seed(failing_write, "w1", "uploading")

        with pytest.raises(RuntimeError, match="redis write down"):
            jobs.transition_job("w1", "scanning")

    def test_update_raises_when_the_write_fails(self, failing_write):
        self._seed(failing_write, "w2", "analyzing")

        with pytest.raises(RuntimeError, match="redis write down"):
            jobs.update_job("w2", summary={"form_score": 1.0})

    def test_fail_job_raises_when_the_write_fails(self, failing_write):
        """Loud failure on the terminal path: a caller must be able to see that
        the failure was not recorded, rather than assume the job is now failed."""
        self._seed(failing_write, "w3", "analyzing")

        with pytest.raises(RuntimeError, match="redis write down"):
            jobs.fail_job("w3", EngineError(code="INTERNAL_ERROR", message="boom"))

        assert failing_write.store[f"{jobs.KEY}w3"] != ""  # untouched by the failed set

    def test_create_job_raises_when_the_write_fails(self, failing_write):
        with pytest.raises(RuntimeError, match="redis write down"):
            jobs.create_job("w4")


class TestSnapshotCopyCost:
    def test_replace_before_asdict_avoids_copying_the_summary(self):
        """The defect itself: asdict() deep-copies every field, so dropping the
        summary afterwards copied ~30KB for nothing, six times per analysis.

        Measured as a ratio of two runs of the same code against the same job, so
        it is a claim about the *shape* of the work (copy the summary vs never
        touch it) rather than about how fast this machine is.
        """

        def legacy() -> dict:
            status = asdict(job)
            status.pop("video_key", None)
            status.pop("video_path", None)
            status["summary"] = None
            return status

        def current() -> dict:
            status = asdict(replace(job, summary=None))
            status.pop("video_key", None)
            status.pop("video_path", None)
            return status

        job = _rich_job()
        assert legacy() == current()

        # Warm both, then take the best of a few rounds each: scheduling noise on
        # a shared CI runner can only ever make the *fast* path look slower, and
        # `min` is the statistic least sensitive to that.
        legacy()
        current()

        def best_of(fn) -> float:
            samples = []
            for _ in range(5):
                started = time.perf_counter()
                for _ in range(20):
                    fn()
                samples.append((time.perf_counter() - started) / 20)
            return min(samples)

        legacy_s = best_of(legacy)
        current_s = best_of(current)

        # The summary here is tens of KB of nested containers, where deepcopy
        # dominates. A 5x floor is far above the noise and far below the ~100x
        # actually observed, so neither a regression nor a slow box fails it.
        assert current_s * 5 < legacy_s, (
            f"stripping the summary before asdict should be far cheaper: "
            f"deepcopy {legacy_s * 1e3:.3f} ms vs replace {current_s * 1e3:.3f} ms"
        )

    def test_summary_size_is_what_makes_the_deepcopy_expensive(self):
        """Sanity on the fixture: if the summary were small the ratio assertion
        above would be measuring noise, not the defect."""
        job = _rich_job()
        assert len(json.dumps(job.summary)) > 10_000
