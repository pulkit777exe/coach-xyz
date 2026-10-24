"""core/exporters.py — stable, versioned outputs from an analysis summary.

Works on the summary dict the pipeline already produces (no pipeline change
needed), and emits:

* build_result_v2(...)  one JSON envelope: schema_version, provenance,
  video facts, session scores, events with tidy measurements, findings,
  quality, warnings. This is the contract the server/web should read.
* events_csv / measurements_csv / findings_csv / session_csv
  Tidy, Excel-safe CSV (one row per event / per measurement / per finding).
  `measurements_csv` is "long" format so it pivots cleanly and keeps units,
  ranges, source and confidence next to every number.

Cells that start with = + - @ tab or CR are neutralised (formula injection),
numbers are never altered.
"""

from __future__ import annotations

import csv
import io
from pathlib import Path
from typing import Any, Iterable

SCHEMA_VERSION = "2.0"
_FORMULA_LEAD = ("=", "+", "-", "@", "\t", "\r")


def _safe(value: Any) -> Any:
    if isinstance(value, bool) or value is None:
        return "" if value is None else value
    if isinstance(value, (int, float)):
        return value
    text = str(value)
    if text.startswith(_FORMULA_LEAD):
        return "'" + text
    return text


def _rows_to_csv(header: list[str], rows: Iterable[list[Any]]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(header)
    for row in rows:
        w.writerow([_safe(v) for v in row])
    return buf.getvalue()


def _f(value: Any, nd: int = 2) -> Any:
    return round(value, nd) if isinstance(value, float) else value


def _event_id(job_id: str, i: int) -> str:
    # Derived from the CURRENT job id, never from cached content: cached
    # summaries used to carry the first job's `{old_job}:e1` finding ids.
    return f"{job_id}:e{i + 1}"


def _measurements(event: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    ws = event.get("weighted_scoring") or {}
    seen: set[str] = set()
    for c in ws.get("criteria") or []:
        if not isinstance(c, dict):
            continue
        seen.add(str(c.get("criterion")))
        out.append({
            "metric": c.get("criterion"),
            "label": c.get("label"),
            "value": c.get("measured_value"),
            "unit": c.get("unit") or "",
            "ideal_min": (c.get("ideal_range") or [None, None])[0],
            "ideal_max": (c.get("ideal_range") or [None, None])[1],
            "score": c.get("score"),
            "weight": c.get("weight"),
            "source": c.get("source", "unknown"),
            "confidence": c.get("confidence"),
            "note": c.get("rationale"),
        })
    bio = event.get("biomechanics") or {}
    for name, val in (bio.get("joint_angles") or {}).items():
        if name in seen or not isinstance(val, (int, float)):
            continue
        out.append({
            "metric": name, "label": name.replace("_", " "), "value": val, "unit": "deg",
            "ideal_min": None, "ideal_max": None, "score": None, "weight": None,
            "source": "pose", "confidence": (bio.get("joint_confidence") or {}).get(name),
            "note": "",
        })
    return out


def build_result_v2(
    summary: dict[str, Any],
    job_id: str,
    video: dict[str, Any] | None = None,
    warnings: list[str] | None = None,
) -> dict[str, Any]:
    events_out: list[dict[str, Any]] = []
    for i, e in enumerate(summary.get("shot_events") or []):
        if not isinstance(e, dict):
            continue
        ws = e.get("weighted_scoring") or {}
        events_out.append({
            "id": _event_id(job_id, i),
            "index": i + 1,
            "type": e.get("event_type"),
            "t_seconds": e.get("timestamp"),
            "result": e.get("result"),
            "llm_form_score": e.get("form_score"),
            "measured_score": ws.get("composite_score"),
            "measurement_coverage": ws.get("coverage"),
            "feedback": e.get("feedback"),
            "measurements": _measurements(e),
            "injury_indicators": e.get("injury_risk"),
        })
    findings = []
    for i, f in enumerate(summary.get("findings") or []):
        if isinstance(f, dict):
            findings.append({**f, "id": f"{job_id}:e{i + 1}"})
    return {
        "schema_version": SCHEMA_VERSION,
        "job_id": job_id,
        "provenance": summary.get("provenance") or {},
        "video": video or {},
        "sport": summary.get("sport"),
        "angle": summary.get("angle"),
        "session": {
            "overall_rating": summary.get("overall_rating"),
            "average_form_score": summary.get("average_form_score"),
            "success_rate_percent": summary.get("success_rate_percent"),
            "total_events": summary.get("total_events"),
            "summary": summary.get("summary"),
            "strengths": summary.get("strengths") or [],
            "top_tips": summary.get("top_tips") or [],
            "priority_drill": summary.get("priority_drill"),
        },
        "events": events_out,
        "findings": findings,
        "quality": summary.get("quality") or {},
        "needs_review": bool(summary.get("needs_review")),
        "warnings": list(warnings or []),
    }


def events_csv(result: dict[str, Any]) -> str:
    header = ["job_id", "event_id", "index", "type", "t_seconds", "result",
              "llm_form_score", "measured_score", "measurement_coverage", "feedback"]
    rows = [[result["job_id"], e["id"], e["index"], e["type"], _f(e["t_seconds"]), e["result"],
             e["llm_form_score"], e["measured_score"], e["measurement_coverage"], e["feedback"]]
            for e in result["events"]]
    return _rows_to_csv(header, rows)


def measurements_csv(result: dict[str, Any]) -> str:
    header = ["job_id", "event_id", "t_seconds", "metric", "label", "value", "unit",
              "ideal_min", "ideal_max", "score", "weight", "source", "confidence", "note"]
    rows = []
    for e in result["events"]:
        for m in e["measurements"]:
            rows.append([result["job_id"], e["id"], _f(e["t_seconds"]), m["metric"], m["label"],
                         _f(m["value"], 1), m["unit"], m["ideal_min"], m["ideal_max"], m["score"],
                         m["weight"], m["source"], m["confidence"], m["note"]])
    return _rows_to_csv(header, rows)


def findings_csv(result: dict[str, Any]) -> str:
    header = ["job_id", "finding_id", "category", "start_s", "end_s", "severity",
              "confidence_band", "confidence", "review_state", "observation", "feedback"]
    rows = [[result["job_id"], f["id"], f.get("category"), _f((f.get("start_ms") or 0) / 1000.0),
             _f((f.get("end_ms") or 0) / 1000.0), f.get("severity"), f.get("confidence_band"),
             f.get("confidence"), f.get("review_state"), f.get("observation"), f.get("feedback")]
            for f in result["findings"]]
    return _rows_to_csv(header, rows)


def session_csv(result: dict[str, Any]) -> str:
    s, p = result["session"], result["provenance"]
    header = ["job_id", "sport", "angle", "overall_rating", "average_form_score",
              "success_rate_percent", "total_events", "needs_review", "engine", "model",
              "analysis_prompt", "sport_pack_version", "analyzed_at"]
    row = [result["job_id"], result["sport"], result["angle"], s["overall_rating"],
           s["average_form_score"], s["success_rate_percent"], s["total_events"],
           result["needs_review"], p.get("engine"), p.get("model"), p.get("analysis_prompt"),
           p.get("sport_pack_version"), p.get("analyzed_at")]
    return _rows_to_csv(header, [row])


def write_exports(result: dict[str, Any], out_dir: str | Path) -> dict[str, str]:
    """Write result.json + 4 CSVs (UTF-8 with BOM so Excel reads accents)."""
    import json

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    files = {
        "result.json": json.dumps(result, indent=2, ensure_ascii=False, default=str),
        "session.csv": session_csv(result),
        "events.csv": events_csv(result),
        "measurements.csv": measurements_csv(result),
        "findings.csv": findings_csv(result),
    }
    paths: dict[str, str] = {}
    for name, text in files.items():
        enc = "utf-8" if name.endswith(".json") else "utf-8-sig"
        p = out / name
        p.write_text(text, encoding=enc, newline="")
        paths[name] = str(p)
    return paths