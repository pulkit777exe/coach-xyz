"""Turn an event's moment into numbers, and numbers into a score.

Measured values come from pose geometry only. A model's good / needs_work /
poor rating can fill in criteria we could not measure, but it counts for less
and is always labelled as a judgement, never as a measurement.
"""

import numpy as np

from . import geometry as g
from .sports import Criterion, Pack
from .track import Track

RATING_SCORE = {"good": 1.0, "needs_work": 0.5, "poor": 0.0}
RATING_WEIGHT = 0.5
MIN_COVERAGE = 0.35
HALF_WINDOW = 2


def score_value(value: float, c: Criterion) -> tuple[float, str]:
    """1 inside the ideal range, 0.5 at the edge of acceptable, falling to 0 beyond it."""
    if c.ideal is None:
        return 0.0, "no target range"
    lo, hi = c.ideal
    alo, ahi = c.acceptable or c.ideal
    if lo <= value <= hi:
        return 1.0, "within target"
    below = value < lo
    gap = lo - value if below else value - hi
    margin = max((lo - alo) if below else (ahi - hi), 5.0)
    reach = max(10.0, hi - lo)
    score = 1 - 0.5 * gap / margin if gap <= margin else 0.5 - 0.5 * (gap - margin) / reach
    return max(0.0, score), f"{'below' if below else 'above'} target by {gap:.0f}°"


def measure(track: Track, i: int, side: str, pack: Pack) -> dict:
    """Pack criteria measured around sample `i`. Median over a few samples to ignore jitter."""
    lo, hi = max(0, i - HALF_WINDOW), min(len(track.t), i + HALF_WINDOW + 1)
    rows = []
    for c in pack.criteria:
        vals, confs = [], []
        for j in range(lo, hi):
            if np.isnan(track.lm[j, 0, 0]):
                continue
            r = g.metric(c.metric, track.lm[j], track.width, track.height, side)
            if r:
                vals.append(r[0])
                confs.append(r[1])
        row = {"key": c.key, "label": c.label, "metric": c.metric, "unit": "deg", "weight": c.weight,
               "ideal": list(c.ideal) if c.ideal else None,
               "acceptable": list(c.acceptable) if c.acceptable else None,
               "value": None, "confidence": None, "score": None, "source": "none",
               "note": "could not be measured here"}
        if vals:
            value = float(np.median(vals))
            score, why = score_value(value, c)
            row.update(value=round(value, 1), confidence=round(float(np.mean(confs)), 2), score=round(score, 2),
                       source="pose", note=why)
        rows.append(row)
    return {"criteria": rows, "side": side, "sample": i, "t": float(track.t[i])}


def apply_ratings(rows: list[dict], ratings: dict[str, str]) -> None:
    """Fill unmeasured criteria from a model's rating, flagged as a judgement."""
    for row in rows:
        rating = ratings.get(row["key"])
        if row["source"] == "none" and rating in RATING_SCORE:
            row.update(score=RATING_SCORE[rating], source="judged", note=f"judged {rating.replace('_', ' ')} from video")


def combine(rows: list[dict]) -> tuple[float | None, float]:
    """Weighted 0-10 score and how much of the pack's weight it rests on."""
    total = sum(r["weight"] for r in rows)
    num = den = 0.0
    for r in rows:
        if r["score"] is None:
            continue
        w = r["weight"] * (1.0 if r["source"] == "pose" else RATING_WEIGHT)
        num += r["score"] * w
        den += w
    covered = sum(r["weight"] for r in rows if r["score"] is not None)
    coverage = round(covered / total, 2) if total else 0.0
    if not den or coverage < MIN_COVERAGE:
        return None, coverage
    return round(num / den * 10, 1), coverage


def rating_label(score: float | None) -> str | None:
    if score is None:
        return None
    for floor, label in ((8.5, "Elite"), (7.0, "Advanced"), (5.5, "Intermediate"), (4.0, "Developing")):
        if score >= floor:
            return label
    return "Beginner"


def deviations(rows: list[dict]) -> list[dict]:
    """Measured criteria outside the ideal range, worst (weighted) first."""
    bad = [r for r in rows if r["source"] == "pose" and r["score"] is not None and r["score"] < 1.0]
    return sorted(bad, key=lambda r: (r["score"] - 1.0) * r["weight"])


def describe(row: dict) -> str:
    lo, hi = row["ideal"] or (None, None)
    target = f" (target {lo:.0f}-{hi:.0f}°)" if lo is not None else ""
    return f"{row['label']} was {row['value']:.0f}°{target}"
