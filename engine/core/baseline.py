"""
baseline.py — Personal baseline and reference-athlete comparison models.

Provides:
- PersonalBaseline: compare today's rep to the athlete's own best-performing
  historical reps (percentile deviation).
- ReferenceAthleteOverlay: compare joint-angle time series to a pro/elite
  reference curve for that motion.

Both are designed to answer the coach's question: "compared to what?"
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any


BASELINE_DIR = Path(__file__).resolve().parent.parent.parent / "baselines"


def _percentile(values: list[float], pct: float) -> float:
    """Return the pct-th percentile of a sorted list of values."""
    if not values:
        return 0.0
    sorted_vals = sorted(values)
    k = (len(sorted_vals) - 1) * (pct / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_vals[int(k)]
    return sorted_vals[f] * (c - k) + sorted_vals[c] * (k - f)


class PersonalBaseline:
    """
    Compare a current measurement against an athlete's own historical
    best-performing reps.

    For each metric, the baseline stores the athlete's personal best (P100),
    median (P50), and a rolling window of recent values. The deviation is
    expressed as a percentile rank: how the current value compares to
    historical distribution.
    """

    def __init__(self, athlete_id: str, sport: str) -> None:
        self.athlete_id = athlete_id
        self.sport = sport
        self._history: dict[str, list[float]] = {}
        self._path = BASELINE_DIR / sport / f"{athlete_id}.json"

    def load(self) -> bool:
        """Load historical baseline data from disk. Returns False if no file."""
        if not self._path.exists():
            return False
        try:
            with open(self._path) as f:
                data = json.load(f)
            self._history = data.get("history", {})
            return True
        except (json.JSONDecodeError, OSError):
            return False

    def save(self) -> None:
        """Persist updated baseline data to disk."""
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with open(self._path, "w") as f:
            json.dump(
                {
                    "athlete_id": self.athlete_id,
                    "sport": self.sport,
                    "history": self._history,
                },
                f,
                indent=2,
            )

    def record(self, metric_key: str, value: float) -> None:
        """Record a single measurement for a metric."""
        if metric_key not in self._history:
            self._history[metric_key] = []
        self._history[metric_key].append(value)

    def record_batch(self, metrics: dict[str, float]) -> None:
        """Record multiple measurements at once."""
        for key, value in metrics.items():
            self.record(key, value)

    def get_history(self, metric_key: str) -> list[float]:
        """Return historical values for a metric, empty list if none."""
        return self._history.get(metric_key, [])

    def percentile_deviation(
        self, metric_key: str, current_value: float
    ) -> dict[str, Any]:
        """
        Compare current_value against historical distribution.

        Returns dict with:
        - deviation_pct: percentile rank (0-100) of current value
        - z_score: standard deviations from mean
        - historical_best: best (highest for positive metrics) historical value
        - historical_median: median historical value
        - historical_mean: mean historical value
        - historical_std: standard deviation of historical values
        - is_improvement: whether current value is better than median
        - direction: "higher_is_better" or "lower_is_better"
        """
        history = self._history.get(metric_key, [])

        if len(history) < 3:
            return {
                "deviation_pct": None,
                "z_score": None,
                "historical_best": None,
                "historical_median": None,
                "historical_mean": None,
                "historical_std": None,
                "is_improvement": None,
                "direction": "unknown",
                "sample_size": len(history),
                "note": "Insufficient history for baseline comparison",
            }

        mean_val = sum(history) / len(history)
        variance = sum((v - mean_val) ** 2 for v in history) / len(history)
        std_val = math.sqrt(max(variance, 1e-9))

        # Percentile rank using linear interpolation
        sorted_h = sorted(history)
        rank = sum(1 for v in sorted_h if v <= current_value) / len(sorted_h)
        percentile = rank * 100.0

        # Z-score
        z_score = (current_value - mean_val) / std_val if std_val > 0 else 0.0

        # Determine direction based on metric name heuristics
        higher_is_better_metrics = {
            "elbow_extension_angle",
            "follow_through_hold_frames",
            "release_height_px",
        }
        direction = (
            "higher_is_better"
            if metric_key in higher_is_better_metrics
            else "lower_is_better"
        )

        if direction == "higher_is_better":
            is_improvement = current_value >= _percentile(sorted_h, 50)
        else:
            is_improvement = current_value <= _percentile(sorted_h, 50)

        return {
            "deviation_pct": round(percentile, 1),
            "z_score": round(z_score, 2),
            "historical_best": round(max(history), 1),
            "historical_median": round(_percentile(sorted_h, 50), 1),
            "historical_mean": round(mean_val, 1),
            "historical_std": round(std_val, 2),
            "is_improvement": is_improvement,
            "direction": direction,
            "sample_size": len(history),
        }


class ReferenceAthleteOverlay:
    """
    Compare joint-angle time series to a pro/elite reference curve.

    The reference curve is a JSON file mapping joint names to arrays of
    {frame_offset_ms, angle_deg} samples from an elite performer.
    """

    def __init__(self, sport: str, motion_type: str) -> None:
        self.sport = sport
        self.motion_type = motion_type
        self._reference: dict[str, list[dict[str, float]]] = {}
        self._path = (
            BASELINE_DIR / sport / "reference_athletes" / f"{motion_type}.json"
        )

    def load(self) -> bool:
        """Load reference athlete data from disk. Returns False if no file."""
        if not self._path.exists():
            return False
        try:
            with open(self._path) as f:
                data = json.load(f)
            self._reference = data.get("reference_curves", {})
            return True
        except (json.JSONDecodeError, OSError):
            return False

    @staticmethod
    def _interpolate_curve(
        curve: list[dict[str, float]], target_ms: float
    ) -> float | None:
        """
        Linearly interpolate a reference curve at target_ms.
        Curve entries: [{frame_offset_ms, angle_deg}, ...]
        Returns None if target is outside curve range.
        """
        if not curve:
            return None

        sorted_curve = sorted(curve, key=lambda p: p["frame_offset_ms"])

        # Extrapolation guard: only interpolate within range
        if target_ms < sorted_curve[0]["frame_offset_ms"]:
            return None
        if target_ms > sorted_curve[-1]["frame_offset_ms"]:
            return None

        # Find bracketing points
        for i in range(len(sorted_curve) - 1):
            p0 = sorted_curve[i]
            p1 = sorted_curve[i + 1]
            if p0["frame_offset_ms"] <= target_ms <= p1["frame_offset_ms"]:
                t = (
                    (target_ms - p0["frame_offset_ms"])
                    / (p1["frame_offset_ms"] - p0["frame_offset_ms"])
                )
                return p0["angle_deg"] + t * (p1["angle_deg"] - p0["angle_deg"])

        return None

    def compare(
        self, joint_angles: dict[str, float], event_timestamp_ms: float
    ) -> dict[str, Any]:
        """
        Compare current joint angles against the reference athlete curve.

        Returns dict mapping joint names to:
        - current_value: the athlete's measured angle
        - reference_value: the elite reference angle at that timing
        - delta_deg: difference (positive = more extended than reference)
        - delta_pct: percentage difference from reference
        - within_tolerance: whether the delta is within ±15° tolerance
        """
        results: dict[str, Any] = {}

        for joint, current_val in joint_angles.items():
            ref_curve = self._reference.get(joint)
            if ref_curve is None:
                results[joint] = {
                    "current_value": current_val,
                    "reference_value": None,
                    "delta_deg": None,
                    "delta_pct": None,
                    "within_tolerance": None,
                    "note": "No reference curve for this joint",
                }
                continue

            ref_val = self._interpolate_curve(ref_curve, event_timestamp_ms)
            if ref_val is None:
                results[joint] = {
                    "current_value": current_val,
                    "reference_value": None,
                    "delta_deg": None,
                    "delta_pct": None,
                    "within_tolerance": None,
                    "note": "Timestamp outside reference curve range",
                }
                continue

            delta = current_val - ref_val
            delta_pct = (delta / ref_val * 100.0) if abs(ref_val) > 0.1 else 0.0
            within_tolerance = abs(delta) <= 15.0

            results[joint] = {
                "current_value": round(current_val, 1),
                "reference_value": round(ref_val, 1),
                "delta_deg": round(delta, 1),
                "delta_pct": round(delta_pct, 1),
                "within_tolerance": within_tolerance,
            }

        return results


def compute_consistency_metrics(
    metric_values: list[float],
) -> dict[str, float | None]:
    """
    Compute consistency metrics across multiple reps.

    Returns variance, std_dev, cv (coefficient of variation), and range.
    """
    if len(metric_values) < 2:
        return {
            "variance": None,
            "std_dev": None,
            "cv": None,
            "range": None,
            "sample_size": len(metric_values),
        }

    n = len(metric_values)
    mean_val = sum(metric_values) / n
    variance = sum((v - mean_val) ** 2 for v in metric_values) / n
    std_dev = math.sqrt(max(variance, 1e-9))
    cv = (std_dev / mean_val * 100.0) if abs(mean_val) > 1e-9 else 0.0
    val_range = max(metric_values) - min(metric_values)

    return {
        "variance": round(variance, 4),
        "std_dev": round(std_dev, 2),
        "cv": round(cv, 2),
        "range": round(val_range, 2),
        "mean": round(mean_val, 2),
        "sample_size": n,
    }