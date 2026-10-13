"""Tests for the session lifecycle module (core.sessions)."""

import pytest

from core import sessions
from core.sessions import (
    complete_scan_progress,
    delete_session_files,
    evict_old_scan_progress,
    evict_old_sessions,
    fail_scan_progress,
    get_session,
    init_scan_progress,
    read_scan_progress,
    report_scan_progress,
    resolve_session,
    store_scan_result,
)


@pytest.fixture(autouse=True)
def _isolated_registry():
    sessions._sessions.clear()
    sessions._scan_progress.clear()
    yield
    sessions._sessions.clear()
    sessions._scan_progress.clear()


class TestResolveSession:
    def test_missing_token_mints(self):
        token, existing = resolve_session(None)
        assert token
        assert existing is None

    def test_unknown_token_mints_fresh(self):
        token, existing = resolve_session("nope")
        assert token != "nope"
        assert existing is None

    def test_known_token_returns_session(self):
        token, _ = resolve_session(None)
        sessions._sessions[token] = {"video_key": "k", "created_at": 1.0}

        token2, existing = resolve_session(token)

        assert token2 == token
        assert existing == {"video_key": "k", "created_at": 1.0}


class TestStoreScanResult:
    def test_creates_session_with_labels(self):
        session, labels, previous = store_scan_result(
            "t1", video_key="k1", players=[], angle_label="primary", append_to_session=False
        )

        assert session["video_key"] == "k1"
        assert labels == ["primary"]
        assert previous is None
        assert get_session("t1") is session

    def test_reupload_surfaces_replaced_key(self):
        store_scan_result("t1", video_key="k1", players=[], angle_label="primary", append_to_session=False)
        _s, _labels, previous = store_scan_result(
            "t1", video_key="k2", players=[], angle_label="primary", append_to_session=True
        )

        assert previous == "k1"

    def test_second_angle_appends(self):
        store_scan_result("t1", video_key="k1", players=[], angle_label="primary", append_to_session=False)
        session, labels, _prev = store_scan_result(
            "t1", video_key="k2", players=[], angle_label="left", append_to_session=True
        )

        assert labels == ["primary", "left"]
        assert session["angles"]["left"]["video_key"] == "k2"


class TestEviction:
    def test_expired_session_evicts_and_deletes_files(self, monkeypatch):
        deleted = []
        monkeypatch.setattr(sessions.storage, "delete_file", deleted.append)
        monkeypatch.setattr(sessions.time, "time", lambda: 10_000.0)
        sessions._sessions["old"] = {"video_key": "k-old", "created_at": 1.0}
        sessions._sessions["new"] = {"video_key": "k-new", "created_at": 9_999.0}

        evict_old_sessions()

        assert get_session("old") is None
        assert get_session("new") is not None
        assert deleted == ["k-old"]

    def test_max_sessions_evicts_oldest(self, monkeypatch):
        monkeypatch.setattr(sessions.storage, "delete_file", lambda _k: None)
        monkeypatch.setattr(sessions.time, "time", lambda: 10_000.0)
        monkeypatch.setattr(sessions, "MAX_SESSIONS", 2)
        # Fresh timestamps (inside SESSION_TTL of the mocked now) so only
        # the max-sessions rule fires — not the TTL sweep.
        for i, created in enumerate((9_996.0, 9_998.0, 10_000.0)):
            sessions._sessions[f"s{i}"] = {"video_key": f"k{i}", "created_at": created}

        evict_old_sessions()

        assert get_session("s0") is None
        assert get_session("s1") is not None
        assert get_session("s2") is not None

    def test_stale_progress_prunes(self, monkeypatch):
        monkeypatch.setattr(sessions.time, "time", lambda: 10_000.0)
        sessions._scan_progress["stale"] = {"started_at": 1.0, "complete": False}
        sessions._scan_progress["fresh"] = {"started_at": 9_999.0, "complete": False}

        evict_old_scan_progress()

        assert "stale" not in sessions._scan_progress
        assert "fresh" in sessions._scan_progress


class TestScanProgress:
    def test_full_lifecycle(self):
        key = init_scan_progress("t1", "primary")
        report_scan_progress(key, 3, 10)

        progress = read_scan_progress("t1", "primary")

        assert progress["current"] == 3
        assert progress["total"] == 10
        assert progress["complete"] is False

        complete_scan_progress(key)
        assert read_scan_progress("t1", "primary")["complete"] is True
        assert read_scan_progress("t1", "primary")["error"] is None

    def test_fail_records_error(self):
        key = init_scan_progress("t1", "primary")
        fail_scan_progress(key, "boom")

        progress = read_scan_progress("t1", "primary")

        assert progress["complete"] is True
        assert progress["error"] == "boom"

    def test_read_falls_back_to_legacy_key(self):
        sessions._scan_progress["t1"] = {
            "session_token": "t1",
            "current": 1,
            "total": 2,
            "complete": False,
            "error": None,
            "angle": "primary",
            "started_at": 1.0,
        }

        assert read_scan_progress("t1", "primary")["current"] == 1

    def test_read_unknown_returns_none(self):
        assert read_scan_progress("missing", "primary") is None


class TestDeleteSessionFiles:
    def test_collects_all_angle_keys(self, monkeypatch):
        deleted = []
        monkeypatch.setattr(sessions.storage, "delete_file", deleted.append)

        delete_session_files(
            {
                "video_key": "k0",
                "angles": {"primary": {"video_key": "k0"}, "left": {"video_key": "k1"}},
            }
        )

        assert sorted(deleted) == ["k0", "k1"]

    def test_ignores_non_dict(self, monkeypatch):
        monkeypatch.setattr(
            sessions.storage, "delete_file", lambda _k: pytest.fail("must not delete")
        )
        delete_session_files(None)
