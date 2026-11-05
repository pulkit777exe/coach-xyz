"""Combine track, evidence and verdicts into the result the server stores."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone

import numpy as np

from . import config, evidence, failures, judge, measure, metrics, performance, provenance
from .judge import Judgement
from .motion import Candidate
from .sports import Pack
from .track import Track

SCHEMA_VERSION = 5


def _band(conf: float) -> str:
    return "high" if conf >= 0.75 else "moderate" if conf >= 0.5 else "needs_review"


def _severity(score: float | None) -> str:
    if score is None:
        return "medium"
    return "low" if score >= 8 else "medium" if score >= 5 else "high"


def _event_state(verdict: dict) -> str:
    state = verdict.get("state")
    if state in ("candidate", "confirmed", "rejected", "uncertain"):
        return state
    return "confirmed" if verdict.get("is_event") else "rejected"


def _events(job_id: str, track: Track, cands: list[Candidate], judgement: Judgement, pack: Pack,
            angle: str | None, matchups: dict[int, dict] | None = None,
            research_mode: bool = False) -> list[dict]:
    events = []
    for i, c in enumerate(cands):
        verdict = judgement.verdicts.get(i)
        if not verdict or not verdict["is_event"]:
            continue
        rows = measure.measure(track, c.i, c.side, pack, angle=angle,
                               research=research_mode)["criteria"]
        measure.apply_ratings(rows, verdict["ratings"])
        detail = measure.combine_detail(rows)
        score, coverage = detail["value"], detail["coverage"]
        state = _event_state(verdict)
        k = len(events) + 1
        pose_conf = float(track.conf[c.i])
        confidence = pose_conf if judgement.source == "rules" else min(pose_conf, verdict["confidence"])
        source = "measured" if score is not None else None
        event_metrics = metrics.event_metrics(track, c.i, c.side, pack)
        matchup = (matchups or {}).get(c.i)
        if matchup and matchup.get("primary"):
            # The primary role is the athlete we already measure; reuse those numbers
            # so the session average, the banner and the two-player panel agree.
            matchup = {**matchup, "primary": {**matchup["primary"], "metrics": event_metrics}}
        events.append({
            "id": f"{job_id}:e{k}", "index": k, "type": verdict["type"], "t": round(c.t, 2),
            "side": c.side, "result": verdict["result"], "score": score, "score_source": source,
            "coverage": coverage, "coverage_detail": detail,
            "event_state": state, "confirmed": state == "confirmed",
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
            if evidence.is_scorable(row.get("source"), row.get("state")) and row["value"] is not None:
                by_key.setdefault(row["key"], []).append(row["value"])
                meta[row["key"]] = row
    out = []
    for key, vals in by_key.items():
        if len(vals) >= 3:
            out.append({"key": key, "label": meta[key]["label"], "n": len(vals),
                        "mean": round(float(np.mean(vals)), 1), "sd": round(float(np.std(vals)), 1),
                        "ideal": meta[key]["ideal"]})
    return out


def _findings(events: list[dict], track: Track, fps: float, pack: Pack, provenance_block: dict) -> list[dict]:
    out = []
    for event in events:
        near = np.flatnonzero(track.valid & (np.abs(track.t - event["t"]) <= 0.5))
        frames = [int(round(track.t[j] * fps)) for j in near]
        band = _band(event["confidence"])
        confirmed = bool(event.get("confirmed"))
        out.append({
            "id": event["id"], "category": event["type"], "start_ms": int(event["t"] * 1000),
            "end_ms": int((event["t"] + pack.display_s) * 1000), "confidence": event["confidence"],
            "confidence_band": band, "severity": _severity(event["score"]),
            "observation": event["feedback"], "feedback": event["feedback"],
            "form_score": event["score"], "evidence_frames": frames,
            "measured_at_timestamp": event["t"], "model_versions": provenance_block,
            "event_state": event.get("event_state"), "confirmed": confirmed,
            "review_state": "needs_review" if not confirmed or band == "needs_review" or len(frames) < 3 else "auto",
        })
    return out


def _session_text(events: list[dict], stats: dict, pack: Pack, judgement: Judgement,
                  session_metrics: list[dict], professional: dict) -> dict:
    """Model-written summary when there is one, otherwise a short factual one from the numbers."""
    scored: dict[str, list[float]] = {}
    for event in events:
        for row in event["measurements"]:
            if row["score"] is not None and evidence.is_scorable(row.get("source"), row.get("state")):
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


def _composite(events: list[dict], avg: float | None) -> dict:
    coverages = [float(e["coverage"]) for e in events if e["score"] is not None]
    return {
        "value": avg,
        "scale": "0-10",
        "status": "experimental_unvalidated" if avg is not None else "not_available",
        "validated": False,
        "method": "weighted_ideal_ranges_v1",
        "coverage": round(float(np.mean(coverages)), 2) if coverages else None,
        "minimum_coverage": measure.MIN_MEASURED_COVERAGE,
        "excluded_from_research": True,
        "reason": None if avg is not None else "insufficient valid measured criteria",
    }


def _event_detection(cands: list[Candidate], judgement: Judgement) -> dict:
    states = Counter(_event_state(v) for v in judgement.verdicts.values())
    return {
        "method": "motion_peak_plus_model_review" if judgement.source == "model" else "motion_peak_rules",
        "candidate_count": len(cands),
        "confirmed": states.get("confirmed", 0),
        "uncertain": states.get("uncertain", 0),
        "rejected": states.get("rejected", 0),
        "candidate": states.get("candidate", 0),
        "validation_status": "unvalidated",
        "note": "motion peaks are candidates until an independently validated event rule or model confirms them",
    }


def _criteria_registry(pack: Pack) -> list[dict]:
    """Paper -> pack -> measurement traceability for every configured criterion."""
    paper = {c.get("criterion_id"): c for c in pack.paper_criteria if c.get("criterion_id")}
    registry = []
    for c in pack.criteria:
        entry = paper.get(c.criterion_id or "")
        registry.append({
            "criterion_id": c.criterion_id or c.key,
            "engine_key": c.key,
            "label": c.label,
            "evidence_type": c.evidence_type,
            "validation_status": c.validation_status,
            "measurement_type": c.measurement_type,
            "calibration": c.calibration,
            "allowed_views": list(c.allowed_views or ()),
            "phase_scope": list(c.phase_scope),
            "required_landmarks": list(c.required_landmarks),
            "required_objects": list(c.required_objects),
            "quality_gate": c.quality_gate,
            "implementation": (entry or {}).get("implementation", "engine_only"),
            "paper_definition": (entry or {}).get("definition"),
            "implementation_note": c.implementation_note,
            "abstention_states": list(c.abstention_states),
        })
    implemented = {c.criterion_id for c in pack.criteria if c.criterion_id}
    for cid, entry in paper.items():
        if cid not in implemented:
            registry.append({
                "criterion_id": cid,
                "engine_key": None,
                "label": entry.get("definition"),
                "evidence_type": entry.get("evidence_class"),
                "validation_status": "proposed",
                "implementation": entry.get("implementation", "not_implemented"),
                "paper_definition": entry.get("definition"),
                "implementation_note": entry.get("note", ""),
            })
    return registry


def build(job_id: str, params: dict, pack: Pack, track: Track, media, cands: list[Candidate],
          judgement: Judgement, degraded: list[str], angle: str | None = None,
          angle_source: str = "unknown", video_sha256: str | None = None,
          failures_list: list[dict] | None = None, pack_changed_after_judge: bool = False,
          matchups: dict[int, dict] | None = None, research_mode: bool = False,
          detected_angle: str | None = None) -> dict:
    failures_list = list(failures_list or [])
    old_provenance = {
        "engine": config.ENGINE_VERSION, "pipeline": config.PIPELINE_VERSION, "prompt": config.PROMPT_VERSION,
        "sport_pack": pack.version, "judged_by": judgement.source, "model": judgement.model,
        "pose_model": config.settings.pose_model, "analyzed_at": datetime.now(timezone.utc).isoformat(),
        "judged_at": judgement.judged_at, "prompt_hash": judgement.prompt_hash,
        "video_sha256": video_sha256, "angle_source": angle_source,
        "pack_changed_after_judge": pack_changed_after_judge,
    }
    manifest = provenance.build(
        pack=pack, media=media, video_sha256=video_sha256, judgement=judgement,
        angle=angle or params.get("angle"), angle_source=angle_source,
        detected_angle=detected_angle,
        pack_changed_after_judge=pack_changed_after_judge,
        research_mode=research_mode,
        preprocessing={"analysis_fps": config.settings.analysis_fps,
                       "proxy_fps": config.settings.proxy_fps,
                       "proxy_max_s": config.settings.proxy_max_s,
                       "smoothing": "3-tap visibility-weighted, 0.8 s gap bridge"},
    )
    provenance_block = {**old_provenance, "manifest": manifest,
                        "sport_pack_manifest": manifest["sport_pack"]}

    events = _events(job_id, track, cands, judgement, pack, angle or params.get("angle"),
                     matchups, research_mode=research_mode)
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
    findings = _findings(events, track, media.fps, pack, provenance_block)
    composite = _composite(events, avg)
    event_detection = _event_detection(cands, judgement)

    issues = []
    if track.coverage < 0.5:
        issues.append("low_track_coverage")
    if track.valid.any() and mean_conf < 0.45:
        issues.append("low_pose_confidence")
    if not events:
        issues.append("no_events")
    if events and not scored:
        issues.append("no_measurable_events")
        issues.append("insufficient_measurement_coverage")
    if any(e.get("event_state") == "candidate" for e in events):
        issues.append("unconfirmed_candidate_events")
    return {
        "schema_version": SCHEMA_VERSION, "job_id": job_id, "sport": pack.name,
        "action_id": pack.action_id or None, "sport_pack_version": pack.pack_version or str(pack.version),
        "job_status": failures.status_for("completed", degraded, failures_list),
        "angle": angle or params.get("angle"), "angle_source": angle_source,
        "detected_angle": detected_angle,
        "research_mode": bool(research_mode),
        "aggregation": pack.aggregation,
        "fallback_policy": pack.fallback or None,
        "video": {"duration": round(media.duration, 2), "fps": round(media.fps, 2),
                  "width": track.width, "height": track.height,
                  "codec": getattr(media, "codec", "") or None, "sha256": video_sha256},
        "athlete": {"track_coverage": round(track.coverage, 2), "mean_confidence": round(mean_conf, 2),
                    "longest_gap_s": round(track.longest_gap_s, 2)},
        "summary": {**stats, "rating": measure.rating_label(avg),
                    "rating_status": "experimental_unvalidated" if avg is not None else "not_available",
                    "composite": composite, "scoring_status": composite["status"], **text},
        "events": events, "findings": findings, "consistency": consistency,
        "criteria_registry": _criteria_registry(pack),
        "session_metrics": session_metrics, "stats": professional,
        "event_detection": event_detection,
        "failures": failures_list,
        "quality": {"passed": not issues, "issues": issues},
        "needs_review": bool(issues) or any(f["review_state"] == "needs_review" for f in findings),
        "degraded": degraded, "provenance": provenance_block,
        "recommended_angles": pack.camera_angles,
        "scope_note": pack.scope_note or None,
    }
