"""Prompt assembly contract: ALL variants are concatenations, not copies.

The per-sport event/form/stat sections are the single source of truth;
the ALL variants and per-sport blocks assemble from shared headers +
sections + closers. These tests pin the assembly ribs: every sport's
section appears exactly once in its ALL, per-sport blocks carry exactly
their own section, and the basketball-only form closer is not smeared
across other sports. Prompt PROSE stays hand-authored (not pack-derived).
"""

from core.prompt import (
    _EVENT_DETECTION_ALL,
    _EVENT_DETECTION_HEADER,
    _EVENT_DETECTION_SECTIONS,
    _EVENT_DETECTION_SPORTS,
    _FORM_CHECKLIST_ALL,
    _FORM_CHECKLIST_CLOSER,
    _FORM_CHECKLIST_HEADER,
    _FORM_CHECKLIST_HEADER_SHORT,
    _FORM_CHECKLIST_SECTIONS,
    _FORM_CHECKLIST_SPORTS,
    _SPORT_SPECIFIC_STATS_ALL,
    _SPORT_SPECIFIC_STATS_SPORTS,
    _SPORT_STATS_ENTRIES,
    _SPORT_STATS_HEADER,
    get_system_prompt,
)

SPORTS = ['basketball', 'football', 'cricket', 'tennis', 'baseball', 'hockey']


class TestEventDetectionAssembly:
    def test_all_contains_each_section_once(self):
        for sport, section in _EVENT_DETECTION_SECTIONS.items():
            assert _EVENT_DETECTION_ALL.count(section) == 1, sport

    def test_per_sport_is_header_plus_own_section(self):
        for sport, section in _EVENT_DETECTION_SECTIONS.items():
            assert _EVENT_DETECTION_SPORTS[sport] == _EVENT_DETECTION_HEADER + section

    def test_sport_prompts_differ_only_by_section(self):
        for sport in SPORTS:
            prompt = get_system_prompt(sport=sport)
            assert _EVENT_DETECTION_SPORTS[sport] in prompt
            others = [s for s in SPORTS if s != sport]
            assert not any(_EVENT_DETECTION_SECTIONS[o] in prompt for o in others)


class TestFormChecklistAssembly:
    def test_all_contains_each_section_once(self):
        for sport, section in _FORM_CHECKLIST_SECTIONS.items():
            assert _FORM_CHECKLIST_ALL.count(section) == 1, sport

    def test_short_header_is_shared(self):
        assert _FORM_CHECKLIST_HEADER != _FORM_CHECKLIST_HEADER_SHORT
        assert 'quantitative measurements' in _FORM_CHECKLIST_HEADER
        assert 'quantitative measurements' not in _FORM_CHECKLIST_HEADER_SHORT

    def test_closer_appears_once_in_all_and_only_basketball(self):
        assert _FORM_CHECKLIST_ALL.count(_FORM_CHECKLIST_CLOSER) == 1
        assert _FORM_CHECKLIST_SPORTS['basketball'].endswith(_FORM_CHECKLIST_CLOSER)
        for sport in SPORTS:
            if sport == 'basketball':
                continue
            assert _FORM_CHECKLIST_CLOSER not in _FORM_CHECKLIST_SPORTS[sport], sport


class TestSportStatsAssembly:
    def test_all_contains_each_entry_once(self):
        for sport, entry in _SPORT_STATS_ENTRIES.items():
            assert _SPORT_SPECIFIC_STATS_ALL.count(entry) == 1, sport

    def test_per_sport_is_header_plus_own_entry(self):
        for sport, entry in _SPORT_STATS_ENTRIES.items():
            assert _SPORT_SPECIFIC_STATS_SPORTS[sport].startswith(_SPORT_STATS_HEADER + entry)
