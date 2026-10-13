"""Pack-parity contract: code tables must equal the sport-pack source of truth.

VALID_RESULTS / EXPECTED_STAT_KEYS (validator) and MADE/MISSED_RESULTS
(stats) are derived from sports/*.json via core.sport_config. These tests
pin the derivation ribs in place: if a pack edit and its code expectation
drift, this fails before any behavior silently changes. Prompt prose and
outcome ORDER stay hand-authored (not derivable) — only set membership
and stat-key order are contracted here.
"""

import json
from pathlib import Path

from core.sport_config import load_sport_config, sport_outcomes, sport_stat_keys
from core.stats import MADE_RESULTS, MISSED_RESULTS
from core.validator import EXPECTED_STAT_KEYS, VALID_RESULTS, VALID_SPORTS

PACKS_DIR = Path(__file__).resolve().parent.parent.parent / "sports"


def _pack(sport: str) -> dict:
    return json.loads((PACKS_DIR / f"{sport}.json").read_text())


class TestPackParity:
    def test_every_supported_sport_has_a_pack(self):
        for sport in VALID_SPORTS:
            assert (PACKS_DIR / f"{sport}.json").exists(), sport
            assert load_sport_config(sport), sport

    def test_valid_results_cover_pack_outcomes_exactly(self):
        for sport in VALID_SPORTS:
            outcomes = sport_outcomes(sport)
            expected = outcomes["positive"] + outcomes["negative"] + outcomes["neutral"]
            assert set(VALID_RESULTS[sport]) == set(expected), sport
            # Neutral outcomes are valid but uncounted.
            for neutral in outcomes["neutral"]:
                assert neutral not in MADE_RESULTS, (sport, neutral)
                assert neutral not in MISSED_RESULTS, (sport, neutral)

    def test_stat_keys_match_pack_order(self):
        for sport in VALID_SPORTS:
            assert EXPECTED_STAT_KEYS[sport] == sport_stat_keys(sport), sport
            assert EXPECTED_STAT_KEYS[sport], sport

    def test_made_missed_equal_pack_unions(self):
        made, missed = set(), set()
        for sport in VALID_SPORTS:
            outcomes = sport_outcomes(sport)
            made.update(outcomes["positive"])
            missed.update(outcomes["negative"])
        assert set(MADE_RESULTS) == made
        assert set(MISSED_RESULTS) == missed

    def test_packs_declare_outcome_sections(self):
        for sport in VALID_SPORTS:
            events = _pack(sport).get("events", {})
            assert set(events) >= {"positive", "negative", "neutral"}, sport
