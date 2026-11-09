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
        [
            "job_id",
            "event_id",
            "index",
            "type",
            "t_seconds",
            "result",
            "event_state",
            "confirmed",
            "score",
            "score_source",
            "coverage",
            "confidence",
            "pressure",
            "tags",
            "feedback",
        ],
        [
            [
                r["job_id"],
                e["id"],
                e["index"],
                e["type"],
                e["t"],
                e["result"],
                e.get("event_state"),
                e.get("confirmed"),
                e["score"],
                e["score_source"],
                e["coverage"],
                e["confidence"],
                e.get("pressure"),
                "; ".join(e.get("tags") or []),
                e["feedback"],
            ]
            for e in r["events"]
        ],
    )


def measurements_csv(r: dict) -> str:
    rows = []
    for e in r["events"]:
        for m in e["measurements"]:
            lo, hi = m["ideal"] or (None, None)
            rows.append(
                [
                    r["job_id"],
                    e["id"],
                    e["t"],
                    m.get("criterion_id") or m["key"],
                    m["key"],
                    m["label"],
                    m["value"],
                    m["unit"],
                    lo,
                    hi,
                    m["score"],
                    m["weight"],
                    m["source"],
                    m.get("state"),
                    m.get("evidence_type"),
                    m.get("validation_status"),
                    m.get("measurement_type"),
                    m.get("calibration"),
                    m["confidence"],
                    " ".join(str(n) for n in m.get("source_frames") or []),
                    " ".join(str(n) for n in m.get("source_t") or []),
                    m["note"],
                ]
            )
    return _csv(
        [
            "job_id",
            "event_id",
            "t_seconds",
            "criterion_id",
            "criterion",
            "label",
            "value",
            "unit",
            "ideal_min",
            "ideal_max",
            "score",
            "weight",
            "source",
            "state",
            "evidence_type",
            "validation_status",
            "measurement_type",
            "calibration",
            "confidence",
            "source_frames",
            "source_t",
            "note",
        ],
        rows,
    )


def findings_csv(r: dict) -> str:
    return _csv(
        [
            "job_id",
            "finding_id",
            "category",
            "start_s",
            "end_s",
            "severity",
            "confidence_band",
            "confidence",
            "review_state",
            "event_state",
            "confirmed",
            "observation",
        ],
        [
            [
                r["job_id"],
                f["id"],
                f["category"],
                f["start_ms"] / 1000,
                f["end_ms"] / 1000,
                f["severity"],
                f["confidence_band"],
                f["confidence"],
                f["review_state"],
                f.get("event_state"),
                f.get("confirmed"),
                f["observation"],
            ]
            for f in r["findings"]
        ],
    )


def session_csv(r: dict) -> str:
    s, p = r["summary"], r["provenance"]
    composite = s.get("composite") or {}
    pack = p.get("sport_pack_manifest") or {}
    return _csv(
        [
            "job_id",
            "sport",
            "action_id",
            "angle",
            "angle_source",
            "research_mode",
            "aggregation",
            "job_status",
            "rating",
            "rating_status",
            "average_score",
            "composite_status",
            "composite_value",
            "composite_coverage",
            "composite_validated",
            "composite_excluded_from_research",
            "confidence",
            "events",
            "made",
            "missed",
            "success_rate",
            "track_coverage",
            "needs_review",
            "judged_by",
            "model",
            "engine",
            "analyzed_at",
            "video_sha256",
            "pack_version",
            "pack_sha256",
            "git_commit",
            "prompt_hash",
        ],
        [
            [
                r["job_id"],
                r["sport"],
                r.get("action_id"),
                r["angle"],
                r.get("angle_source"),
                r.get("research_mode"),
                r.get("aggregation"),
                r.get("job_status"),
                s["rating"],
                s.get("rating_status"),
                s["average_score"],
                composite.get("status"),
                composite.get("value"),
                composite.get("coverage"),
                composite.get("validated"),
                composite.get("excluded_from_research"),
                s.get("confidence"),
                s["events"],
                s.get("made"),
                s.get("missed"),
                s["success_rate"],
                r.get("athlete", {}).get("track_coverage"),
                r["needs_review"],
                p["judged_by"],
                p["model"],
                p["engine"],
                p["analyzed_at"],
                p.get("video_sha256"),
                pack.get("pack_version") or pack.get("version"),
                pack.get("sha256"),
                (p.get("manifest") or {}).get("application", {}).get("git_commit"),
                (p.get("manifest") or {}).get("prompt", {}).get("hash"),
            ]
        ],
    )


def metrics_csv(r: dict) -> str:
    rows = []
    for e in r["events"]:
        for m in e.get("metrics") or []:
            lo, hi = m["ideal"] or (None, None)
            rows.append(
                [
                    r["job_id"],
                    e["id"],
                    e["t"],
                    "event",
                    m["key"],
                    m["label"],
                    m["unit"],
                    m["value"],
                    m["score"],
                    lo,
                    hi,
                    None,
                    None,
                ]
            )
        opponent = (e.get("matchup") or {}).get("opponent") or {}
        for m in opponent.get("metrics") or []:
            lo, hi = m["ideal"] or (None, None)
            rows.append(
                [
                    r["job_id"],
                    e["id"],
                    e["t"],
                    "opponent",
                    m["key"],
                    m["label"],
                    m["unit"],
                    m["value"],
                    m["score"],
                    lo,
                    hi,
                    None,
                    None,
                ]
            )
    for m in r.get("session_metrics") or []:
        rows.append(
            [
                r["job_id"],
                "",
                "",
                "session",
                m["key"],
                m["label"],
                m["unit"],
                m["value"],
                None,
                None,
                None,
                m.get("best"),
                m.get("worst"),
            ]
        )
    return _csv(
        [
            "job_id",
            "event_id",
            "t_seconds",
            "scope",
            "key",
            "label",
            "unit",
            "value",
            "score",
            "ideal_min",
            "ideal_max",
            "best",
            "worst",
        ],
        rows,
    )


def stats_csv(r: dict) -> str:
    rows = []
    stats = r.get("stats") or {}
    for group in stats.get("groups") or []:
        for row in group.get("stats") or []:
            rows.append(
                [
                    r["job_id"],
                    group["label"],
                    row["key"],
                    row["label"],
                    row.get("value"),
                    row.get("display"),
                    row.get("unit"),
                    row.get("source"),
                    row.get("band"),
                    row.get("note"),
                ]
            )
    trend = stats.get("trend")
    if trend:
        rows.append(
            [
                r["job_id"],
                "Trend",
                "trend",
                "Score trend",
                trend.get("delta"),
                trend.get("direction"),
                "/10",
                trend.get("source"),
                None,
                trend.get("note"),
            ]
        )
    for item in stats.get("unavailable") or []:
        rows.append(
            [
                r["job_id"],
                "Unavailable",
                "",
                item["label"],
                None,
                None,
                "",
                None,
                None,
                item["reason"],
            ]
        )
    return _csv(
        [
            "job_id",
            "group",
            "key",
            "label",
            "value",
            "display",
            "unit",
            "source",
            "band",
            "note",
        ],
        rows,
    )


def write_all(result: dict, out_dir: str) -> dict[str, str]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    files = {
        "result.json": json.dumps(result, indent=1, ensure_ascii=False),
        "manifest.json": json.dumps(
            (result.get("provenance") or {}).get("manifest") or {},
            indent=1,
            ensure_ascii=False,
        ),
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
        p.write_text(
            text,
            encoding="utf-8" if name.endswith(".json") else "utf-8-sig",
            newline="",
        )
        paths[name] = str(p)
    return paths
