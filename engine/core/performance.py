"""Professional stat layer: what this clip can honestly say, and what it cannot.

The rest of the engine measures joints (`measure.py`), derives sport metrics
(`metrics.py`) and asks a model to judge what it sees (`judge.py`). This module
turns those facts into the grouped, labelled numbers a sports analyst would put
on a dashboard - without inventing the stats a single camera clip cannot know.

Every row carries a `source`:

- ``measured`` - computed from pose geometry or the event track.
- ``counted``  - a count or ratio of the events that were actually analysed.
- ``observed`` - a model's judgement from the video, never presented as a
  measurement.

Stats that need ball tracking, a box score, court/pitch calibration or
whole-match context are listed in `unavailable` with the reason. The lists are
sport-specific because "we cannot see xG" and "we cannot see strike rate" are
different admissions, not one generic disclaimer.
"""

from __future__ import annotations

import numpy as np

from .sports import Pack

MEASURED = "measured"
COUNTED = "counted"
OBSERVED = "observed"

BANDS = {
    "target": "inside the sport pack's ideal range",
    "near": "inside the acceptable range, outside the ideal range",
    "outside": "outside the pack's acceptable range",
    "on_target": "mean technique score 8.5-10 / 10",
    "developing": "mean technique score 6.0-8.4 / 10",
    "needs_work": "mean technique score below 6.0 / 10",
    "high": "event-to-event spread below 5%",
    "moderate": "event-to-event spread 5-12%",
    "variable": "event-to-event spread above 12%",
    "strong": "pose coverage 90% or better",
    "fair": "pose coverage 70-89%",
    "low": "pose coverage below 70%",
    "tight": "nearest opponent within 1 torso length",
    "contested": "nearest opponent 1-2 torso lengths away",
    "open": "nearest opponent more than 2 torso lengths away",
}

UNAVAILABLE: dict[str, list[dict]] = {
    "basketball": [
        {
            "label": "Shot chart / court location",
            "reason": "the camera view is not mapped to court coordinates",
        },
        {
            "label": "True shooting %, usage rate, offensive rating",
            "reason": "these need a full box score and possession data",
        },
        {
            "label": "Rebounds, assists, steals, blocks",
            "reason": "a single clip does not contain the whole game's events",
        },
    ],
    "football": [
        {
            "label": "Expected goals (xG) and expected assists (xA)",
            "reason": "these need shot location, keeper position and a trained shot model",
        },
        {
            "label": "Pass completion, possession and distance covered",
            "reason": "these need whole-match tracking of every player and the ball",
        },
        {
            "label": "Sprint speed and high-intensity runs",
            "reason": "monocular video without pitch calibration cannot give a reliable speed",
        },
    ],
    "cricket": [
        {
            "label": "Runs, strike rate and economy",
            "reason": "these need ball-by-ball scoring, which the clip does not contain",
        },
        {
            "label": "Ball speed, swing and spin",
            "reason": "the ball is not tracked, only the athlete's pose",
        },
        {
            "label": "Wicket probability and field placement",
            "reason": "these need match context and field coordinates",
        },
    ],
    "tennis": [
        {
            "label": "Serve speed, spin rate and rally length",
            "reason": "the ball is not tracked and broadcast frame rates limit speed accuracy",
        },
        {
            "label": "Winners, unforced errors and break points",
            "reason": "these need point-by-point scoring",
        },
        {
            "label": "Court coverage distance",
            "reason": "this needs court calibration and tracking across a whole point",
        },
    ],
    "baseball": [
        {
            "label": "Exit velocity, launch angle and hit distance",
            "reason": "the ball is not tracked and the plate is not calibrated",
        },
        {
            "label": "Pitch count, strike-zone % and batting average",
            "reason": "these need pitch-by-pitch and at-bat data",
        },
        {
            "label": "Sprint speed and route efficiency",
            "reason": "these need field calibration and the full play",
        },
    ],
    "hockey": [
        {
            "label": "Shot speed, save percentage and faceoff %",
            "reason": "the puck is not tracked; these need game data",
        },
        {
            "label": "Plus-minus, ice time and Corsi",
            "reason": "these need shift, line and lineup data",
        },
        {
            "label": "Skating speed",
            "reason": "this needs rink calibration that a clip alone does not provide",
        },
    ],
    "generic": [
        {
            "label": "Sport-specific league stats",
            "reason": "the clip was analysed without a sport pack, so no sport vocabulary applies",
        },
        {
            "label": "Ball / implement tracking",
            "reason": "only the athlete's body pose is tracked",
        },
        {
            "label": "Match context (score, opponent level)",
            "reason": "the upload does not contain that context",
        },
    ],
}


def _round(value: float) -> float:
    return round(float(value), 1)


def _stat(
    key: str,
    label: str,
    value: float | None,
    *,
    unit: str = "",
    source: str = MEASURED,
    band: str | None = None,
    note: str = "",
    display: str | None = None,
) -> dict:
    row = {
        "key": key,
        "label": label,
        "unit": unit,
        "source": source,
        "band": band,
        "note": note,
    }
    if display is not None:
        row.update(value=None, display=display)
    else:
        row["value"] = _round(value) if isinstance(value, float) else value
    return row


def _band(value: float, ideal, acceptable) -> str | None:
    if ideal is None:
        return None
    lo, hi = ideal
    if lo <= value <= hi:
        return "target"
    if acceptable is not None and acceptable[0] <= value <= acceptable[1]:
        return "near"
    return "outside"


def _score_band(value: float) -> str:
    return (
        "on_target" if value >= 8.5 else "developing" if value >= 6.0 else "needs_work"
    )


def _spread_band(cv: float) -> str:
    return "high" if cv <= 5 else "moderate" if cv <= 12 else "variable"


def _coverage_band(pct: float) -> str:
    return "strong" if pct >= 90 else "fair" if pct >= 70 else "low"


def _dist_band(value: float) -> str:
    return "tight" if value <= 1.0 else "contested" if value <= 2.0 else "open"


def _label(text: str) -> str:
    return text.replace("_", " ").strip().capitalize()


def _technique(events: list[dict]) -> tuple[list[dict], dict[str, dict]]:
    grouped: dict[str, list[dict]] = {}
    for event in events:
        for row in event.get("measurements") or []:
            if row.get("score") is not None:
                grouped.setdefault(row["key"], []).append(row)
    rows, means = [], {}
    for key, items in grouped.items():
        mean = float(np.mean([r["score"] for r in items]))
        # "Measured" only when EVERY scored row came from pose. A criterion that
        # mixes measured angles with model ratings is reported as observed: a
        # mean of measured and judged numbers is not itself a measurement.
        source = MEASURED if all(r.get("source") == "pose" for r in items) else OBSERVED
        meta = items[0]
        rows.append(
            _stat(
                key,
                str(meta["label"]),
                _round(mean * 10),
                unit="/10",
                source=source,
                band=_score_band(mean * 10),
                note=f"{len(items)} event{'s' if len(items) != 1 else ''} scored"
                + ("" if source == MEASURED else " from model ratings"),
            )
        )
        means[key] = {
            "label": str(meta["label"]),
            "value": _round(mean * 10),
            "source": source,
        }
    rows.sort(key=lambda r: -(r["value"] or 0))
    return rows, means


def _execution(session_metrics: list[dict], pack: Pack) -> list[dict]:
    by_key = {m["key"]: m for m in session_metrics if m.get("kind") == "metric"}
    rows = []
    for d in pack.key_metrics:
        found = by_key.get(d.key)
        if not found or found.get("value") is None:
            continue
        value = float(found["value"])
        note = f"session mean over {found.get('n', 0)} event{'s' if found.get('n') != 1 else ''}"
        if found.get("best") is not None and found.get("worst") is not None:
            note += f" · best {found['best']} · worst {found['worst']}"
        rows.append(
            _stat(
                d.key,
                d.label,
                value,
                unit=d.unit,
                source=MEASURED,
                band=_band(value, d.ideal, d.acceptable),
                note=note,
            )
        )
    return rows


def _pressure(events: list[dict], pack: Pack) -> list[dict]:
    distances = []
    for event in events:
        separation = (event.get("matchup") or {}).get("separation") or {}
        value = separation.get("distance")
        if isinstance(value, (int, float)):
            distances.append(float(value))
    if not distances:
        return []
    mean = float(np.mean(distances))
    tight = sum(1 for v in distances if v <= 2.0)
    rows = [
        _stat(
            "opponent_distance",
            f"{pack.opponent_role} distance",
            mean,
            unit="torso",
            band=_dist_band(mean),
            note="mean nearest-opponent separation at the events",
        ),
        _stat(
            "tightest_distance",
            "Tightest separation",
            float(np.min(distances)),
            unit="torso",
            band=_dist_band(float(np.min(distances))),
            note="closest the opponent got during an event",
        ),
        _stat(
            "contested_share",
            "Contested share",
            round(100 * tight / len(distances), 1),
            unit="%",
            source=COUNTED,
            band=None,
            note=f"{tight} of {len(distances)} events had the opponent within 2 torso lengths",
        ),
    ]
    return rows


def _execution_spread(events: list[dict], pack: Pack) -> float | None:
    values: dict[str, list[float]] = {}
    for event in events:
        for row in event.get("metrics") or []:
            if row.get("value") is not None:
                values.setdefault(row["key"], []).append(float(row["value"]))
    spreads = []
    for vals in values.values():
        if len(vals) < 2:
            continue
        mean = float(np.mean(vals))
        if abs(mean) < 1e-6:
            continue
        spreads.append(float(np.std(vals)) / abs(mean) * 100)
    return float(np.mean(spreads)) if spreads else None


def _consistency(
    events: list[dict],
    consistency: list[dict],
    session_metrics: list[dict],
    technique: list[dict],
    pack: Pack,
) -> list[dict]:
    rows = []
    cvs = []
    for row in consistency:
        if row.get("mean"):
            cvs.append(abs(float(row["sd"]) / float(row["mean"])) * 100)
    if cvs:
        cv = float(np.mean(cvs))
        rows.append(
            _stat(
                "technique_spread",
                "Technique spread",
                _round(cv),
                unit="%",
                band=_spread_band(cv),
                note=f"average event-to-event variation across {len(cvs)} measured criteria",
            )
        )
    spread = _execution_spread(events, pack)
    if spread is not None:
        rows.append(
            _stat(
                "execution_spread",
                "Execution spread",
                _round(spread),
                unit="%",
                band=_spread_band(spread),
                note="average variation of the sport's key metrics",
            )
        )
    measured = sum(1 for r in technique if r["source"] == MEASURED)
    if technique:
        share = round(100 * measured / len(technique), 1)
        rows.append(
            _stat(
                "measured_share",
                "Measured criteria",
                share,
                unit="%",
                note=f"{measured} of {len(technique)} scored criteria came from pose, not judgement",
            )
        )
    coverage = next(
        (m for m in session_metrics if m.get("key") == "tracking_coverage"), None
    )
    if coverage:
        value = float(coverage["value"])
        rows.append(
            _stat(
                "pose_coverage",
                "Pose coverage",
                value,
                unit="%",
                band=_coverage_band(value),
                note="share of the clip where the athlete was tracked",
            )
        )
    return rows


def _workload(session_metrics: list[dict]) -> list[dict]:
    rows = []
    mapping = {
        "tempo": ("Tempo", "s", "mean gap between events"),
        "events_per_min": ("Action rate", "/min", "events per minute of clip"),
    }
    for key, (label, unit, note) in mapping.items():
        found = next((m for m in session_metrics if m.get("key") == key), None)
        if found and found.get("value") is not None:
            rows.append(
                _stat(
                    key,
                    label,
                    float(found["value"]),
                    unit=unit,
                    source=COUNTED,
                    note=note,
                )
            )
    return rows


def _trend(events: list[dict]) -> dict | None:
    scored = [e for e in events if e.get("score") is not None]
    if len(scored) < 4:
        return None
    ordered = sorted(scored, key=lambda e: float(e["t"]))
    half = len(ordered) // 2
    first = float(np.mean([e["score"] for e in ordered[:half]]))
    second = float(np.mean([e["score"] for e in ordered[half:]]))
    delta = second - first
    direction = (
        "steady" if abs(delta) < 0.3 else "improving" if delta > 0 else "declining"
    )
    source = (
        MEASURED
        if all(e.get("score_source") == "measured" for e in ordered)
        else OBSERVED
    )
    return {
        "direction": direction,
        "delta": _round(delta),
        "first": _round(first),
        "second": _round(second),
        "n": len(ordered),
        "source": source,
        "note": "first half vs second half of the clip, ordered by time",
    }


def _breakdown(events: list[dict], pack: Pack) -> list[dict]:
    counts: dict[str, int] = {}
    for event in events:
        counts[event["type"]] = counts.get(event["type"], 0) + 1
    total = sum(counts.values()) or 1
    return [
        {
            "type": key,
            "label": _label(key),
            "count": n,
            "share": round(100 * n / total, 1),
        }
        for key, n in sorted(counts.items(), key=lambda x: (-x[1], x[0]))
    ]


def _outcomes(events: list[dict], pack: Pack) -> list[dict]:
    positive = set(pack.positive)
    negative = set(pack.negative)
    counts: dict[str, int] = {}
    for event in events:
        result = event.get("result", "unknown")
        counts[result] = counts.get(result, 0) + 1
    rows = []
    for result, n in sorted(counts.items(), key=lambda x: (-x[1], x[0])):
        tone = (
            "positive"
            if result in positive
            else "negative"
            if result in negative
            else "neutral"
        )
        rows.append(
            {"result": result, "label": _label(result), "count": n, "tone": tone}
        )
    return rows


def _tags(events: list[dict]) -> list[dict]:
    counts: dict[str, int] = {}
    for event in events:
        for tag in event.get("tags") or []:
            text = str(tag).strip()
            if text:
                counts[text] = counts.get(text, 0) + 1
    return [
        {"tag": tag, "count": n}
        for tag, n in sorted(counts.items(), key=lambda x: (-x[1], x[0]))
    ][:8]


def _provenance(groups: list[dict]) -> dict:
    counts = {MEASURED: 0, COUNTED: 0, OBSERVED: 0}
    for group in groups:
        for row in group["stats"]:
            counts[row["source"]] = counts.get(row["source"], 0) + 1
    return counts


def build(
    pack: Pack,
    events: list[dict],
    session_metrics: list[dict],
    consistency_rows: list[dict],
    stats: dict,
) -> dict:
    """Group the session's honest numbers, plus the stats this clip cannot produce."""
    technique, _technique_means = _technique(events)
    output = [
        _stat(
            "attempts",
            "Attempts",
            int(stats.get("events", len(events))),
            source=COUNTED,
            note="moments judged to be real actions",
        ),
    ]
    if pack.positive:
        output.append(
            _stat(
                "made",
                _label(pack.positive[0]),
                int(stats.get("made", 0)),
                source=COUNTED,
                note="decisive positive outcomes",
            )
        )
    if pack.negative:
        output.append(
            _stat(
                "missed",
                _label(pack.negative[0]),
                int(stats.get("missed", 0)),
                source=COUNTED,
                note="decisive negative outcomes",
            )
        )
    decisive = int(stats.get("made", 0)) + int(stats.get("missed", 0))
    if decisive:
        value = round(100 * int(stats.get("made", 0)) / decisive, 1)
        output.append(
            _stat(
                "conversion",
                "Conversion",
                value,
                unit="%",
                source=COUNTED,
                note=f"{stats.get('made', 0)} positive from {decisive} decisive outcomes",
            )
        )

    groups = [
        {"key": "output", "label": "Output", "stats": output},
        {"key": "technique", "label": "Technique", "stats": technique},
        {
            "key": "execution",
            "label": "Execution",
            "stats": _execution(session_metrics, pack),
        },
        {"key": "pressure", "label": "Pressure", "stats": _pressure(events, pack)},
        {
            "key": "consistency",
            "label": "Consistency",
            "stats": _consistency(
                events, consistency_rows, session_metrics, technique, pack
            ),
        },
        {"key": "workload", "label": "Workload", "stats": _workload(session_metrics)},
    ]
    groups = [g for g in groups if g["stats"]]
    return {
        "groups": groups,
        "event_breakdown": _breakdown(events, pack),
        "outcomes": _outcomes(events, pack),
        "tags": _tags(events),
        "trend": _trend(events),
        "provenance": _provenance(groups),
        "bands": BANDS,
        "unavailable": UNAVAILABLE.get(pack.name, UNAVAILABLE["generic"]),
    }


def _best_worst(technique_means: dict[str, dict]) -> tuple[dict | None, dict | None]:
    if not technique_means:
        return None, None
    ordered = sorted(technique_means.values(), key=lambda x: -x["value"])
    return ordered[0], ordered[-1]


def fallback_insights(
    pack: Pack, stats: dict, performance: dict
) -> tuple[str, list[str]]:
    """Deterministic analyst copy when the model is unavailable or silent."""
    attempts = int(stats.get("events", 0))
    insights: list[str] = []
    technique_means = {
        row["key"]: row
        for group in performance["groups"]
        if group["key"] == "technique"
        for row in group["stats"]
    }
    best, worst = _best_worst(technique_means)
    if best and best["value"] >= 8.0:
        insights.append(
            f"{best['label']} was the anchor at {best['value']}/10; keep that shape as the reference rep."
        )
    if worst and worst["value"] < 8.0:
        insights.append(
            f"{worst['label']} graded {worst['value']}/10 - make it the first block of the next session."
        )
    pressure = next(
        (
            row
            for group in performance["groups"]
            if group["key"] == "pressure"
            for row in group["stats"]
            if row["key"] == "opponent_distance"
        ),
        None,
    )
    if pressure and pressure.get("value") is not None:
        insights.append(
            f"{pack.opponent_role} distance averaged {pressure['value']} torso lengths "
            f"({pressure['band']} by the engine band); rehearse the action at that spacing."
        )
    consistency = next(
        (
            row
            for group in performance["groups"]
            if group["key"] == "consistency"
            for row in group["stats"]
            if row["key"] == "technique_spread"
        ),
        None,
    )
    if consistency and consistency.get("value") is not None:
        insights.append(
            f"Technique spread was {consistency['value']}% ({consistency['band']}); "
            "repeat the same rep until the number stops moving."
        )
    trend = performance.get("trend")
    if trend and trend["direction"] != "steady":
        insights.append(
            f"Scoring trend was {trend['direction']} ({trend['first']} to {trend['second']} /10); "
            "check whether the change came from execution or from the quality of the attempts."
        )
    conversion = next(
        (
            row
            for group in performance["groups"]
            if group["key"] == "output"
            for row in group["stats"]
            if row["key"] == "conversion"
        ),
        None,
    )
    summary = f"{attempts} moment{'s' if attempts != 1 else ''} analysed."
    if conversion and conversion.get("value") is not None:
        summary += f" Conversion was {conversion['value']}%."
    if best:
        summary += (
            f" {best['label']} was the strongest measured area at {best['value']}/10."
        )
    if worst and worst["key"] != best["key"]:
        summary += f" {worst['label']} is the clearest gap at {worst['value']}/10."
    return summary.strip(), insights[:4]
