"""Turn an event's moment into evidence records.

Measured values come from pose geometry only. A model's qualitative rating can
describe a criterion it could see, but it never becomes a numeric measurement:
the record keeps ``source="vlm"``, ``evidence_type="judged"`` and ``score=None``.
Only a valid pose measurement may contribute to a measured assessment.

Each row carries four independent axes (see ``evidence.py``):

- ``evidence_type``: measured / conditional / judged / excluded
- ``source``: pose / object_tracking / vlm / rule / human_reference
- ``state``: valid / low_confidence / invalid_view / occluded / unavailable /
  not_applicable
- ``validation_status``: proposed / coach_reviewed / measurement_tested /
  coach_validated / production_approved
"""

from __future__ import annotations

import numpy as np

from . import evidence
from . import geometry as g
from .sports import Criterion, Pack
from .track import Track

MIN_MEASURED_COVERAGE = 0.65
MIN_SCORING_CONFIDENCE = 0.5
HALF_WINDOW = 2
UNIT = "deg"


def score_value(value: float, c: Criterion) -> tuple[float | None, str]:
    """1 inside the ideal range, 0.5 at the edge of acceptable, falling to 0 beyond it.

    A criterion with no target range is reported as a measurement only; scoring
    it against nothing would drag every other criterion down.

    The ranges are provisional product heuristics, not validated coaching
    standards. The result marks every composite as experimental for this reason.
    """
    if c.ideal is None:
        return None, "no target range"
    lo, hi = c.ideal
    alo, ahi = c.acceptable or c.ideal
    if lo <= value <= hi:
        return 1.0, "within target"
    below = value < lo
    gap = lo - value if below else value - hi
    margin = max((lo - alo) if below else (ahi - hi), 5.0)
    reach = max(10.0, hi - lo)
    score = (
        1 - 0.5 * gap / margin if gap <= margin else 0.5 - 0.5 * (gap - margin) / reach
    )
    return max(0.0, score), f"{'below' if below else 'above'} target by {gap:.0f}°"


def _row(
    c: Criterion,
    *,
    state: str,
    source: str | None,
    value: float | None = None,
    confidence: float | None = None,
    score: float | None = None,
    note: str = "",
    frames: list[int] | None = None,
    times: list[float] | None = None,
    view_verified: bool = True,
) -> dict:
    return {
        "key": c.key,
        "criterion_id": c.criterion_id or c.key,
        "label": c.label,
        "metric": c.metric,
        "unit": UNIT,
        "weight": c.weight,
        "ideal": list(c.ideal) if c.ideal else None,
        "acceptable": list(c.acceptable) if c.acceptable else None,
        "value": value,
        "confidence": confidence,
        "confidence_kind": "landmark_visibility" if confidence is not None else None,
        "score": score,
        "source": source,
        "state": state,
        "evidence_type": c.evidence_type,
        "validation_status": c.validation_status,
        "measurement_type": c.measurement_type,
        "calibration": c.calibration,
        "view_verified": view_verified,
        "phase": c.phase_scope[0] if len(c.phase_scope) == 1 else None,
        "phase_scope": list(c.phase_scope),
        "required_landmarks": list(c.required_landmarks),
        "required_objects": list(c.required_objects),
        "quality_gate": c.quality_gate,
        "implementation_note": c.implementation_note,
        "source_frames": frames or [],
        "source_t": times or [],
        "skipped": state == "invalid_view",
        "note": note,
    }


UNDECLARED_VIEWS = (None, "", "primary", "unknown")


def measure(
    track: Track,
    i: int,
    side: str,
    pack: Pack,
    angle: str | None = None,
    *,
    research: bool = False,
) -> dict:
    """Pack criteria measured around sample ``i``. Median over a few samples to ignore jitter.

    Criteria whose declared views cannot support the current camera angle are
    marked ``invalid_view`` rather than scored from data that cannot answer the
    question. Criteria that the pack declares but does not implement are marked
    ``unavailable`` with an explicit note.

    ``research=True`` is fail-closed: a view the caller never declared cannot support a
    criterion whose pack entry requires one, so the criterion is reported as
    ``unavailable`` instead of being measured from an assumed camera. Product runs may
    stay permissive; research runs must not.
    """
    lo, hi = max(0, i - HALF_WINDOW), min(len(track.t), i + HALF_WINDOW + 1)
    rows = []
    for c in pack.criteria:
        if not c.metric:
            rows.append(
                _row(
                    c,
                    state="unavailable",
                    source=None,
                    note="criterion is declared in the pack but not implemented by this engine",
                )
            )
            continue

        views = c.allowed_views or c.valid_angles
        view_verified = True
        declared = None if angle in UNDECLARED_VIEWS else angle
        if views and not declared:
            if research:
                rows.append(
                    _row(
                        c,
                        state="unavailable",
                        source=None,
                        view_verified=False,
                        note="research mode requires a declared camera view; none was declared",
                    )
                )
            else:
                rows.append(
                    _row(
                        c,
                        state="view_unverified",
                        source=None,
                        view_verified=False,
                        note="camera view not declared; cannot verify this criterion",
                    )
                )
            continue
        if views and declared:
            view_verified = declared in views
        if not view_verified:
            rows.append(
                _row(
                    c,
                    state="invalid_view",
                    source=None,
                    view_verified=False,
                    note=f"not measurable from {declared or 'unknown'} view",
                )
            )
            continue

        vals, confs, frames, times = [], [], [], []
        for j in range(lo, hi):
            if np.isnan(track.lm[j, 0, 0]):
                continue
            r = g.metric(c.metric, track.lm[j], track.width, track.height, side)
            if r:
                vals.append(r[0])
                confs.append(r[1])
                frames.append(j)
                times.append(round(float(track.t[j]), 3))

        if not vals:
            visible = bool(track.valid[lo:hi].any()) if hi > lo else False
            state = "occluded" if visible else "unavailable"
            note = (
                "landmarks were not visible around this moment"
                if visible
                else "no pose samples were available around this moment"
            )
            rows.append(_row(c, state=state, source=None, note=note))
            continue

        value = float(np.median(vals))
        confidence = float(np.mean(confs))
        if confidence < MIN_SCORING_CONFIDENCE:
            rows.append(
                _row(
                    c,
                    state="low_confidence",
                    source="pose",
                    value=round(value, 1),
                    confidence=round(confidence, 2),
                    score=None,
                    frames=frames,
                    times=times,
                    note="low landmark confidence; value reported but not scored",
                )
            )
            continue

        score, why = score_value(value, c)
        note = why
        if c.measurement_type == "image_plane_angle":
            note = f"{why}; image-plane angle, uncalibrated 2D"
        rows.append(
            _row(
                c,
                state="valid",
                source="pose",
                value=round(value, 1),
                confidence=round(confidence, 2),
                score=None if score is None else round(score, 2),
                frames=frames,
                times=times,
                note=note,
            )
        )
    return {"criteria": rows, "side": side, "sample": i, "t": float(track.t[i])}


def apply_ratings(rows: list[dict], ratings: dict[str, str]) -> None:
    """Attach a model's qualitative rating without turning it into a score.

    A VLM observation is useful evidence, but it is not a measurement. It never
    writes ``score`` and it never counts toward measurement coverage. Rows that
    already contain a pose measurement, or that were excluded by a camera gate,
    are left alone.
    """
    for row in rows:
        if row.get("state") in ("invalid_view", "not_applicable"):
            continue
        if row.get("source") is not None or row.get("value") is not None:
            continue
        rating = ratings.get(row["key"])
        if not rating:
            continue
        if rating in ("unclear", "unable_to_assess"):
            row.update(
                source="vlm",
                state="unavailable",
                evidence_type="judged",
                qualitative_rating=rating,
                score=None,
                note="model could not assess this criterion",
            )
        elif rating == "not_applicable":
            row.update(
                source="vlm",
                state="not_applicable",
                evidence_type="judged",
                qualitative_rating=rating,
                score=None,
                note="model judged this criterion not applicable",
            )
        else:
            row.update(
                source="vlm",
                state="valid",
                evidence_type="judged",
                qualitative_rating=rating,
                score=None,
                note=f"judged {rating.replace('_', ' ')} from video; qualitative, not scored",
            )


def combine_detail(rows: list[dict]) -> dict:
    """Measured-only weighted score and its coverage denominator.

    ``not_applicable`` and ``excluded`` rows leave the denominator entirely.
    Invalid-view, occluded, unavailable and low-confidence rows stay in the
    denominator but contribute no score: they are coverage failures, not
    evidence of poor technique.
    """
    applicable = [
        r
        for r in rows
        if r.get("state") != "not_applicable" and r.get("evidence_type") != "excluded"
    ]
    total = sum(float(r["weight"]) for r in applicable)
    scored = [
        r
        for r in applicable
        if r.get("score") is not None
        and evidence.is_scorable(r.get("source"), r.get("state"))
    ]
    covered = sum(float(r["weight"]) for r in scored)
    coverage = round(covered / total, 2) if total else 0.0
    detail = {
        "value": None,
        "coverage": coverage,
        "applicable_weight": round(total, 3),
        "measured_weight": round(covered, 3),
        "scored_criteria": [r.get("criterion_id") or r["key"] for r in scored],
        "excluded_criteria": [
            r.get("criterion_id") or r["key"]
            for r in applicable
            if r.get("state") != "not_applicable" and r not in scored
        ],
        "minimum_coverage": MIN_MEASURED_COVERAGE,
    }
    if not scored or coverage < MIN_MEASURED_COVERAGE:
        return detail
    value = sum(float(r["score"]) * float(r["weight"]) for r in scored) / covered
    detail["value"] = round(value * 10, 1)
    return detail


def combine(rows: list[dict]) -> tuple[float | None, float]:
    """Back-compatible ``(score, coverage)`` wrapper around ``combine_detail``."""
    detail = combine_detail(rows)
    return detail["value"], detail["coverage"]


def rating_label(score: float | None) -> str | None:
    """Provisional product label. Research exports must use ``composite`` instead."""
    if score is None:
        return None
    for floor, label in (
        (8.5, "Elite"),
        (7.0, "Advanced"),
        (5.5, "Intermediate"),
        (4.0, "Developing"),
    ):
        if score >= floor:
            return label
    return "Beginner"


def deviations(rows: list[dict]) -> list[dict]:
    """Valid measured criteria outside the ideal range, worst (weighted) first."""
    bad = [
        r
        for r in rows
        if evidence.is_scorable(r.get("source"), r.get("state"))
        and r["score"] is not None
        and r["score"] < 1.0
    ]
    return sorted(bad, key=lambda r: (r["score"] - 1.0) * r["weight"])


def describe(row: dict) -> str:
    lo, hi = row["ideal"] or (None, None)
    target = f" (target {lo:.0f}-{hi:.0f}°)" if lo is not None else ""
    plane = " image-plane" if row.get("measurement_type") == "image_plane_angle" else ""
    return f"{row['label']} was {row['value']:.0f}°{target}{plane}"
