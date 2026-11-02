"""Combine track, measurements and verdicts into the result the server stores."""

from datetime import datetime, timezone

import numpy as np

from . import config, judge, measure, metrics, performance
from .judge import Judgement
from .motion import Candidate
from .sports import Pack
from .track import Track

SCHEMA_VERSION = 4


def _band(conf: float) -> str:
    return "high" if conf >= 0.75 else "moderate" if conf >= 0.5 else "needs_review"


def _severity(score: float | None) -> str:
    if score is None:
        return "medium"
    return "low" if score >= 8 else "medium" if score >= 5 else "high"


def _events(job_id: str, track: Track, cands: list[Candidate], judgement: Judgement, pack: Pack,
            angle: str | None, matchups: dict[int, dict] | None = None) -> list[dict]:
    events = []
    for i, c in enumerate(cands):
        verdict = judgement.verdicts.get(i)
        if not verdict or not verdict["is_event"]:
            continue
        rows = measure.measure(track, c.i, c.side, pack, angle=angle)["criteria"]
        measure.apply_ratings(rows, verdict["ratings"])
        score, coverage = measure.combine(rows)
        k = len(events) + 1
        pose_conf = float(track.conf[c.i])
        confidence = pose_conf if judgement.source == "rules" else min(pose_conf, verdict["confidence"])
        source = None if score is None else ("measured" if any(r["source"] == "pose" for r in rows) else "judged")
        event_metrics = metrics.event_metrics(track, c.i, c.side, pack)
        matchup = (matchups or {}).get(c.i)
        if matchup and matchup.get("primary"):
            # The primary role is the athlete we already measure; reuse those numbers
            # so the session average, the banner and the two-player panel agree.
            matchup = {**matchup, "primary": {**matchup["primary"], "metrics": event_metrics}}
        events.append({
            "id": f"{job_id}:e{k}", "index": k, "type": verdict["type"], "t": round(c.t, 2), "side": c.side,
            "result": verdict["result"], "score": score, "score_source": source, "coverage": coverage,
            "feedback": verdict["feedback"] or judge.event_feedback(rows, pack),
            "confidence": round(confidence, 2),
            "tags": list(verdict.get("tags") or []),
            "pressure": verdict.get("pressure") or "unknown",
            "measurements": rows,
            "metrics": event_metrics,
            "matchup": matchup,
        })
    return events


def _consistency(events: list[dict]) -> list[dict]:
    by_key: dict[str, list[float]] = {}
    meta: dict[str, dict] = {}
    for event in events:
        for row in event["measurements"]:
            if row["source"] == "pose" and row["value"] is not None:
                by_key.setdefault(row["key"], []).append(row["value"])
                meta[row["key"]] = row
    out = []
    for key, vals in by_key.items():
        if len(vals) >= 3:
            out.append({"key": key, "label": meta[key]["label"], "n": len(vals),
                        "mean": round(float(np.mean(vals)), 1), "sd": round(float(np.std(vals)), 1),
                        "ideal": meta[key]["ideal"]})
    return out


def _findings(events: list[dict], track: Track, fps: float, pack: Pack, provenance: dict) -> list[dict]:
    out = []
    for event in events:
        near = np.flatnonzero(track.valid & (np.abs(track.t - event["t"]) <= 0.5))
        frames = [int(round(track.t[j] * fps)) for j in near]
        band = _band(event["confidence"])
        out.append({
            "id": event["id"], "category": event["type"], "start_ms": int(event["t"] * 1000),
            "end_ms": int((event["t"] + pack.display_s) * 1000), "confidence": event["confidence"],
            "confidence_band": band, "severity": _severity(event["score"]), "observation": event["feedback"],
            "feedback": event["feedback"], "form_score": event["score"], "evidence_frames": frames,
            "measured_at_timestamp": event["t"], "model_versions": provenance,
            "review_state": "needs_review" if band == "needs_review" or len(frames) < 3 else "auto",
        })
    return out


def _session_text(events: list[dict], stats: dict, pack: Pack, judgement: Judgement,
                  session_metrics: list[dict], professional: dict) -> dict:
    """Model-written summary when there is one, otherwise a short factual one from the numbers."""
    scored: dict[str, list[float]] = {}
    for event in events:
        for row in event["measurements"]:
            if row["score"] is not None:
                scored.setdefault(row["key"], []).append(row["score"])
    means = {k: float(np.mean(v)) for k, v in scored.items()}
    label = {c.key: c.label for c in pack.criteria}
    drills = {c.key: c.drill for c in pack.criteria}
    strong = [label[k] for k, m in sorted(means.items(), key=lambda x: -x[1]) if m >= 0.85][:3]
    weak = [k for k, m in sorted(means.items(), key=lambda x: x[1]) if m < 0.75][:3]

    fallback_text, fallback_insights = performance.fallback_insights(pack, stats, professional)
    text = judgement.summary.strip()
    if not text:
        text = fallback_text
    kpis = [f"{m['label'].lower()} {m['value']} {m['unit']}".strip()
            for m in session_metrics if m.get("kind") == "metric"][:2]
    if kpis:
        text += " Measured: " + ", ".join(kpis) + "."
    pressure = next((m for m in session_metrics if m.get("key") == "opponent_distance"), None)
    if pressure:
        text += f" {pack.opponent_role} distance averaged {pressure['value']} torso lengths."
    return {
        "text": text,
        "strengths": judgement.strengths or strong,
        "focus_areas": judgement.focus_areas or [label[k] for k in weak],
        "priority_drill": judgement.priority_drill or (drills.get(weak[0], "") if weak else ""),
        "tactical_summary": judgement.tactical_summary.strip() or fallback_text,
        "key_insights": judgement.key_insights or fallback_insights,
    }


def build(job_id: str, params: dict, pack: Pack, track: Track, media, cands: list[Candidate],
          judgement: Judgement, degraded: list[str], angle: str | None = None,
          matchups: dict[int, dict] | None = None) -> dict:
    provenance = {
        "engine": config.ENGINE_VERSION, "pipeline": config.PIPELINE_VERSION, "prompt": config.PROMPT_VERSION,
        "sport_pack": pack.version, "judged_by": judgement.source, "model": judgement.model,
        "pose_model": config.settings.pose_model, "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }
    events = _events(job_id, track, cands, judgement, pack, angle or params.get("angle"), matchups)
    scored = [e["score"] for e in events if e["score"] is not None]
    made = sum(e["result"] in pack.positive for e in events)
    missed = sum(e["result"] in pack.negative for e in events)
    avg = round(float(np.mean(scored)), 1) if scored else None
    mean_conf = float(track.conf[track.valid].mean()) if track.valid.any() else 0.0
    event_conf = float(np.mean([e["confidence"] for e in events])) if events else mean_conf
    stats = {"events": len(events), "made": made, "missed": missed, "average_score": avg,
             "success_rate": round(100 * made / (made + missed), 1) if made + missed else None,
             "confidence": round(event_conf, 2)}
    consistency = _consistency(events)
    session_metrics = metrics.session_metrics(track, events, pack) + metrics.matchup_metrics(events, pack)
    professional = performance.build(pack, events, session_metrics, consistency, stats)
    text = _session_text(events, stats, pack, judgement, session_metrics, professional)
    findings = _findings(events, track, media.fps, pack, provenance)

    issues = []
    if track.coverage < 0.5:
        issues.append("low_track_coverage")
    if track.valid.any() and mean_conf < 0.45:
        issues.append("low_pose_confidence")
    if not events:
        issues.append("no_events")
    if events and not scored:
        issues.append("no_measurable_events")
    return {
        "schema_version": SCHEMA_VERSION, "job_id": job_id, "sport": pack.name,
        "angle": angle or params.get("angle"),
        "video": {"duration": round(media.duration, 2), "fps": round(media.fps, 2),
                  "width": track.width, "height": track.height},
        "athlete": {"track_coverage": round(track.coverage, 2), "mean_confidence": round(mean_conf, 2),
                    "longest_gap_s": round(track.longest_gap_s, 2)},
        "summary": {**stats, "rating": measure.rating_label(avg), **text},
        "events": events, "findings": findings, "consistency": consistency,
        "session_metrics": session_metrics, "stats": professional,
        "quality": {"passed": not issues, "issues": issues},
        "needs_review": bool(issues) or any(f["review_state"] == "needs_review" for f in findings),
        "degraded": degraded, "provenance": provenance,
        "recommended_angles": pack.camera_angles,
    }
