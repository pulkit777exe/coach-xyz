"""result.json plus tidy CSVs (UTF-8 with BOM so Excel shows accents)."""

import csv
import io
import json
from pathlib import Path

LEAD = ("=", "+", "-", "@", "\t", "\r")


def _cell(v):
    if v is None:
        return ""
    if isinstance(v, (bool, int, float)):
        return v
    s = str(v)
    return "'" + s if s.startswith(LEAD) else s


def _csv(header: list[str], rows) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(header)
    for row in rows:
        w.writerow([_cell(v) for v in row])
    return buf.getvalue()


def events_csv(r: dict) -> str:
    return _csv(
        ["job_id", "event_id", "index", "type", "t_seconds", "result", "score", "score_source", "coverage",
         "confidence", "pressure", "tags", "feedback"],
        [[r["job_id"], e["id"], e["index"], e["type"], e["t"], e["result"], e["score"], e["score_source"],
          e["coverage"], e["confidence"], e.get("pressure"), "; ".join(e.get("tags") or []), e["feedback"]]
         for e in r["events"]],
    )


def measurements_csv(r: dict) -> str:
    rows = []
    for e in r["events"]:
        for m in e["measurements"]:
            lo, hi = m["ideal"] or (None, None)
            rows.append([r["job_id"], e["id"], e["t"], m["key"], m["label"], m["value"], m["unit"], lo, hi,
                         m["score"], m["weight"], m["source"], m["confidence"], m["note"]])
    return _csv(["job_id", "event_id", "t_seconds", "criterion", "label", "value", "unit", "ideal_min", "ideal_max",
                 "score", "weight", "source", "confidence", "note"], rows)


def findings_csv(r: dict) -> str:
    return _csv(
        ["job_id", "finding_id", "category", "start_s", "end_s", "severity", "confidence_band", "confidence",
         "review_state", "observation"],
        [[r["job_id"], f["id"], f["category"], f["start_ms"] / 1000, f["end_ms"] / 1000, f["severity"],
          f["confidence_band"], f["confidence"], f["review_state"], f["observation"]] for f in r["findings"]],
    )


def session_csv(r: dict) -> str:
    s, p = r["summary"], r["provenance"]
    return _csv(
        ["job_id", "sport", "angle", "rating", "average_score", "confidence", "events", "made", "missed",
         "success_rate", "track_coverage", "needs_review", "judged_by", "model", "engine", "analyzed_at"],
        [[r["job_id"], r["sport"], r["angle"], s["rating"], s["average_score"], s.get("confidence"), s["events"],
          s.get("made"), s.get("missed"), s["success_rate"], r.get("athlete", {}).get("track_coverage"),
          r["needs_review"], p["judged_by"], p["model"], p["engine"], p["analyzed_at"]]],
    )


def metrics_csv(r: dict) -> str:
    rows = []
    for e in r["events"]:
        for m in e.get("metrics") or []:
            lo, hi = m["ideal"] or (None, None)
            rows.append([r["job_id"], e["id"], e["t"], "event", m["key"], m["label"], m["unit"], m["value"],
                         m["score"], lo, hi, None, None])
        opponent = (e.get("matchup") or {}).get("opponent") or {}
        for m in opponent.get("metrics") or []:
            lo, hi = m["ideal"] or (None, None)
            rows.append([r["job_id"], e["id"], e["t"], "opponent", m["key"], m["label"], m["unit"], m["value"],
                         m["score"], lo, hi, None, None])
    for m in r.get("session_metrics") or []:
        rows.append([r["job_id"], "", "", "session", m["key"], m["label"], m["unit"], m["value"],
                     None, None, None, m.get("best"), m.get("worst")])
    return _csv(["job_id", "event_id", "t_seconds", "scope", "key", "label", "unit", "value", "score",
                 "ideal_min", "ideal_max", "best", "worst"], rows)


def stats_csv(r: dict) -> str:
    rows = []
    stats = r.get("stats") or {}
    for group in stats.get("groups") or []:
        for row in group.get("stats") or []:
            rows.append([r["job_id"], group["label"], row["key"], row["label"], row.get("value"),
                         row.get("display"), row.get("unit"), row.get("source"), row.get("band"),
                         row.get("note")])
    trend = stats.get("trend")
    if trend:
        rows.append([r["job_id"], "Trend", "trend", "Score trend", trend.get("delta"),
                     trend.get("direction"), "/10", trend.get("source"), None, trend.get("note")])
    for item in stats.get("unavailable") or []:
        rows.append([r["job_id"], "Unavailable", "", item["label"], None, None, "", None, None,
                     item["reason"]])
    return _csv(["job_id", "group", "key", "label", "value", "display", "unit", "source", "band", "note"],
                rows)


def write_all(result: dict, out_dir: str) -> dict[str, str]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    files = {
        "result.json": json.dumps(result, indent=1, ensure_ascii=False),
        "session.csv": session_csv(result),
        "events.csv": events_csv(result),
        "measurements.csv": measurements_csv(result),
        "findings.csv": findings_csv(result),
        "metrics.csv": metrics_csv(result),
        "stats.csv": stats_csv(result),
    }
    paths = {}
    for name, text in files.items():
        p = out / name
        p.write_text(text, encoding="utf-8" if name.endswith(".json") else "utf-8-sig", newline="")
        paths[name] = str(p)
    return paths
