"""
stats.py — Engine-side stat validation and correction.

Counts made/missed from the `result` field of each shot event,
computes success_rate_percent, total_events, average_form_score,
and returns a stats dict that can be used instead of trusting
Gemini's cumulative counts.
"""

from __future__ import annotations

from core.sport_config import sport_outcomes
from core.validator import VALID_SPORTS

# Made/missed outcome sets, derived from the sport packs (union of every
# sport's positive/negative outcomes). Neutral outcomes (walk, in_play,
# saves) count as neither. Membership-tested, so pack ordering is moot.


def _outcome_union(kind: str) -> frozenset[str]:
    united: set[str] = set()
    for sport in VALID_SPORTS:
        united.update(sport_outcomes(sport)[kind])
    return frozenset(united)


MADE_RESULTS = _outcome_union("positive")
MISSED_RESULTS = _outcome_union("negative")


def validate_and_correct_stats(shot_events: list[dict]) -> dict:
    """
    Count made/missed from the `result` field of each shot
    and compute corrected stats.

    Parameters
    ----------
    shot_events : list[dict]
        Normalized shot events from normalize_gemini_result.
        Each should have 'result', 'form_score', etc.

    Returns
    -------
    dict
        Stats dict with keys:
        - total_events: int
        - total_made: int
        - total_missed: int
        - success_rate_percent: float
        - average_form_score: float
    """
    total_events = len(shot_events)
    total_made = 0
    total_missed = 0
    form_scores = []

    for event in shot_events:
        result = event.get("result")
        if result in MADE_RESULTS:
            total_made += 1
        elif result in MISSED_RESULTS:
            total_missed += 1

        form_score = event.get("form_score")
        if isinstance(form_score, (int, float)) and form_score > 0:
            form_scores.append(form_score)

    success_rate_percent = 0.0
    if total_events > 0:
        success_rate_percent = round((total_made / total_events) * 100, 1)

    average_form_score = 0.0
    if form_scores:
        average_form_score = round(sum(form_scores) / len(form_scores), 1)

    return {
        "total_events": total_events,
        "total_made": total_made,
        "total_missed": total_missed,
        "success_rate_percent": success_rate_percent,
        "average_form_score": average_form_score,
    }
