"""Wire contract for the analysis result.

normalize_gemini_result is the adapter that owns the AnalysisSummary shape
consumed by the server and web layers. This test pins the exact set of keys
and the key transforms so a rename/removal surfaces here instead of silently
breaking the chat context or the results UI.

Keep the expected shape in sync with:
  - server/src/types/index.ts AnalysisSummary / ShotEvent
  - web-next/types/index.ts AnalysisSummary / ShotEvent
  - the analysis contract tests in server/tests and web-next/lib/__tests__
"""

from __future__ import annotations

from core.gemini_client import normalize_gemini_result


RAW_SAMPLE = {
    "sport": "cricket",
    "player_name": "Alice",
    "session_date": "2025-01-02",
    "summary": "",
    "session_summary": {
        "average_form_score": 7.5,
        "overall_rating": "Good",
        "top_issues": ["follow through", "head position"],
        "strengths": ["balance"],
        "priority_drill": "Shadow drive",
        "success_rate_percent": 62,
        "total_events": 1,
    },
    "shots": [
        {
            "timestamp_of_shot": "1:30",
            "shot_type": "drive",
            "form_score": 7.5,
            "feedback": "Good timing.",
            "result": "four",
            "form_breakdown": {"elbow": "good", "head": "needs_work"},
            "runs_so_far": 12,
        },
    ],
}


CANONICAL_TOP_LEVEL = [
    "sport",
    "player_name",
    "session_date",
    "form_score",
    "overall_rating",
    "top_tips",
    "summary",
    "strengths",
    "priority_drill",
    "shot_events",
    "success_rate_percent",
    "average_form_score",
    "total_events",
]

CANONICAL_SHOT_EVENT_KEYS = [
    "timestamp",
    "event_type",
    "form_score",
    "feedback",
    "result",
    "form_breakdown",
    "biomechanics",
    "weighted_scoring",
    "injury_risk",
    "key_observation",
]


class TestAnalysisContract:
    def test_top_level_shape_is_pinned(self):
        out = normalize_gemini_result(RAW_SAMPLE)
        assert sorted(out.keys()) == sorted(CANONICAL_TOP_LEVEL)
        # Keys must match exactly — no extra, no missing.
        assert len(out) == len(CANONICAL_TOP_LEVEL)

    def test_shot_event_shape_is_pinned(self):
        out = normalize_gemini_result(RAW_SAMPLE)
        event = out["shot_events"][0]
        for key in CANONICAL_SHOT_EVENT_KEYS:
            assert key in event, key

    def test_canonical_transforms(self):
        out = normalize_gemini_result(RAW_SAMPLE)
        event = out["shot_events"][0]
        assert out["form_score"] == 7.5
        assert out["overall_rating"] == "Good"
        assert out["top_tips"] == ["follow through", "head position"]
        assert out["summary"] == "Overall rating: Good. Key areas to focus on: follow through; head position. Priority drill: Shadow drive"
        assert out["success_rate_percent"] == 62
        assert event["timestamp"] == 90.0  # "1:30" parsed to seconds
        assert event["event_type"] == "drive"
        assert event["key_observation"] == "head: needs_work"
        assert event["runs_so_far"] == 12  # *_so_far passthrough

    def test_missing_fields_satisfy_optional_contract(self):
        out = normalize_gemini_result({"shots": [], "session_summary": {}})
        assert out["shot_events"] == []
        assert out["form_score"] == 0
        assert out["strengths"] == []
        assert out["priority_drill"] is None
