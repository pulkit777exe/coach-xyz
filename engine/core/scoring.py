"""scoring.py — Deterministic form scoring.

Owns criterion scoring against ideal/acceptable ranges plus the weighted
composite (1.0–10.0) with per-criterion rationales. The orchestrator
(`core/analyzer.py::_stage_scoring`) crosses this interface; sport
reference data comes from the cached sport-config loader.
"""

from __future__ import annotations

from typing import Any

from core.sport_config import load_sport_config


def compute_criterion_score(
    criterion: dict,
    measured_value: float | None,
) -> dict[str, Any]:
    """
    Score a single criterion against its ideal and acceptable ranges.

    Returns dict with score (0.0-1.0), rationale, and whether it's in range.
    """
    ideal = criterion.get("ideal_range")
    acceptable = criterion.get("acceptable_range")
    metric_label = criterion.get("label", criterion.get("key", "unknown"))
    unit = criterion.get("metric", "")

    if measured_value is None:
        return {
            "criterion": criterion["key"],
            "label": metric_label,
            "measured_value": None,
            "unit": unit,
            "ideal_range": ideal,
            "acceptable_range": acceptable,
            "score": 0.0,
            "weight": criterion.get("weight", 0.0),
            "in_ideal": False,
            "in_acceptable": False,
            "rationale": "No measurement available",
        }

    if ideal and ideal[0] <= measured_value <= ideal[1]:
        score = 1.0
        rationale = f"Within ideal range ({ideal[0]}–{ideal[1]}{unit})"
        in_ideal = True
        in_acceptable = True
    elif acceptable and acceptable[0] <= measured_value <= acceptable[1]:
        score = 0.5
        ideal_desc = f" ({ideal[0]}–{ideal[1]}{unit})" if ideal else ""
        rationale = f"Acceptable but outside ideal{ideal_desc}"
        in_ideal = False
        in_acceptable = True
    else:
        score = 0.0
        if ideal:
            rationale = f"Outside acceptable range (ideal: {ideal[0]}–{ideal[1]}{unit}, measured: {measured_value}{unit})"
        else:
            rationale = f"Measured {measured_value}{unit} — no reference range configured"
        in_ideal = False
        in_acceptable = False

    return {
        "criterion": criterion["key"],
        "label": metric_label,
        "measured_value": round(measured_value, 1),
        "unit": unit,
        "ideal_range": ideal,
        "acceptable_range": acceptable,
        "score": score,
        "weight": criterion.get("weight", 0.0),
        "in_ideal": in_ideal,
        "in_acceptable": in_acceptable,
        "rationale": rationale,
    }

def compute_weighted_scoring(
    shot_events: list[dict],
    sport: str,
) -> None:
    """
    Compute weighted composite scores for each shot event.

    Uses the sport's form_criteria config to score each criterion,
    then aggregates into a weighted composite score (1.0–10.0 scale).
    Also generates per-criterion rationales and a summary rationale.
    """
    config = load_sport_config(sport)
    criteria = config.get("form_criteria", [])

    for event in shot_events:
        breakdown = event.get("form_breakdown", {})
        biomechanics = event.get("biomechanics", {})
        joint_angles = biomechanics.get("joint_angles", {})
        elbow_ext = biomechanics.get("elbow_extension_angle")

        # Map form_breakdown criteria to measured values
        criterion_scores = []
        for criterion in criteria:
            if not isinstance(criterion, dict):
                continue

            key = criterion["key"]
            metric = criterion.get("metric")
            measured_value = None

            # Try to find the measured value from biomechanics
            if metric == "elbow_extension_angle_deg" and elbow_ext is not None:
                measured_value = elbow_ext
            elif metric and metric in joint_angles:
                measured_value = joint_angles[metric]

            # If no biomechanical measurement, try to infer from form_breakdown
            if measured_value is None and key in breakdown:
                rating = breakdown[key]
                # Use the midpoint of the ideal range as a proxy
                ideal = criterion.get("ideal_range")
                if ideal:
                    measured_value = (ideal[0] + ideal[1]) / 2.0 * (0.8 if rating == "needs_work" else 1.0 if rating == "good" else 0.6)

            score_result = compute_criterion_score(criterion, measured_value)
            criterion_scores.append(score_result)

        # Compute weighted composite
        total_weight = sum(cs["weight"] for cs in criterion_scores if cs["weight"] > 0)
        if total_weight > 0:
            weighted_sum = sum(cs["score"] * cs["weight"] for cs in criterion_scores)
            composite = (weighted_sum / total_weight) * 10.0
        else:
            composite = event.get("form_score", 5.0)

        # Generate weighted rationale
        poor_criteria = [cs for cs in criterion_scores if cs["score"] == 0.0]
        good_criteria = [cs for cs in criterion_scores if cs["score"] == 1.0]

        if poor_criteria:
            worst = poor_criteria[0]
            weighted_rationale = f"Needs work on {worst['label']}: {worst['rationale']}"
        elif good_criteria and len(good_criteria) == len(criterion_scores):
            weighted_rationale = "All criteria within ideal ranges — textbook form"
        elif good_criteria:
            weighted_rationale = f"Strong on {', '.join(cs['label'] for cs in good_criteria)}"
        else:
            weighted_rationale = "Mixed results — review individual criteria"

        event["weighted_scoring"] = {
            "composite_score": round(composite, 1),
            "criteria": criterion_scores,
            "weighted_rationale": weighted_rationale,
        }
