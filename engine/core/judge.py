"""Decide which candidate moments are real events and how they went.

One model call sees a low-res copy of the video with the athlete boxed and the
candidates numbered. If the model is unavailable the same candidates are kept,
labelled generically, and coaching text is generated from the measurements.
"""

import logging
import os
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel

from . import config, failures, llm, measure, prompts, provenance, video
from .errors import Cancelled
from .motion import Candidate
from .sports import KNOWN, Pack
from .track import Track

log = logging.getLogger("engine.judge")


class Rating(BaseModel):
    criterion: str
    rating: Literal["good", "needs_work", "poor", "unclear",
                    "not_demonstrated", "inconsistent", "functional", "consistent",
                    "unable_to_assess", "not_applicable"]


class Verdict(BaseModel):
    candidate: int
    is_event: bool
    event_type: str
    result: str
    ratings: list[Rating]
    feedback: str
    confidence: float
    # Optional analyst annotations. Defaults keep old cached judgements and the
    # rule-based path loadable without a migration.
    tags: list[str] = []
    pressure: str = "unknown"
    # confirmed / rejected / uncertain. ``is_event`` is kept for old clients;
    # the lifecycle state is the research-facing field.
    state: Literal["confirmed", "rejected", "uncertain"] | None = None


class Review(BaseModel):
    sport: str
    events: list[Verdict]
    summary: str
    strengths: list[str]
    focus_areas: list[str]
    priority_drill: str
    tactical_summary: str = ""
    key_insights: list[str] = []


@dataclass
class Judgement:
    source: str  # "model" or "rules"
    sport: str
    verdicts: dict[int, dict] = field(default_factory=dict)  # keyed by candidate index
    summary: str = ""
    strengths: list[str] = field(default_factory=list)
    focus_areas: list[str] = field(default_factory=list)
    priority_drill: str = ""
    tactical_summary: str = ""
    key_insights: list[str] = field(default_factory=list)
    model: str | None = None
    reason: str | None = None
    prompt_hash: str | None = None
    judged_at: str | None = None
    failures: list[dict] = field(default_factory=list)


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


def _clean_tags(tags: list[str]) -> list[str]:
    """Short, de-duplicated labels; model text is data, never markup."""
    out, seen = [], set()
    for tag in tags:
        text = " ".join(str(tag).split())[:40]
        key = text.lower()
        if text and key not in seen:
            seen.add(key)
            out.append(text)
    return out[:5]


def _clean(v: Verdict, pack: Pack) -> dict:
    kind = v.event_type if v.event_type in pack.event_types else ("other" if "other" in pack.event_types else pack.event_types[0])
    result = v.result if v.result in pack.results else "unknown"
    pressure = v.pressure if v.pressure in ("open", "contested", "tight") else "unknown"
    confidence = max(0.0, min(1.0, v.confidence))
    if v.state in ("confirmed", "rejected", "uncertain"):
        state = v.state
    elif not v.is_event:
        state = "rejected"
    elif confidence < 0.5:
        state = "uncertain"
    else:
        state = "confirmed"
    return {
        "is_event": v.is_event, "state": state, "type": kind, "result": result,
        "feedback": v.feedback.strip(), "confidence": confidence,
        "ratings": {r.criterion: r.rating for r in v.ratings},
        "tags": _clean_tags(v.tags), "pressure": pressure,
    }


def rules(cands: list[Candidate], pack: Pack, reason: str,
          failure_list: list[dict] | None = None) -> Judgement:
    """Rule-based fallback.

    Candidates are deliberately left in the ``candidate`` state. A motion peak
    is not a confirmed sports action until a deterministic event rule has been
    separately validated, which is not the case here.
    """
    kind = "other" if "other" in pack.event_types else pack.event_types[0]
    verdicts = {i: {"is_event": True, "state": "candidate", "type": kind, "result": "unknown",
                    "feedback": "", "confidence": 0.5, "ratings": {}, "tags": [],
                    "pressure": "unknown"} for i in range(len(cands))}
    return Judgement(source="rules", sport=pack.name, verdicts=verdicts, reason=reason,
                     judged_at=datetime.now(timezone.utc).isoformat(),
                     failures=list(failure_list or []))


def reconcile(judgement: Judgement, pack: Pack) -> Judgement:
    """Normalise verdict vocabulary after the sport was identified mid-pipeline."""
    fallback_type = "other" if "other" in pack.event_types else pack.event_types[0]
    fallback_result = ("unknown" if "unknown" in pack.results
                       else pack.neutral[0] if pack.neutral
                       else pack.results[0] if pack.results else "unknown")
    for verdict in judgement.verdicts.values():
        if verdict["type"] not in pack.event_types:
            verdict["type"] = fallback_type
        if verdict["result"] not in pack.results:
            verdict["result"] = fallback_result
    judgement.sport = pack.name
    return judgement


def review(track: Track, cands: list[Candidate], measured: list[dict], pack: Pack, path: str, *,
           sport_known: bool, make_llm=llm.default, workdir: str | None = None,
           cancelled=lambda: None) -> Judgement:
    if not cands:
        return rules(cands, pack, "no candidate moments")
    fd, proxy = tempfile.mkstemp(suffix=".mp4", dir=workdir)
    os.close(fd)
    uploaded = None
    model = None
    failure_list: list[dict] = []
    system = prompts.judge_system(pack, sport_known)
    user = ""
    prompt_digest = None
    try:
        model = make_llm()
        marks = [(c.t - 1.0, c.t + 0.8, f"#{n}") for n, c in enumerate(cands, 1)]
        segments = video.build_proxy(path, proxy, box_at=track.box_at, marks=marks, windows=_windows(track, cands),
                                     fps=config.settings.proxy_fps, cancelled=cancelled)
        moments = []
        for n, (c, m) in enumerate(zip(cands, measured, strict=False), 1):
            reel = video.to_reel(segments, c.t)
            if reel is None:
                continue
            numbers = [f"{r['label']} {r['value']:.0f}°" for r in m["criteria"] if r["value"] is not None]
            moments.append({"n": n, "time": reel, "measured": numbers})
        user = prompts.judge_prompt(pack, sport_known, moments)
        prompt_digest = provenance.prompt_hash(system, user)
        part, uploaded = model.video_part(proxy, config.settings.proxy_fps)
        used, out = model.structured([part, user], Review, system=system, video=True)
    except llm.Unavailable as exc:
        log.warning("model unavailable, using rules: %s", exc.message)
        failure_list.append(failures.failure(
            "F11_VLM_UNAVAILABLE", "judge", exc.message, retryable=True).to_dict())
        return rules(cands, pack, exc.message, failure_list=failure_list)
    except Cancelled:
        raise
    except Exception as exc:
        log.exception("judging failed, using rules")
        if isinstance(exc, (ValueError, TypeError)):
            failure_list.append(failures.failure(
                "F12_INVALID_STRUCTURED_RESPONSE", "judge",
                f"structured response could not be parsed: {type(exc).__name__}").to_dict())
        return rules(cands, pack, f"judging failed: {type(exc).__name__}", failure_list=failure_list)
    finally:
        if uploaded and model is not None:
            model.drop_file(uploaded)
        if os.path.exists(proxy):
            os.unlink(proxy)

    sport = out.sport if out.sport in KNOWN else pack.name
    verdicts = {v.candidate - 1: _clean(v, pack) for v in out.events if 1 <= v.candidate <= len(cands)}
    for i in range(len(cands)):
        verdicts.setdefault(i, {"is_event": False, "state": "rejected", "type": "other",
                                "result": "unknown", "feedback": "", "confidence": 0.0,
                                "ratings": {}, "tags": [], "pressure": "unknown"})
    return Judgement(source="model", sport=sport, verdicts=verdicts, summary=out.summary.strip(),
                     strengths=out.strengths[:3], focus_areas=out.focus_areas[:3],
                     priority_drill=out.priority_drill.strip(),
                     tactical_summary=out.tactical_summary.strip(), key_insights=out.key_insights[:4],
                     model=used, prompt_hash=prompt_digest,
                     judged_at=datetime.now(timezone.utc).isoformat(),
                     failures=failure_list)


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
