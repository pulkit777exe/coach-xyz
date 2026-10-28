"""Decide which candidate moments are real events and how they went.

One model call sees a low-res copy of the video with the athlete boxed and the
candidates numbered. If the model is unavailable the same candidates are kept,
labelled generically, and coaching text is generated from the measurements.
"""

import logging
import os
import tempfile
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel

from . import config, llm, measure, prompts, sports, video
from .errors import Cancelled
from .motion import Candidate
from .sports import KNOWN, Pack
from .track import Track

log = logging.getLogger("engine.judge")


class Rating(BaseModel):
    criterion: str
    rating: Literal["good", "needs_work", "poor", "unclear"]


class Verdict(BaseModel):
    candidate: int
    is_event: bool
    event_type: str
    result: str
    ratings: list[Rating]
    feedback: str
    confidence: float


class Review(BaseModel):
    sport: str
    events: list[Verdict]
    summary: str
    strengths: list[str]
    focus_areas: list[str]
    priority_drill: str


@dataclass
class Judgement:
    source: str  # "model" or "rules"
    sport: str
    verdicts: dict[int, dict] = field(default_factory=dict)  # keyed by candidate index
    summary: str = ""
    strengths: list[str] = field(default_factory=list)
    focus_areas: list[str] = field(default_factory=list)
    priority_drill: str = ""
    model: str | None = None
    reason: str | None = None


def _windows(track: Track, cands: list[Candidate]) -> list[tuple[float, float]] | None:
    budget = config.settings.proxy_max_s
    if track.t[-1] <= budget:
        return None
    spans, used = [], 0.0
    for c in sorted(cands, key=lambda c: -c.strength):
        a, b = max(0.0, c.t - 3.0), min(float(track.t[-1]), c.t + 2.5)
        if used + (b - a) > budget:
            continue
        spans.append((a, b))
        used += b - a
    merged: list[list[float]] = []
    for a, b in sorted(spans):
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return [(a, b) for a, b in merged]


def _clean(v: Verdict, pack: Pack) -> dict:
    kind = v.event_type if v.event_type in pack.event_types else ("other" if "other" in pack.event_types else pack.event_types[0])
    result = v.result if v.result in pack.results else "unknown"
    return {
        "is_event": v.is_event, "type": kind, "result": result, "feedback": v.feedback.strip(),
        "confidence": max(0.0, min(1.0, v.confidence)),
        "ratings": {r.criterion: r.rating for r in v.ratings},
    }


def rules(cands: list[Candidate], pack: Pack, reason: str) -> Judgement:
    kind = "other" if "other" in pack.event_types else pack.event_types[0]
    verdicts = {i: {"is_event": True, "type": kind, "result": "unknown", "feedback": "", "confidence": 0.5,
                    "ratings": {}} for i in range(len(cands))}
    return Judgement(source="rules", sport=pack.name, verdicts=verdicts, reason=reason)


def review(track: Track, cands: list[Candidate], measured: list[dict], pack: Pack, path: str, *,
           sport_known: bool, make_llm=llm.default, workdir: str | None = None,
           cancelled=lambda: None) -> Judgement:
    if not cands:
        return rules(cands, pack, "no candidate moments")
    fd, proxy = tempfile.mkstemp(suffix=".mp4", dir=workdir)
    os.close(fd)
    uploaded = None
    try:
        model = make_llm()
        marks = [(c.t - 1.0, c.t + 0.8, f"#{n}") for n, c in enumerate(cands, 1)]
        segments = video.build_proxy(path, proxy, box_at=track.box_at, marks=marks, windows=_windows(track, cands),
                                     fps=config.settings.proxy_fps, cancelled=cancelled)
        moments = []
        for n, (c, m) in enumerate(zip(cands, measured), 1):
            reel = video.to_reel(segments, c.t)
            if reel is None:
                continue
            numbers = [f"{r['label']} {r['value']:.0f}°" for r in m["criteria"] if r["value"] is not None]
            moments.append({"n": n, "time": reel, "measured": numbers})
        part, uploaded = model.video_part(proxy, config.settings.proxy_fps)
        used, out = model.structured([part, prompts.judge_prompt(pack, sport_known, moments)], Review,
                                     system=prompts.judge_system(pack, sport_known), video=True)
    except llm.Unavailable as exc:
        log.warning("model unavailable, using rules: %s", exc.message)
        return rules(cands, pack, exc.message)
    except Cancelled:
        raise
    except Exception as exc:
        log.exception("judging failed, using rules")
        return rules(cands, pack, f"judging failed: {type(exc).__name__}")
    finally:
        if uploaded:
            model.drop_file(uploaded)
        if os.path.exists(proxy):
            os.unlink(proxy)

    # Clean against the pack the model actually identified. When the sport was not
    # given, the prompt ran on `generic`, so cleaning with THAT pack coerced every
    # real event type and result down to "action"/neutral before the pipeline had a
    # chance to load the identified pack.
    sport = out.sport if out.sport in KNOWN else pack.name
    clean_pack = pack if sport == pack.name else sports.load(sport)
    verdicts = {v.candidate - 1: _clean(v, clean_pack) for v in out.events
                if 1 <= v.candidate <= len(cands)}
    for i in range(len(cands)):
        verdicts.setdefault(i, {"is_event": False, "type": "other", "result": "unknown", "feedback": "",
                                "confidence": 0.0, "ratings": {}})
    return Judgement(source="model", sport=sport, verdicts=verdicts, summary=out.summary.strip(),
                     strengths=out.strengths[:3], focus_areas=out.focus_areas[:3],
                     priority_drill=out.priority_drill.strip(), model=used)


def event_feedback(rows: list[dict], pack: Pack) -> str:
    """Coaching text from measurements alone."""
    bad = measure.deviations(rows)
    if bad:
        crit = next((c for c in pack.criteria if c.key == bad[0]["key"]), None)
        tip = f" Aim for: {crit.look_for}." if crit and crit.look_for else ""
        return f"{measure.describe(bad[0])}.{tip}"
    measured = [r for r in rows if r["source"] == "pose"]
    if measured:
        return "Mechanics look solid on this one; everything measured sits in the target range."
    return "Not enough of the body was visible here to measure the technique."
