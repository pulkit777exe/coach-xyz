"""core/quality.py — pre-render quality check (§13 pipeline durability).

Validates the scored summary before the expensive render step. The check
never blocks: issues are stamped onto the summary (`quality`) and force
`needs_review`, so a flawed analysis degrades to human review instead of
failing the job or shipping an unchecked strong claim. Pure functions.
"""

from __future__ import annotations

from typing import Any

VALID_RATINGS = ("Elite", "Advanced", "Intermediate", "Developing", "Beginner")


def _as_float(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result == result else None  # filter NaN


def quality_check(summary: dict[str, Any] | None, duration_s: float | None = None) -> dict[str, Any]:
    """Check a scored summary. Returns {passed, issues, needs_review}.

    - passed: no issues found.
    - issues: short machine-readable codes (stable for logs/tests).
    - needs_review: True when any issue exists (caller ORs it into the
      job-level flag).
    """
    issues: list[str] = []
    if not isinstance(summary, dict) or not summary:
        return {"passed": False, "issues": ["missing_summary"], "needs_review": True}

    sport = summary.get("sport")
    if not isinstance(sport, str) or not sport.strip():
        issues.append("missing_sport")

    score = _as_float(summary.get("form_score"))
    if score is None:
        issues.append("missing_form_score")
    elif not 0 <= score <= 10:
        issues.append("form_score_out_of_range")

    if summary.get("overall_rating") not in VALID_RATINGS:
        issues.append("invalid_overall_rating")

    events = summary.get("shot_events")
    if not isinstance(events, list) or not events:
        issues.append("missing_shot_events")
    else:
        try:
            duration_ms = float(duration_s) * 1000 if duration_s is not None else None
        except (TypeError, ValueError):
            duration_ms = None
        if duration_ms is not None and duration_ms <= 0:
            duration_ms = None
        for event in events:
            if not isinstance(event, dict):
                issues.append("malformed_shot_event")
                break
            ts = _as_float(event.get("timestamp"))
            if ts is None:
                issues.append("event_missing_timestamp")
                break
            if duration_ms is not None and not 0 <= ts * 1000 <= duration_ms:
                issues.append("event_timestamp_out_of_range")
                break
        total = summary.get("total_events")
        if isinstance(total, int) and total != len(events):
            issues.append("event_count_mismatch")

    findings = summary.get("findings")
    if not isinstance(findings, list) or not findings:
        issues.append("missing_findings")
    else:
        for finding in findings:
            if not isinstance(finding, dict):
                issues.append("malformed_finding")
                break
            band = finding.get("confidence_band")
            frames = finding.get("evidence_frames")
            if band in ("high", "moderate") and (not isinstance(frames, list) or not frames):
                issues.append("unsupported_strong_claim")
                break
            state = finding.get("review_state")
            if state not in ("auto", "approved", "flagged", "needs_review"):
                issues.append("invalid_review_state")
                break

    passed = not issues
    return {"passed": passed, "issues": issues, "needs_review": not passed}
