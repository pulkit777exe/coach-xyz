"""
validator.py — Validates the JSON response from Gemini against the expected schema.
"""

from core.sport_config import sport_outcomes, sport_stat_keys

VALID_SPORTS = ['basketball', 'football', 'cricket', 'tennis', 'baseball', 'hockey']

REQUIRED_TOP_LEVEL = ['sport', 'shots']

REQUIRED_SHOT_FIELDS = [
    'timestamp_of_outcome',
    'result',
    'shot_type',
    'feedback',
]

def _valid_results() -> dict[str, list[str]]:
    """Allowed shot outcomes per sport, from the sport packs (pos+neg+neutral)."""
    tables: dict[str, list[str]] = {}
    for sport in VALID_SPORTS:
        outcomes = sport_outcomes(sport)
        tables[sport] = outcomes["positive"] + outcomes["negative"] + outcomes["neutral"]
    return tables


VALID_RESULTS = _valid_results()

EXPECTED_STAT_KEYS = {sport: sport_stat_keys(sport) for sport in VALID_SPORTS}

VALID_FORM_RATINGS = ['good', 'needs_work', 'poor', 'N/A']

SUMMARY_FIELDS = [
    'total_events',
    'success_rate_percent',
    'average_form_score',
    'top_issues',
    'strengths',
    'priority_drill',
    'overall_rating',
]

VALID_RATINGS = ['Elite', 'Advanced', 'Intermediate', 'Developing', 'Beginner']


def validate_analysis(data: dict) -> list[str]:
    """
    Validate the analysis JSON output from Gemini.

    Returns a list of error/warning strings.
    An empty list means the data is valid.
    """
    errors = []

    # ── Top-level required fields ─────────────────────────────────────────
    for field in REQUIRED_TOP_LEVEL:
        if field not in data:
            errors.append(f"Missing required top-level field: '{field}'")

    sport = data.get('sport')
    if sport is not None and sport not in VALID_SPORTS:
        errors.append(f"Invalid sport: '{sport}'. Must be one of {VALID_SPORTS}")

    # ── Shots validation ──────────────────────────────────────────────────
    shots = data.get('shots', [])
    if not isinstance(shots, list):
        errors.append("'shots' must be a list")
        return errors

    allowed_results = VALID_RESULTS.get(sport, [])
    stat_keys       = EXPECTED_STAT_KEYS.get(sport, [])
    prev_totals     = {}

    for i, shot in enumerate(shots, start=1):
        label = f"Shot {i}"

        # Required shot fields
        for field in REQUIRED_SHOT_FIELDS:
            if field not in shot:
                errors.append(f"{label}: missing required field '{field}'")

        # Result validity
        result = shot.get('result')
        if result and allowed_results and result not in allowed_results:
            errors.append(f"{label}: invalid result '{result}' for {sport}")

        # Form score range
        form_score = shot.get('form_score')
        if form_score is not None:
            if not isinstance(form_score, (int, float)):
                errors.append(f"{label}: form_score must be a number, got {type(form_score).__name__}")
            elif form_score < 1 or form_score > 10:
                errors.append(f"{label}: form_score must be 1–10, got {form_score}")

        # Form breakdown rating values
        breakdown = shot.get('form_breakdown')
        if breakdown and isinstance(breakdown, dict):
            for criterion, rating in breakdown.items():
                if rating not in VALID_FORM_RATINGS:
                    errors.append(
                        f"{label}: form_breakdown['{criterion}'] has invalid "
                        f"rating '{rating}'; expected one of {VALID_FORM_RATINGS}"
                    )

        # Cumulative stat keys present & monotonically non-decreasing
        for key in stat_keys:
            val = shot.get(key)
            if val is None:
                errors.append(f"{label}: missing sport stat key '{key}'")
            elif isinstance(val, (int, float)):
                prev = prev_totals.get(key)
                if prev is not None and val < prev:
                    errors.append(
                        f"{label}: cumulative stat '{key}' decreased "
                        f"from {prev} to {val}"
                    )
                prev_totals[key] = val

        # Timestamp format (loose check: should contain a colon)
        for ts_key in ('timestamp_of_shot', 'timestamp_of_outcome'):
            ts = shot.get(ts_key)
            if ts is not None and ':' not in str(ts):
                errors.append(f"{label}: '{ts_key}' doesn't look like M:SS.s format: '{ts}'")

        # Feedback must not be empty
        feedback = shot.get('feedback')
        if feedback is not None and not feedback.strip():
            errors.append(f"{label}: 'feedback' is empty")

    # ── Session summary validation ────────────────────────────────────────
    summary = data.get('session_summary')
    if summary is not None:
        if not isinstance(summary, dict):
            errors.append("'session_summary' must be a dict")
        else:
            for field in SUMMARY_FIELDS:
                if field not in summary:
                    errors.append(f"session_summary: missing field '{field}'")

            rating = summary.get('overall_rating')
            if rating is not None and rating not in VALID_RATINGS:
                errors.append(
                    f"session_summary: invalid overall_rating '{rating}'; "
                    f"expected one of {VALID_RATINGS}"
                )

            top_issues = summary.get('top_issues')
            if top_issues is not None and not isinstance(top_issues, list):
                errors.append("session_summary: 'top_issues' must be a list")

            strengths = summary.get('strengths')
            if strengths is not None and not isinstance(strengths, list):
                errors.append("session_summary: 'strengths' must be a list")

    return errors
