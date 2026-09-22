"""Unit tests for core/multicam.py — multi-perspective session helpers."""

from core.multicam import (
    PRIMARY_ANGLE,
    angle_labels,
    append_angle,
    normalize_angle_label,
    resolve_angle_players,
    resolve_angle_video_key,
)


def _session():
    return {"video_key": "k0", "players": [{"player_index": 1}], "created_at": 0.0}


class TestNormalizeAngleLabel:
    def test_defaults_to_primary(self):
        assert normalize_angle_label(None) == PRIMARY_ANGLE
        assert normalize_angle_label("") == PRIMARY_ANGLE
        assert normalize_angle_label(123) == PRIMARY_ANGLE

    def test_normalizes_case_and_whitespace(self):
        assert normalize_angle_label("  Side ") == "side"

    def test_strips_unsafe_characters(self):
        assert normalize_angle_label("../../etc") == "etc"
        assert normalize_angle_label("front view!") == "frontview"


class TestAppendAngle:
    def test_first_append_seeds_legacy_fields(self):
        session: dict = {}
        append_angle(session, "side", "k-side", [{"player_index": 2}])
        assert session["video_key"] == "k-side"
        assert session["players"] == [{"player_index": 2}]
        assert angle_labels(session) == ["side"]

    def test_second_angle_preserves_primary_legacy_fields(self):
        session = _session()
        append_angle(session, PRIMARY_ANGLE, "k0", session["players"])
        append_angle(session, "side", "k-side", [{"player_index": 2}])
        assert session["video_key"] == "k0"
        assert angle_labels(session) == [PRIMARY_ANGLE, "side"]

    def test_reappend_overwrites_angle(self):
        session = _session()
        append_angle(session, "side", "k-old", [])
        append_angle(session, "side", "k-new", [{"player_index": 3}])
        assert resolve_angle_video_key(session, "side") == "k-new"
        assert angle_labels(session) == ["side"]

    def test_reappend_records_orphaned_file_for_cleanup(self):
        session = _session()
        append_angle(session, "side", "k-old", [])
        assert session.pop("_replaced_video_key", None) is None
        append_angle(session, "side", "k-new", [])
        assert session.pop("_replaced_video_key", None) == "k-old"


class TestResolve:
    def test_unknown_angle_returns_none(self):
        assert resolve_angle_video_key(_session(), "side") is None
        assert resolve_angle_players(_session(), "side") is None

    def test_legacy_session_resolves_primary(self):
        session = _session()
        assert resolve_angle_video_key(session, None) == "k0"
        assert resolve_angle_players(session, None) == [{"player_index": 1}]

    def test_empty_legacy_session_resolves_none(self):
        assert resolve_angle_video_key({}, None) is None
        assert resolve_angle_players({}, None) == []
