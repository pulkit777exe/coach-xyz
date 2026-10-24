"""
core/scoring_v2.py — drop-in replacement for scoring.compute_weighted_scoring.

"""

from __future__ import annotations

from typing import Any

LLM_RATING_WEIGHT = 0.5
MIN_COVERAGE = 0.35
RATING_SCORES = {"good": 1.0, "needs_work": 0.5, "poor": 0.0}


def _range_score(value: float, ideal: Any, acceptable: Any) -> tuple[float, str]:
    if isinstance(ideal, (list, tuple)) and len(ideal) == 2 and ideal[0] <= value <= ideal[1]:
        return 1.0, "within ideal range"
    if isinstance(acceptable, (list, tuple)) and len(acceptable) == 2 and acceptable[0] <= value <= acceptable[1]:
        return 0.5, "acceptable, outside ideal range"
    if isinstance(ideal, (list, tuple)) and len(ideal) == 2:
        return 0.0, f"outside acceptable range (ideal {ideal[0]}-{ideal[1]})"
    return 0.0, "no reference range configured"


def _measured_value(criterion: dict, biomechanics: dict) -> tuple[float | None, float | None]:
    """(value, confidence) from deterministic pose output, else (None, None)."""
    metric = criterion.get("metric")
    if not metric:
        return None, None
    angles = biomechanics.get("joint_angles") or {}
    confs = biomechanics.get("joint_confidence") or {}
    if metric in ("elbow_extension_angle_deg", "elbow_extension_angle"):
        val = biomechanics.get("elbow_extension_angle")
        return (float(val), biomechanics.get("confidence")) if val is not None else (None, None)
    if metric in angles and isinstance(angles[metric], (int, float)):
        return float(angles[metric]), confs.get(metric, biomechanics.get("confidence"))
    return None, None


def compute_weighted_scoring(
    shot_events: list[dict],
    sport: str,
    criteria: list[dict] | None = None,
) -> None:
    """Mutates each event with `weighted_scoring` (same key as before)."""
    if criteria is None:
        from core.sport_config import load_sport_config

        criteria = load_sport_config(sport).get("form_criteria", [])

    total_weight = sum(float(c.get("weight", 0) or 0) for c in criteria if isinstance(c, dict))

    for event in shot_events:
        breakdown = event.get("form_breakdown") or {}
        bio = event.get("biomechanics") or {}
        rows: list[dict[str, Any]] = []
        num = den = covered = 0.0

        for c in criteria:
            if not isinstance(c, dict) or "key" not in c:
                continue
            weight = float(c.get("weight", 0) or 0)
            ideal, acceptable = c.get("ideal_range"), c.get("acceptable_range")
            unit = c.get("metric", "")
            row: dict[str, Any] = {
                "criterion": c["key"],
                "label": c.get("label", c["key"]),
                "unit": unit,
                "ideal_range": ideal,
                "acceptable_range": acceptable,
                "weight": weight,
                "measured_value": None,
                "confidence": None,
                "score": None,
                "source": "none",
                "rationale": "Not measured for this event",
            }
            value, conf = _measured_value(c, bio)
            rating = breakdown.get(c["key"])
            if value is not None:
                score, why = _range_score(value, ideal, acceptable)
                row.update(measured_value=round(value, 1), confidence=conf, score=score,
                           source="pose", rationale=f"Measured {round(value, 1)}: {why}")
                eff = weight
            elif rating in RATING_SCORES:
                score = RATING_SCORES[rating]
                row.update(score=score, source="llm_rating",
                           rationale=f"Judged '{rating}' from video (not measured)")
                eff = weight * LLM_RATING_WEIGHT
            else:
                eff = 0.0
            if row["score"] is not None and eff > 0:
                num += row["score"] * eff
                den += eff
                covered += eff
            rows.append(row)

        coverage = round(covered / total_weight, 2) if total_weight > 0 else 0.0
        composite = round(num / den * 10.0, 1) if den > 0 and coverage >= MIN_COVERAGE else None

        scored = [r for r in rows if r["score"] is not None]
        weak = [r for r in scored if r["score"] == 0.0]
        strong = [r for r in scored if r["score"] == 1.0]
        if not scored:
            summary = "No criteria could be measured or rated for this event"
        elif weak:
            w = max(weak, key=lambda r: r["weight"])
            summary = f"Needs work on {w['label']}: {w['rationale']}"
        elif len(strong) == len(scored):
            summary = "All scored criteria within ideal ranges"
        else:
            summary = f"Strong on {', '.join(r['label'] for r in strong)}" if strong else "Mixed results"

        event["weighted_scoring"] = {
            "composite_score": composite,
            "coverage": coverage,
            "criteria": rows,
            "weighted_rationale": summary,
        }