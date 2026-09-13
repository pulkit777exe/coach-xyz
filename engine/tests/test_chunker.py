"""Tests for the pure helpers in core/chunker.py.

The chunk-timeline maths, shot dedup, and summary aggregation are all
network/video-free, so they can be tested with plain in-memory inputs.
"""

import pytest
from core.chunker import (
    _add_seconds,
    _compute_summary,
    _deduplicate_shots,
    _fmt_ts,
    _merge_chunks,
    _overall_rating,
)


class TestTimestampHelpers:
    def test_fmt_ts_pads_seconds(self):
        assert _fmt_ts(0) == "0:00"
        assert _fmt_ts(65) == "1:05"
        assert _fmt_ts(752.3) == "12:32"

    def test_add_seconds_carries_into_minutes(self):
        assert _add_seconds("0:55", 10) == "1:05.00"
        assert _add_seconds("1:30.00", 90) == "3:00.00"

    def test_add_seconds_returns_input_when_unparseable(self):
        assert _add_seconds("garbage", 10) == "garbage"


class TestDeduplicateShots:
    def test_keeps_shots_far_apart(self):
        shots = [
            {"timestamp_of_shot": "0:05"},
            {"timestamp_of_shot": "0:30"},
        ]
        assert _deduplicate_shots(shots) == shots

    def test_drops_shots_within_the_dedup_window(self):
        shots = [
            {"timestamp_of_shot": "0:05"},
            {"timestamp_of_shot": "0:10"},  # boundary artefact, 5s later
            {"timestamp_of_shot": "0:25"},
        ]
        kept = _deduplicate_shots(shots)
        assert [s["timestamp_of_shot"] for s in kept] == ["0:05", "0:25"]

    def test_empty_input(self):
        assert _deduplicate_shots([]) == []


class TestOverallRating:
    def test_rating_bands(self):
        assert _overall_rating(9.0, 100) == "Elite"
        assert _overall_rating(6.0, 40) == "Advanced"
        assert _overall_rating(5.0, 15) == "Intermediate"
        assert _overall_rating(3.0, 10) == "Developing"
        assert _overall_rating(1.0, 0) == "Beginner"


class TestComputeSummary:
    def _shot(self, result="made", score=8, rating="good"):
        return {
            "result": result,
            "form_score": score,
            "form_breakdown": {"follow_through": rating},
        }

    def test_counts_successful_results_for_sport(self):
        shots = [self._shot("made"), self._shot("made"), self._shot("missed")]
        summary = _compute_summary(shots, "basketball")
        assert summary["total_events"] == 3
        assert summary["success_rate_percent"] == 66.7

    def test_aggregates_issues_and_strengths(self):
        shots = [
            self._shot("made", rating="poor"),
            self._shot("made", rating="good"),
        ]
        summary = _compute_summary(shots, "basketball")
        assert summary["top_issues"][0] == "Follow Through"
        assert summary["strengths"][0] == "Follow Through"
        assert summary["priority_drill"].startswith("Focus on improving:")

    def test_empty_shots(self):
        summary = _compute_summary([], "basketball")
        assert summary["total_events"] == 0
        assert summary["success_rate_percent"] == 0
        assert summary["average_form_score"] == 0


class TestMergeChunks:
    def test_sorts_renumbers_and_merges_shot_lists(self):
        chunks = [
            {"sport": "tennis", "player_name": "P", "shots": [
                {"timestamp_of_shot": "0:10", "result": "ace"},
                {"timestamp_of_shot": "0:40", "result": "error"},
            ]},
            {"sport": "tennis", "player_name": "P", "shots": [
                {"timestamp_of_shot": "3:05", "result": "winner"},
            ]},
        ]
        merged = _merge_chunks(chunks)
        assert [s["event_index"] for s in merged["shots"]] == [1, 2, 3]
        assert [s["result"] for s in merged["shots"]] == ["ace", "error", "winner"]

    def test_raises_when_all_chunks_failed(self):
        with pytest.raises(ValueError):
            _merge_chunks([])
