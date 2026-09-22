"""core/findings.py — evidence-traceable Finding objects (§19 precursor).

A Finding is the unit a coach can click: recommendation → finding →
timestamp → clip/frames → model output. Derived deterministically from shot
events + biomechanics + sport config (never invented): low-evidence events
become `needs_review` instead of strong claims (§21).
"""

from __future__ import annotations

from typing import Any


def _confidence_band(confidence: float | None) -> str:
    if confidence is None:
        return "needs_review"
    if confidence >= 0.75:
        return "high"
    if confidence >= 0.5:
        return "moderate"
    return "needs_review"


def _severity(form_score: Any) -> str:
    try:
        score = float(form_score)
    except (TypeError, ValueError):
        return "medium"
    if score >= 8:
        return "low"
    if score >= 5:
        return "medium"
    return "high"


def build_findings(
    shot_events: list[dict[str, Any]],
    sport: str | None,
    provenance: dict[str, Any] | None,
    job_id: str,
    evidence_window_s: float = 4.0,
) -> list[dict[str, Any]]:
    """Derive findings from scored shot events.

    Pure function (unit-testable): no I/O, no model calls. Each event yields
    exactly one finding with a stable id (`{job_id}:e{n}`).
    """
    from core.sport_config import load_sport_config

    config = load_sport_config(sport)
    window = config.get("feedback_display_seconds")
    try:
        window_s = float(window) if window else evidence_window_s
    except (TypeError, ValueError):
        window_s = evidence_window_s

    model_versions = {}
    if isinstance(provenance, dict):
        model_versions = {
            "model": provenance.get("model"),
            "analysis_prompt": provenance.get("analysis_prompt"),
            "sport_pack_version": provenance.get("sport_pack_version"),
        }

    findings: list[dict[str, Any]] = []
    for i, event in enumerate(shot_events):
        if not isinstance(event, dict):
            continue
        try:
            ts = float(event.get("timestamp", 0.0))
        except (TypeError, ValueError):
            ts = 0.0
        biomechanics = event.get("biomechanics")
        biomechanics = biomechanics if isinstance(biomechanics, dict) else {}
        confidence = biomechanics.get("confidence")
        try:
            confidence_f = float(confidence) if confidence is not None else None
        except (TypeError, ValueError):
            confidence_f = None

        band = _confidence_band(confidence_f)
        observation = (
            event.get("key_observation")
            or event.get("feedback")
            or "Technique moment detected."
        )
        evidence_frames: list[Any] = []
        frame = biomechanics.get("measured_at_frame")
        if frame is not None:
            evidence_frames.append(frame)

        findings.append({
            "id": f"{job_id}:e{i + 1}",
            "category": event.get("event_type", "technique"),
            "start_ms": int(ts * 1000),
            "end_ms": int((ts + window_s) * 1000),
            "confidence": confidence_f,
            "confidence_band": band,
            "severity": _severity(event.get("form_score")),
            "observation": observation,
            "feedback": event.get("feedback", ""),
            "form_score": event.get("form_score", 0),
            "evidence_frames": evidence_frames,
            "measured_at_timestamp": biomechanics.get("measured_at_timestamp"),
            "model_versions": model_versions,
            "review_state": "needs_review" if band == "needs_review" else "auto",
        })
    return findings
