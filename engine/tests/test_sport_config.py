"""Unit tests for core/sport_config.py — single sports/*.json loader."""

from core.sport_config import (
    load_sport_config,
    recommended_camera_angles,
    sport_pack_version,
    sport_positions,
)


class TestLoadSportConfig:
    def test_known_sport_loads(self):
        config = load_sport_config("basketball")
        assert config["sport"] == "basketball"
        assert isinstance(config.get("form_criteria"), list)

    def test_unknown_sport_returns_empty_dict(self):
        assert load_sport_config("quidditch") == {}

    def test_loader_is_cached(self):
        assert load_sport_config("tennis") is load_sport_config("TENNIS")


class TestRecommendedCameraAngles:
    def test_every_sport_has_guidance(self):
        for sport in ("baseball", "basketball", "cricket", "football", "hockey", "tennis"):
            angles = recommended_camera_angles(sport)
            assert len(angles) >= 2, sport
            for entry in angles:
                assert entry["id"].strip()
                assert entry["label"].strip()

    def test_unknown_sport_returns_empty_list(self):
        assert recommended_camera_angles("quidditch") == []
        assert recommended_camera_angles(None) == []


class TestSportPositions:
    def test_every_sport_has_positions(self):
        for sport in ("baseball", "basketball", "cricket", "football", "hockey", "tennis"):
            positions = sport_positions(sport)
            assert len(positions) >= 3, sport
            for entry in positions:
                assert entry["id"].strip()
                assert entry["label"].strip()
            ids = [entry["id"] for entry in positions]
            assert len(set(ids)) == len(ids), sport

    def test_unknown_sport_returns_empty_list(self):
        assert sport_positions("quidditch") == []
        assert sport_positions(None) == []


class TestSportPositionsEndpoint:
    def test_known_sport_serves_vocab(self):
        from fastapi.testclient import TestClient

        import main

        with TestClient(main.app) as client:
            res = client.get("/sports/basketball/positions")
            assert res.status_code == 200
            body = res.json()
            assert body["sport"] == "basketball"
            assert len(body["positions"]) >= 3
            assert body["positions"][0]["id"].strip()

    def test_unknown_sport_serves_empty_list(self):
        from fastapi.testclient import TestClient

        import main

        with TestClient(main.app) as client:
            res = client.get("/sports/quidditch/positions")
            assert res.status_code == 200
            assert res.json() == {"sport": "quidditch", "positions": []}


class TestSportPackVersion:
    def test_every_sport_is_versioned(self):
        for sport in ("baseball", "basketball", "cricket", "football", "hockey", "tennis"):
            assert sport_pack_version(sport) >= 1, sport

    def test_unknown_sport_returns_zero(self):
        assert sport_pack_version("quidditch") == 0
        assert sport_pack_version(None) == 0
