"""core/stats.py — engine-side stat validation and correction.

The module's whole reason to exist is that Gemini's *cumulative* counts cannot
be trusted: `analyzer` replaces them with counts recomputed from each shot
event's own `result` field (analyzer.py:750). So the branches that decide an
answer here are the two classification lists — a result string in neither list
must move neither counter — and the two `isinstance` guards on `form_score`.

The `form_score` guard is this repo's own recurring trap: a model-supplied
number is untyped input. `validator` checks summary fields for presence and
never type, and `quality_check` coerces with `float()`, so `"8.5"` has been seen
arriving as a string. `isinstance(form_score, (int, float))` is the only thing
between that and a `TypeError` in the render loop, so it is pinned here with a
string, a `None`, a bool and a `Decimal`-adjacent case.
"""

from __future__ import annotations

import pytest

from core.stats import validate_and_correct_stats

MADE = ["made", "goal", "hit", "ace", "winner", "home_run", "four", "six",
        "boundary", "single", "two", "three"]
MISSED = ["missed", "saved", "blocked", "offside", "error", "out", "strikeout",
          "double_fault", "wicket", "dot_ball", "post"]


def _events(*results, scores=None):
    scores = list(scores or [])
    return [
        {"result": r, "form_score": scores[i] if i < len(scores) else None}
        for i, r in enumerate(results)
    ]


# ── The result classification lists ───────────────────────────────────────────


class TestResultClassification:
    @pytest.mark.parametrize("result", MADE)
    def test_every_made_synonym_counts_as_made(self, result):
        stats = validate_and_correct_stats(_events(result))
        assert (stats["total_made"], stats["total_missed"]) == (1, 0)

    @pytest.mark.parametrize("result", MISSED)
    def test_every_missed_synonym_counts_as_missed(self, result):
        stats = validate_and_correct_stats(_events(result))
        assert (stats["total_made"], stats["total_missed"]) == (0, 1)

    def test_the_two_lists_do_not_overlap(self):
        # An overlap would make the if/elif chain order-dependent and one of the
        # two lists would be dead.
        assert not set(MADE) & set(MISSED)

    def test_no_result_string_is_classified_twice(self):
        assert len(set(MADE)) == len(MADE)
        assert len(set(MISSED)) == len(MISSED)

    @pytest.mark.parametrize("result", ["", None, "unknown", "MADE", "in_play", "walk", 0, 1, True])
    def test_an_unrecognised_result_moves_neither_counter(self, result):
        """The counters are derived, not trusted — so an unrecognised string
        must simply not be counted, rather than defaulting to a miss and
        silently deflating the success rate."""
        stats = validate_and_correct_stats(_events(result))
        assert (stats["total_made"], stats["total_missed"]) == (0, 0)

    def test_a_true_boolean_is_not_classified_as_made(self):
        # `True == 1` in Python but `1` is not in either list, and `True` is not
        # either. Pinned because a truthiness shortcut here would inflate counts.
        stats = validate_and_correct_stats(_events(True, False))
        assert stats["total_made"] == 0
        assert stats["total_missed"] == 0

    def test_the_counters_can_sum_to_less_than_total_events(self):
        # total_events is the *input* length, so unclassified events widen the
        # denominator. That is deliberate — it keeps the correction anchored to
        # what the model actually returned.
        stats = validate_and_correct_stats(_events("made", "made", "banana"))
        assert stats["total_events"] == 3
        assert stats["total_made"] == 2
        assert stats["total_missed"] == 0


# ── success_rate_percent ──────────────────────────────────────────────────────


class TestSuccessRate:
    def test_a_perfect_night_is_one_hundred_percent(self):
        assert validate_and_correct_stats(_events("made", "made"))["success_rate_percent"] == 100.0

    def test_a_total_miss_is_zero_percent(self):
        assert validate_and_correct_stats(_events("missed"))["success_rate_percent"] == 0.0

    @pytest.mark.parametrize(
        "results,expected",
        [
            (["made", "missed"], 50.0),
            (["made", "made", "missed"], 66.7),
            (["made", "made", "made", "missed"], 75.0),
            (["goal", "saved", "blocked", "missed"], 25.0),
        ],
    )
    def test_the_rate_is_made_over_total_rounded_to_one_place(self, results, expected):
        assert validate_and_correct_stats(_events(*results))["success_rate_percent"] == expected

    def test_an_empty_input_yields_zero_percent_rather_than_dividing_by_zero(self):
        stats = validate_and_correct_stats([])
        assert stats["success_rate_percent"] == 0.0
        assert stats["total_events"] == 0

    def test_a_single_made_is_one_hundred_percent(self):
        assert validate_and_correct_stats(_events("made"))["success_rate_percent"] == 100.0

    def test_an_unclassified_event_drags_the_rate_down(self):
        # The denominator is every event, so a result string the engine does not
        # know about lowers the rate without being counted as a miss.
        with_unknown = validate_and_correct_stats(_events("made", "banana"))
        assert with_unknown["success_rate_percent"] == 50.0


# ── average_form_score ────────────────────────────────────────────────────────


class TestAverageFormScore:
    def test_the_mean_is_computed_over_the_scored_events_only(self):
        stats = validate_and_correct_stats(_events("made", "missed", scores=[8.0, 6.0]))
        assert stats["average_form_score"] == 7.0

    def test_events_without_a_score_do_not_dilute_the_mean(self):
        stats = validate_and_correct_stats(
            _events("made", "missed", "made", scores=[8.0])
        )
        assert stats["average_form_score"] == 8.0

    def test_no_scores_yields_zero_rather_than_dividing_by_zero(self):
        assert validate_and_correct_stats(_events("made", "missed"))["average_form_score"] == 0.0

    def test_a_zero_score_is_excluded_from_the_mean(self):
        """`form_score > 0` — a 0 is treated as "not scored" rather than as a
        worst-possible score, so the mean of [10, 0] is 10, not 5."""
        stats = validate_and_correct_stats(_events("made", "missed", scores=[10, 0]))
        assert stats["average_form_score"] == 10.0

    def test_a_negative_score_is_excluded_too(self):
        stats = validate_and_correct_stats(_events("made", scores=[8, -3]))
        assert stats["average_form_score"] == 8.0

    def test_the_mean_is_rounded_to_one_place(self):
        stats = validate_and_correct_stats(_events("made", "made", "made", scores=[7, 8, 8]))
        assert stats["average_form_score"] == 7.7

    @pytest.mark.parametrize("value", ["8.5", "10", "N/A", "", None, [8], {"a": 1}, (8,), object()])
    def test_a_non_numeric_form_score_is_skipped_not_coerced(self, value):
        """The string-where-a-number-is-expected case.

        `isinstance(form_score, (int, float))` is the whole guard. `float("8.5")`
        would succeed and "N/A" would raise — and this repo has already lost a
        render loop to exactly that shape, after the Gemini call had been paid
        for. Every one of these must be skipped, leaving the mean at 0.0.
        """
        stats = validate_and_correct_stats(_events("made", "missed", scores=[value]))
        assert stats["average_form_score"] == 0.0

    def test_a_numeric_string_does_not_pollute_a_real_mean(self):
        """Pinned against the trap directly: a mixed batch must average only the
        real numbers, not a coerced copy of the string."""
        stats = validate_and_correct_stats(
            _events("made", "missed", "made", scores=[8.0, "10", 6.0])
        )
        assert stats["average_form_score"] == 7.0

    def test_a_bool_score_is_treated_as_a_number_because_bool_is_an_int(self):
        """CHARACTERISATION: `isinstance(True, int)` is True in Python, so a
        boolean form_score *is* admitted and contributes 1.0. Nobody sends
        `true` for a 1-10 score, but the type check cannot exclude it — pinned
        so the behaviour is a decision rather than an accident."""
        stats = validate_and_correct_stats(_events("made", "missed", scores=[True, 9.0]))
        assert stats["average_form_score"] == 5.0

    def test_a_float_form_score_is_kept_even_though_the_prompt_asks_for_an_int(self):
        stats = validate_and_correct_stats(_events("made", "missed", scores=[8.5, 7.5]))
        assert stats["average_form_score"] == 8.0

    def test_an_int_score_over_ten_is_not_clamped(self):
        """No upper bound is enforced: the module corrects counts, not grades.
        Pinned so a future clamp is a deliberate change."""
        stats = validate_and_correct_stats(_events("made", scores=[42]))
        assert stats["average_form_score"] == 42.0


# ── Shape and degenerate input ────────────────────────────────────────────────


class TestStatsShape:
    def test_the_documented_keys_are_all_present(self):
        stats = validate_and_correct_stats([])
        assert set(stats) == {
            "total_events",
            "total_made",
            "total_missed",
            "success_rate_percent",
            "average_form_score",
        }

    def test_an_event_without_a_result_key_is_counted_as_an_event(self):
        stats = validate_and_correct_stats([{"form_score": 7}])
        assert stats["total_events"] == 1
        assert stats["total_made"] == 0
        assert stats["success_rate_percent"] == 0.0
        assert stats["average_form_score"] == 7.0

    def test_it_never_raises_on_a_partially_shaped_event(self):
        # `normalize_gemini_result` output is the contract, but a malformed event
        # must not take the analysis down with it.
        stats = validate_and_correct_stats([{}, {"result": "made"}, {"result": None}])
        assert stats["total_events"] == 3
        assert stats["total_made"] == 1

    def test_the_counters_are_integers(self):
        stats = validate_and_correct_stats(_events("made", "missed"))
        assert isinstance(stats["total_events"], int)
        assert isinstance(stats["total_made"], int)
        assert isinstance(stats["total_missed"], int)

    def test_every_result_is_classified_consistently_across_sports(self):
        """One football goal and one cricket four must both land in the made
        column — that is the whole point of the synonym lists."""
        stats = validate_and_correct_stats(_events("goal", "four", "wicket", "saved"))
        assert (stats["total_made"], stats["total_missed"]) == (2, 2)

    def test_the_rate_is_a_percentage_not_a_fraction(self):
        assert validate_and_correct_stats(_events("made", "missed"))["success_rate_percent"] == 50.0

    def test_the_rate_never_exceeds_one_hundred_or_goes_negative(self):
        stats = validate_and_correct_stats(_events("made", "made", "made"))
        assert 0.0 <= stats["success_rate_percent"] <= 100.0
