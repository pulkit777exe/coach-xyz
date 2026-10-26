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
         "confidence", "feedback"],
        [[r["job_id"], e["id"], e["index"], e["type"], e["t"], e["result"], e["score"], e["score_source"],
          e["coverage"], e["confidence"], e["feedback"]] for e in r["events"]],
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
        ["job_id", "sport", "angle", "rating", "average_score", "events", "success_rate", "needs_review",
         "judged_by", "model", "engine", "analyzed_at"],
        [[r["job_id"], r["sport"], r["angle"], s["rating"], s["average_score"], s["events"], s["success_rate"],
          r["needs_review"], p["judged_by"], p["model"], p["engine"], p["analyzed_at"]]],
    )


def write_all(result: dict, out_dir: str) -> dict[str, str]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    files = {
        "result.json": json.dumps(result, indent=1, ensure_ascii=False),
        "session.csv": session_csv(result),
        "events.csv": events_csv(result),
        "measurements.csv": measurements_csv(result),
        "findings.csv": findings_csv(result),
    }
    paths = {}
    for name, text in files.items():
        p = out / name
        p.write_text(text, encoding="utf-8" if name.endswith(".json") else "utf-8-sig", newline="")
        paths[name] = str(p)
    return paths
