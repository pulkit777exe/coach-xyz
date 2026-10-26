"""Combine track, measurements and verdicts into the result the server stores."""

from datetime import datetime, timezone

import numpy as np

from . import config, judge, measure
from .judge import Judgement
from .motion import Candidate
from .sports import Pack
from .track import Track

SCHEMA_VERSION = 2


def _band(conf: float) -> str:
    return "high" if conf >= 0.75 else "moderate" if conf >= 0.5 else "needs_review"


def _severity(score: float | None) -> str:
    if score is None:
        return "medium"
    return "low" if score >= 8 else "medium" if score >= 5 else "high"


def _events(job_id: str, track: Track, cands: list[Candidate], judgement: Judgement, pack: Pack) -> list[dict]:
    events = []
    for i, c in enumerate(cands):
        v = judgement.verdicts.get(i)
        if not v or not v["is_event"]:
            continue
        rows = measure.measure(track, c.i, c.side, pack)["criteria"]
        measure.apply_ratings(rows, v["ratings"])
        score, coverage = measure.combine(rows)
        k = len(events) + 1
        pose_conf = float(track.conf[c.i])
        conf = pose_conf if judgement.source == "rules" else min(pose_conf, v["confidence"])
        source = None if score is None else ("measured" if any(r["source"] == "pose" for r in rows) else "judged")
        events.append({
            "id": f"{job_id}:e{k}", "index": k, "type": v["type"], "t": round(c.t, 2), "side": c.side,
            "result": v["result"], "score": score, "score_source": source, "coverage": coverage,
            "feedback": v["feedback"] or judge.event_feedback(rows, pack),
            "confidence": round(conf, 2), "measurements": rows,
        })
    return events


def _consistency(events: list[dict]) -> list[dict]:
    by_key: dict[str, list[float]] = {}
    meta: dict[str, dict] = {}
    for e in events:
        for r in e["measurements"]:
            if r["source"] == "pose":
                by_key.setdefault(r["key"], []).append(r["value"])
                meta[r["key"]] = r
    out = []
    for key, vals in by_key.items():
        if len(vals) >= 3:
            out.append({"key": key, "label": meta[key]["label"], "n": len(vals), "mean": round(float(np.mean(vals)), 1),
                        "sd": round(float(np.std(vals)), 1), "ideal": meta[key]["ideal"]})
    return out


def _findings(events: list[dict], track: Track, fps: float, pack: Pack, provenance: dict) -> list[dict]:
    out = []
    for e in events:
        near = np.flatnonzero(track.valid & (np.abs(track.t - e["t"]) <= 0.5))
        frames = [int(round(track.t[j] * fps)) for j in near]
        band = _band(e["confidence"])
        out.append({
            "id": e["id"], "category": e["type"], "start_ms": int(e["t"] * 1000),
            "end_ms": int((e["t"] + pack.display_s) * 1000), "confidence": e["confidence"],
            "confidence_band": band, "severity": _severity(e["score"]), "observation": e["feedback"],
            "feedback": e["feedback"], "form_score": e["score"], "evidence_frames": frames,
            "measured_at_timestamp": e["t"], "model_versions": provenance,
            "review_state": "needs_review" if band == "needs_review" or len(frames) < 3 else "auto",
        })
    return out


def _session_text(events: list[dict], stats: dict, consistency: list[dict], pack: Pack, judgement: Judgement) -> dict:
    """Model-written summary when there is one, otherwise a short factual one from the numbers."""
    scored: dict[str, list[float]] = {}
    for e in events:
        for r in e["measurements"]:
            if r["score"] is not None:
                scored.setdefault(r["key"], []).append(r["score"])
    means = {k: float(np.mean(v)) for k, v in scored.items()}
    label = {c.key: c.label for c in pack.criteria}
    drills = {c.key: c.drill for c in pack.criteria}
    strong = [label[k] for k, m in sorted(means.items(), key=lambda x: -x[1]) if m >= 0.85][:3]
    weak = [k for k, m in sorted(means.items(), key=lambda x: x[1]) if m < 0.75][:3]
    text = judgement.summary
    if not text:
        n = stats["events"]
        text = f"{n} moment{'s' if n != 1 else ''} analysed."
        if stats["average_score"] is not None:
            text += f" Average technique score {stats['average_score']}/10."
        if weak:
            text += f" Biggest focus: {label[weak[0]].lower()}."
    return {
        "text": text,
        "strengths": judgement.strengths or strong,
        "focus_areas": judgement.focus_areas or [label[k] for k in weak],
        "priority_drill": judgement.priority_drill or (drills.get(weak[0], "") if weak else ""),
    }


def build(job_id: str, params: dict, pack: Pack, track: Track, media, cands: list[Candidate],
          judgement: Judgement, degraded: list[str]) -> dict:
    provenance = {
        "engine": config.ENGINE_VERSION, "pipeline": config.PIPELINE_VERSION, "prompt": config.PROMPT_VERSION,
        "sport_pack": pack.version, "judged_by": judgement.source, "model": judgement.model,
        "pose_model": config.settings.pose_model, "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }
    events = _events(job_id, track, cands, judgement, pack)
    scored = [e["score"] for e in events if e["score"] is not None]
    made = sum(e["result"] in pack.positive for e in events)
    missed = sum(e["result"] in pack.negative for e in events)
    avg = round(float(np.mean(scored)), 1) if scored else None
    stats = {"events": len(events), "made": made, "missed": missed, "average_score": avg,
             "success_rate": round(100 * made / (made + missed), 1) if made + missed else None}
    consistency = _consistency(events)
    text = _session_text(events, stats, consistency, pack, judgement)
    findings = _findings(events, track, media.fps, pack, provenance)

    issues = []
    if track.coverage < 0.5:
        issues.append("low_track_coverage")
    if not events:
        issues.append("no_events")
    if events and not scored:
        issues.append("no_measurable_events")
    return {
        "schema_version": SCHEMA_VERSION, "job_id": job_id, "sport": pack.name, "angle": params.get("angle"),
        "video": {"duration": round(media.duration, 2), "fps": round(media.fps, 2),
                  "width": track.width, "height": track.height},
        "athlete": {"track_coverage": round(track.coverage, 2),
                    "mean_confidence": round(float(track.conf[track.valid].mean()), 2) if track.valid.any() else 0.0},
        "summary": {**stats, "rating": measure.rating_label(avg), **text},
        "events": events, "findings": findings, "consistency": consistency,
        "quality": {"passed": not issues, "issues": issues},
        "needs_review": bool(issues) or any(f["review_state"] == "needs_review" for f in findings),
        "degraded": degraded, "provenance": provenance,
        "recommended_angles": pack.camera_angles,
    }
