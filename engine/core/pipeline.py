"""prepare -> track -> candidates -> judge -> result -> render -> publish.

The track stage is internal: it finds the moments and measures the action
player. It is not a tracking product. At result time each event is paired with
the nearest opponent, so the video and the results describe the two players who
mattered, not a box following someone for the whole clip.

Each stage reports through events. Tracking and the model's verdicts are
cached by content, so a retry, or the same clip analysed twice, skips straight
past the expensive work.
"""

import hashlib
import json
import logging
import os
import time
from contextlib import contextmanager
from pathlib import Path

import numpy as np

from . import (
    config,
    events,
    exports,
    failures,
    geometry,
    jobs,
    judge,
    llm,
    matchup,
    measure,
    motion,
    pose,
    provenance,
    render,
    result,
    sports,
    storage,
    video,
)
from .errors import Cancelled, EngineError
from .judge import Judgement
from .motion import Candidate
from .sports import Pack
from .track import Lock, Track, clean, track_athlete

log = logging.getLogger("engine.pipeline")

make_detector = pose.create
make_model = llm.default


class Reporter:
    def __init__(self, job_id: str):
        self.job_id = job_id
        self._last = 0.0

    def check(self) -> None:
        if jobs.is_cancelled(self.job_id):
            raise Cancelled()

    @contextmanager
    def stage(self, name: str, lo: int, hi: int):
        jobs.set_stage(self.job_id, name, lo)
        events.emit(self.job_id, "stage.started", {"stage": name, "progress": lo})
        began = time.time()

        def tick(fraction: float) -> None:
            now = time.time()
            if now - self._last < 1.0:
                return
            self._last = now
            pct = int(lo + (hi - lo) * max(0.0, min(1.0, fraction)))
            jobs.set_stage(self.job_id, name, pct)
            events.emit(
                self.job_id,
                "stage.progress",
                {"stage": name, "progress": pct},
                webhook=False,
            )

        yield tick
        events.emit(
            self.job_id,
            "stage.completed",
            {"stage": name, "ms": int((time.time() - began) * 1000)},
        )


def _digest(*parts) -> str:
    return hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:20]


def _publish(job_id: str, store, name: str, path: str, kind: str) -> None:
    key = storage.result_key(job_id, name)
    store.put(key, path)
    events.emit(job_id, "artifact.ready", {"name": name, "kind": kind, "key": key})


def _load_judgement(path: Path) -> Judgement | None:
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text())
        if not isinstance(raw, dict):
            return None
        verdicts = raw.get("verdicts")
        if not isinstance(verdicts, dict):
            return None
        normalized = {}
        for k, v in verdicts.items():
            try:
                normalized[int(k)] = v
            except Exception:
                continue
        raw = {**raw, "verdicts": normalized}
        return Judgement(**raw)
    except Exception:
        log.warning("ignoring unreadable judgement cache: %s", path, exc_info=True)
        return None


def _save_judgement(path: Path, j: Judgement) -> None:
    path.write_text(json.dumps(j.__dict__))


@contextmanager
def _detector():
    """Create a pose detector and always release its resources."""
    detector = make_detector()
    try:
        yield detector
    finally:
        close = getattr(detector, "close", None)
        if callable(close):
            close()


def _read_matchups(path: Path) -> dict[int, dict] | None:
    if not path.is_file():
        return None
    try:
        return {int(k): v for k, v in json.loads(path.read_text()).items()}
    except (OSError, ValueError, TypeError, AttributeError):
        log.warning("ignoring unreadable matchup cache: %s", path, exc_info=True)
        return None


def _matchup_blocks(
    src: str,
    track: Track,
    cands: list[Candidate],
    pack: Pack,
    path: Path,
    progress,
    cancelled,
) -> dict[int, dict]:
    cached = _read_matchups(path)
    if cached is not None:
        return cached
    try:
        with _detector() as detector:
            found = matchup.analyse(
                src,
                detector,
                track,
                cands,
                pack,
                progress=progress,
                cancelled=cancelled,
            )
    except Cancelled:
        raise
    except Exception:
        log.exception("matchup analysis failed")
        return {}
    if found:
        try:
            def _json_default(o):
                if isinstance(o, np.generic):
                    return o.item()
                raise TypeError(f"Object of type {o.__class__.__name__} is not JSON serializable")

            path.write_text(json.dumps(found, default=_json_default))
        except OSError:
            log.warning("could not cache matchup analysis: %s", path, exc_info=True)
    return found


def run(job_id: str, params: dict) -> dict:
    s = config.settings
    rep = Reporter(job_id)
    store = storage.backend()
    cache = s.data_dir / "cache"
    work = s.data_dir / "work" / job_id
    cache.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    degraded: list[str] = []
    failure_list: list[dict] = []

    def degrade(component: str, reason: str) -> None:
        degraded.append(component)
        jobs.degrade(job_id, component, reason)

    with store.local_copy(params["video_key"]) as src:
        with rep.stage("prepare", 0, 4):
            media = video.probe(src)
            sha = params.get("sha256") or video.sha256_file(src)
            rep.check()

        sport_known = bool(params.get("sport"))
        pack = sports.load(params.get("sport"))

        track_key = _digest(
            sha,
            json.dumps(params.get("player"), sort_keys=True),
            s.pose_model,
            s.analysis_fps,
            config.PIPELINE_VERSION,
        )
        track_file = cache / f"{track_key}.npz"
        with rep.stage("track", 4, 52) as tick:
            track = None
            if track_file.is_file():
                try:
                    track = Track.load(str(track_file))
                except Exception:
                    log.warning("ignoring unreadable track cache: %s", track_file, exc_info=True)
                    track = None
            if track is None:
                with _detector() as detector:
                    track = track_athlete(
                        src,
                        detector,
                        Lock.from_player(params.get("player")),
                        rate=s.analysis_fps,
                        progress=tick,
                        cancelled=rep.check,
                    )
                for ev in getattr(track, "identity_events", []):
                    detail = {
                        k: v
                        for k, v in ev.items()
                        if k not in ("code", "stage", "message")
                    }
                    failure_list.append(
                        failures.failure(
                            ev.get("code", "F02_IDENTITY_SWITCH"),
                            ev.get("stage", "track"),
                            ev.get("message", "identity reacquisition issue"),
                            **detail,
                        ).to_dict()
                    )
                track = clean(track)
                track.save(str(track_file))

        with rep.stage("candidates", 52, 55):
            cands = motion.candidates(track, pack)
            events.emit(
                job_id, "candidates.found", {"count": len(cands)}, webhook=False
            )
            found = np.flatnonzero(track.valid)
            angle_tag = (
                geometry.classify_angle(
                    track.lm[int(found[0])], track.width, track.height
                )
                if len(found)
                else None
            )
            declared_angle = params.get("angle")
            declared_view = (
                None if declared_angle in measure.UNDECLARED_VIEWS else declared_angle
            )
            # Research runs are fail-closed: only a declared view may qualify
            # a camera-gated criterion; the auto-classifier is a convenience
            # for the product UI, not research evidence. In product mode the
            # classifier labels the footage but never gates measurements.
            research_mode = bool(params.get("research")) or os.environ.get(
                "ENGINE_RESEARCH_MODE", ""
            ).lower() in ("1", "true", "yes")
            detected_angle = angle_tag
            if research_mode:
                effective_angle = declared_view or "primary"
                angle_source = "declared" if declared_view else "default"
            elif declared_view:
                effective_angle = declared_view
                angle_source = "declared"
            else:
                # Undeclared product runs must not present camera-gated
                # criteria as verified measurements.
                effective_angle = None
                angle_source = "detected" if angle_tag else "default"
            measured = [
                measure.measure(
                    track,
                    c.i,
                    c.side,
                    pack,
                    angle=effective_angle,
                    research=research_mode,
                )
                for c in cands
            ]
            view_issue = next(
                (
                    r.get("state")
                    for m in measured
                    for r in m.get("criteria", [])
                    if r.get("state") in ("view_unverified", "invalid_view")
                ),
                None,
            )
            if view_issue and not any(
                f.get("code") == "F05_UNSUITABLE_VIEW" for f in failure_list
            ):
                affected = sorted(
                    {
                        r.get("criterion_id") or r.get("key")
                        for m in measured
                        for r in m.get("criteria", [])
                        if r.get("state") in ("view_unverified", "invalid_view")
                        and (r.get("criterion_id") or r.get("key"))
                    }
                )
                detail = {"view_state": view_issue}
                if effective_angle:
                    detail["effective_angle"] = effective_angle
                if detected_angle:
                    detail["detected_angle"] = detected_angle
                if affected:
                    detail["affected_criteria"] = affected[:8]
                failure_list.append(
                    failures.failure(
                        "F05_UNSUITABLE_VIEW",
                        "measure",
                        "camera view is undeclared or unsuitable for one or more criteria",
                        **detail,
                    ).to_dict()
                )
            rep.check()

        judge_key = _digest(
            track_key,
            params.get("sport"),
            pack.version,
            pack.checksum,
            ",".join(s.gemini_models),
            config.PROMPT_VERSION,
            provenance.prompts_source_hash(),
        )
        judge_file = cache / f"{judge_key}.json"
        pack_changed_after_judge = False
        with rep.stage("judge", 55, 75):
            judgement = _load_judgement(judge_file)
            if judgement is None:
                judgement = judge.review(
                    track,
                    cands,
                    measured,
                    pack,
                    src,
                    sport_known=sport_known,
                    make_llm=make_model,
                    workdir=str(work),
                    cancelled=rep.check,
                )
                if judgement.source == "model":
                    _save_judgement(judge_file, judgement)
            failure_list.extend(judgement.failures)
            if judgement.source == "rules":
                degrade("llm", judgement.reason or "model unavailable")
                if not any(
                    f.get("code") == "F11_VLM_UNAVAILABLE" for f in failure_list
                ):
                    failure_list.append(
                        failures.failure(
                            "F11_VLM_UNAVAILABLE",
                            "judge",
                            judgement.reason or "model unavailable",
                            retryable=True,
                        ).to_dict()
                    )
                cands = motion.candidates(track, pack, strict=True)
                judgement = judge.rules(
                    cands, pack, judgement.reason or "", failure_list=failure_list
                )
            elif not sport_known:
                detected = sports.load(judgement.sport)
                if detected.name != pack.name:
                    pack = detected
                    pack_changed_after_judge = True
                    judgement = judge.reconcile(judgement, pack)
            rep.check()

        with rep.stage("result", 75, 80) as tick:
            matchups: dict[int, dict] = {}
            if cands:
                matchup_key = _digest(
                    track_key,
                    pack.name,
                    pack.version,
                    pack.checksum,
                    ",".join(f"{c.i}:{c.t:.2f}" for c in cands),
                )
                matchups = _matchup_blocks(
                    src,
                    track,
                    cands,
                    pack,
                    cache / f"{matchup_key}.json",
                    tick,
                    rep.check,
                )
            out = result.build(
                job_id,
                params,
                pack,
                track,
                media,
                cands,
                judgement,
                degraded,
                angle=effective_angle,
                angle_source=angle_source,
                detected_angle=detected_angle,
                video_sha256=sha,
                failures_list=failure_list,
                pack_changed_after_judge=pack_changed_after_judge,
                research_mode=research_mode,
                matchups=matchups,
            )
            files = exports.write_all(out, str(work))
            overlay = work / "track.json"
            overlay.write_text(json.dumps(track.overlay(), separators=(",", ":")))
            for name, path in files.items():
                _publish(job_id, store, name, path, "export")
            _publish(job_id, store, "track.json", str(overlay), "overlay")
            events.emit(
                job_id,
                "result.ready",
                {
                    "summary": out["summary"],
                    "needs_review": out["needs_review"],
                    "quality": out["quality"],
                },
            )

        if params.get("render", True):
            if out["events"]:
                with rep.stage("render", 80, 96) as tick:
                    try:
                        video_path = str(work / "analysis.mp4")
                        thumbs = render.render(
                            src,
                            track,
                            out,
                            pack,
                            video_path,
                            media,
                            thumbs_dir=str(work / "thumbs"),
                            progress=tick,
                            cancelled=rep.check,
                        )
                        _publish(job_id, store, "analysis.mp4", video_path, "video")
                        for t in thumbs:
                            _publish(
                                job_id, store, f"thumbs/{Path(t).name}", t, "thumbnail"
                            )
                    except Cancelled:
                        raise
                    except Exception as exc:
                        log.exception("render failed")
                        degrade(
                            "render",
                            exc.message
                            if isinstance(exc, EngineError)
                            else type(exc).__name__,
                        )
            else:
                with rep.stage("render", 80, 96):
                    issues = (out.get("quality") or {}).get("issues") or []
                    if "no_events" in issues:
                        reason = "No confirmed actions were detected in this clip."
                    elif "no_measurable_events" in issues:
                        reason = "Actions were found but none could be measured reliably."
                    else:
                        reason = "No confirmed actions were detected in this clip."
                    try:
                        video_path = str(work / "analysis.mp4")
                        render.render_empty(src, out, pack, video_path, media, reason=reason)
                        _publish(job_id, store, "analysis.mp4", video_path, "video")
                    except Cancelled:
                        raise
                    except Exception as exc:
                        log.exception("empty render failed")
                        degrade(
                            "render",
                            exc.message
                            if isinstance(exc, EngineError)
                            else type(exc).__name__,
                        )

    return {**out["summary"], "needs_review": out["needs_review"]}
