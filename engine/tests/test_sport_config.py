"""Unit tests for core/sport_config.py — single sports/*.json loader."""

from core.sport_config import load_sport_config, recommended_camera_angles


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
