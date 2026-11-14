"""result.json plus tidy CSVs (UTF-8 with BOM so Excel shows accents)."""

import csv
import io
import json
import math
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
    rows = []
    for e in _as_list(r.get("events")):
        if not isinstance(e, dict):
            continue
        tags = e.get("tags")
        tags = tags if isinstance(tags, list) else []
        rows.append(
            [
                r.get("job_id"),
                e.get("id"),
                e.get("index"),
                e.get("type"),
                e.get("t"),
                e.get("result"),
                e.get("event_state"),
                e.get("confirmed"),
                e.get("score"),
                e.get("score_source"),
                e.get("coverage"),
                e.get("confidence"),
                e.get("pressure"),
                "; ".join(str(t) for t in tags if t is not None),
                e.get("feedback"),
            ]
        )
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
        rows,
    )


def measurements_csv(r: dict) -> str:
    rows = []
    for e in _as_list(r.get("events")):
        if not isinstance(e, dict):
            continue
        for m in _as_list(e.get("measurements")):
            if not isinstance(m, dict):
                continue
            ideal = m.get("ideal") or (None, None)
            try:
                lo, hi = ideal[0], ideal[1]
            except Exception:
                lo, hi = None, None
            frames = m.get("source_frames")
            times = m.get("source_t")
            rows.append(
                [
                    r.get("job_id"),
                    e.get("id"),
                    e.get("t"),
                    m.get("criterion_id") or m.get("key"),
                    m.get("key"),
                    m.get("label"),
                    m.get("value"),
                    m.get("unit"),
                    lo,
                    hi,
                    m.get("score"),
                    m.get("weight"),
                    m.get("source"),
                    m.get("state"),
                    m.get("evidence_type"),
                    m.get("validation_status"),
                    m.get("measurement_type"),
                    m.get("calibration"),
                    m.get("confidence"),
                    " ".join(str(n) for n in frames) if isinstance(frames, list) else "",
                    " ".join(str(n) for n in times) if isinstance(times, list) else "",
                    m.get("note"),
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
    rows = []
    for f in _as_list(r.get("findings")):
        if not isinstance(f, dict):
            continue
        start = f.get("start_ms")
        end = f.get("end_ms")
        try:
            start_s = float(start) / 1000 if start is not None else None
        except Exception:
            start_s = None
        try:
            end_s = float(end) / 1000 if end is not None else None
        except Exception:
            end_s = None
        if start_s is not None and not math.isfinite(start_s):
            start_s = None
        if end_s is not None and not math.isfinite(end_s):
            end_s = None
        rows.append(
            [
                r.get("job_id"),
                f.get("id"),
                f.get("category"),
                start_s,
                end_s,
                f.get("severity"),
                f.get("confidence_band"),
                f.get("confidence"),
                f.get("review_state"),
                f.get("event_state"),
                f.get("confirmed"),
                f.get("observation"),
            ]
        )
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
        rows,
    )


def session_csv(r: dict) -> str:
    s = _as_dict(r.get("summary"))
    p = _as_dict(r.get("provenance"))
    composite = _as_dict(s.get("composite"))
    pack = _as_dict(p.get("sport_pack_manifest"))
    athlete = _as_dict(r.get("athlete"))
    manifest = _as_dict(p.get("manifest"))
    app = _as_dict(manifest.get("application"))
    prompt = _as_dict(manifest.get("prompt"))
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
                r.get("job_id"),
                r.get("sport"),
                r.get("action_id"),
                r.get("angle"),
                r.get("angle_source"),
                r.get("research_mode"),
                r.get("aggregation"),
                r.get("job_status"),
                s.get("rating"),
                s.get("rating_status"),
                s.get("average_score"),
                composite.get("status"),
                composite.get("value"),
                composite.get("coverage"),
                composite.get("validated"),
                composite.get("excluded_from_research"),
                s.get("confidence"),
                s.get("events"),
                s.get("made"),
                s.get("missed"),
                s.get("success_rate"),
                athlete.get("track_coverage"),
                r.get("needs_review"),
                p.get("judged_by"),
                p.get("model"),
                p.get("engine"),
                p.get("analyzed_at"),
                p.get("video_sha256"),
                pack.get("pack_version") or pack.get("version"),
                pack.get("sha256"),
                app.get("git_commit"),
                prompt.get("hash"),
            ]
        ],
    )


def metrics_csv(r: dict) -> str:
    rows = []
    for e in _as_list(r.get("events")):
        if not isinstance(e, dict):
            continue
        for m in _as_list(e.get("metrics")):
            if not isinstance(m, dict):
                continue
            ideal = m.get("ideal") or (None, None)
            try:
                lo, hi = ideal[0], ideal[1]
            except Exception:
                lo, hi = None, None
            rows.append(
                [
                    r.get("job_id"),
                    e.get("id"),
                    e.get("t"),
                    "event",
                    m.get("key"),
                    m.get("label"),
                    m.get("unit"),
                    m.get("value"),
                    m.get("score"),
                    lo,
                    hi,
                    None,
                    None,
                ]
            )
        matchup = _as_dict(e.get("matchup"))
        opponent = _as_dict(matchup.get("opponent"))
        for m in _as_list(opponent.get("metrics")):
            if not isinstance(m, dict):
                continue
            ideal = m.get("ideal") or (None, None)
            try:
                lo, hi = ideal[0], ideal[1]
            except Exception:
                lo, hi = None, None
            rows.append(
                [
                    r.get("job_id"),
                    e.get("id"),
                    e.get("t"),
                    "opponent",
                    m.get("key"),
                    m.get("label"),
                    m.get("unit"),
                    m.get("value"),
                    m.get("score"),
                    lo,
                    hi,
                    None,
                    None,
                ]
            )
    for m in _as_list(r.get("session_metrics")):
        if not isinstance(m, dict):
            continue
        rows.append(
            [
                r.get("job_id"),
                "",
                "",
                "session",
                m.get("key"),
                m.get("label"),
                m.get("unit"),
                m.get("value"),
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
    stats = _as_dict(r.get("stats"))
    for group in _as_list(stats.get("groups")):
        if not isinstance(group, dict):
            continue
        for row in _as_list(group.get("stats")):
            if not isinstance(row, dict):
                continue
            rows.append(
                [
                    r.get("job_id"),
                    group.get("label"),
                    row.get("key"),
                    row.get("label"),
                    row.get("value"),
                    row.get("display"),
                    row.get("unit"),
                    row.get("source"),
                    row.get("band"),
                    row.get("note"),
                ]
            )
    trend = stats.get("trend")
    if isinstance(trend, dict):
        rows.append(
            [
                r.get("job_id"),
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
    for item in _as_list(stats.get("unavailable")):
        if not isinstance(item, dict):
            continue
        rows.append(
            [
                r.get("job_id"),
                "Unavailable",
                "",
                item.get("label"),
                None,
                None,
                "",
                None,
                None,
                item.get("reason"),
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


def _as_list(value):
    return value if isinstance(value, list) else []


def _as_dict(value):
    return value if isinstance(value, dict) else {}


def write_all(result: dict, out_dir: str) -> dict[str, str]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    r = result if isinstance(result, dict) else {}
    prov = _as_dict(r.get("provenance"))
    manifest = prov.get("manifest")
    if not isinstance(manifest, dict):
        manifest = {}
    files = {
        "result.json": json.dumps(r, indent=1, ensure_ascii=False),
        "manifest.json": json.dumps(manifest, indent=1, ensure_ascii=False),
        "session.csv": session_csv(r),
        "events.csv": events_csv(r),
        "measurements.csv": measurements_csv(r),
        "findings.csv": findings_csv(r),
        "metrics.csv": metrics_csv(r),
        "stats.csv": stats_csv(r),
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
